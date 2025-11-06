const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONTEXT_FILES = [
  {
    label: '📄 Selenium Test Context',
    description: 'Resumen generado por bootstrap',
    relativePath: path.join('agent', 'exports', 'selenium_test_context.md')
  },
  {
    label: '📝 Notas Selenium Agent',
    description: 'Checklist operativo',
    relativePath: path.join('agent', 'notes', 'selenium-agent.md')
  },
  {
    label: '📚 Documentación General',
    description: 'Punto de partida del repositorio',
    relativePath: 'DOCUMENTACION.md'
  }
];

const COMPOSER_DATA_FILE = path.join('agent', 'exports', 'composer_deps.json');
const DEPTRAC_FILE = path.join('agent', 'exports', 'deptrac_layers.json');
const SNIPPET_SOURCE_FILE = path.join('agent', 'scripts', 'export_selenium_context.mjs');
const BOOTSTRAP_SCRIPT = path.join('agent', 'bootstrap.sh');

const SOUND_TRIGGER_RELATIVE_PATHS = new Set([
  ...CONTEXT_FILES.map((meta) => meta.relativePath),
  COMPOSER_DATA_FILE,
  DEPTRAC_FILE,
  SNIPPET_SOURCE_FILE
]);

const DEFAULT_SNIPPETS = [
  {
    label: 'selenium:page-object',
    detail: 'Plantilla Page Object',
    language: 'javascript',
    insertText: [
      "import { By } from 'selenium-webdriver';",
      '',
      'export class ${1:PageName}Page {',
      '  constructor(driver) {',
      '    this.driver = driver;',
      '  }',
      '',
      '  async goto() {',
      "    await this.driver.get('${2:/ruta}');",
      '  }',
      '',
      '  async ${3:submitForm}(data) {',
      "    await this.driver.findElement(By.css('${4:#selector}')).sendKeys(data);",
      '    await this.driver.findElement(By.css(\'button[type=\"submit\"]\')).click();',
      '  }',
      '}'
    ].join('\n')
  },
  {
    label: 'selenium:test-case',
    detail: 'Test Jest/Mocha básico',
    language: 'typescript',
    insertText: [
      "import { Builder } from 'selenium-webdriver';",
      '',
      "describe('${1:Feature}', () => {",
      '  let driver;',
      '',
      '  beforeAll(async () => {',
      "    driver = await new Builder().forBrowser('chrome').build();",
      '  }, 30000);',
      '',
      '  afterAll(async () => {',
      '    if (driver) {',
      '      await driver.quit();',
      '    }',
      '  });',
      '',
      "  it('debería ${2:realizar la acción}', async () => {",
      '    // TODO: usa Page Objects del contexto',
      '  });',
      '});'
    ].join('\n')
  },
  {
    label: 'selenium:php-test',
    detail: 'Test PHP PHPUnit',
    language: 'php',
    insertText: [
      '<?php',
      'use Facebook\\WebDriver\\Remote\\RemoteWebDriver;',
      '',
      'class ${1:LoginTest} extends TestCase',
      '{',
      '    /** @var RemoteWebDriver */',
      '    private $driver;',
      '',
      '    protected function setUp(): void',
      '    {',
      "        $this->driver = RemoteWebDriver::create('${2:http://localhost:4444/wd/hub}', DesiredCapabilities::chrome());",
      '    }',
      '',
      '    protected function tearDown(): void',
      '    {',
      '        $this->driver->quit();',
      '    }',
      '',
      '    public function test${3:LoginCorrecto}(): void',
      '    {',
      "        $this->driver->get('${4:/ruta}');",
      '    }',
      '}'
    ].join('\n')
  }
];

let agentTerminal;

function activate(context) {
  let currentWorkspaceRoot = resolveWorkspaceRoot();

  const contextProvider = new AgentContextProvider(currentWorkspaceRoot);
  const composerProvider = new ComposerTreeProvider(currentWorkspaceRoot);
  const snippetProvider = registerSnippets(context, currentWorkspaceRoot);
  const deptracDiagnostics = new DeptracDiagnostics(currentWorkspaceRoot);
  const workbenchProvider = new AgentWorkbenchViewProvider(context, currentWorkspaceRoot);

  const updateWorkspaceRoot = (newRoot) => {
    currentWorkspaceRoot = newRoot;
    contextProvider.setWorkspaceRoot(newRoot);
    composerProvider.setWorkspaceRoot(newRoot);
    snippetProvider.setWorkspaceRoot(newRoot);
    deptracDiagnostics.setWorkspaceRoot(newRoot);
    workbenchProvider.setWorkspaceRoot(newRoot);
  };

  context.subscriptions.push(
    contextProvider,
    composerProvider,
    deptracDiagnostics,
    workbenchProvider,
    vscode.window.createTreeView('agentContextView', { treeDataProvider: contextProvider }),
    vscode.window.createTreeView('agentComposerView', { treeDataProvider: composerProvider }),
    vscode.window.registerWebviewViewProvider('agentWorkbenchPanel', workbenchProvider),
    vscode.commands.registerCommand('agent.context.openQuickPick', () => contextProvider.openQuickPick()),
    vscode.commands.registerCommand('agent.dependencies.refresh', () => {
      composerProvider.refresh();
      workbenchProvider.postState();
    }),
    vscode.commands.registerCommand('agent.configure', () => openConfigurationUI(context)),
    vscode.commands.registerCommand('agent.runBootstrap', () => runBootstrapScript(currentWorkspaceRoot, workbenchProvider)),
    vscode.commands.registerCommand('agent.runSeleniumExport', () => {
      runSeleniumExport(currentWorkspaceRoot, workbenchProvider);
      snippetProvider.invalidate();
    }),
    vscode.commands.registerCommand('agent.runDeptrac', () => runDeptracScript(currentWorkspaceRoot, workbenchProvider)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('agentToolkit.workspaceRoot')) {
        const newRoot = resolveWorkspaceRoot();
        updateWorkspaceRoot(newRoot);
      }
      if (event.affectsConfiguration('agentToolkit.soundFile') || event.affectsConfiguration('agentToolkit.soundMessage')) {
        clearSoundConfigCache();
        workbenchProvider.postState();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = resolveWorkspaceRoot();
      updateWorkspaceRoot(newRoot);
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      if (agentTerminal && terminal === agentTerminal) {
        agentTerminal = undefined;
      }
    })
  );

  registerDoneSound(context);
  workbenchProvider.postState();
}

function resolveWorkspaceRoot() {
  const configRoot = vscode.workspace.getConfiguration('agentToolkit').get('workspaceRoot') || '';
  const resolvedConfigRoot = configRoot ? path.resolve(configRoot) : undefined;
  const workspaceRoot =
    resolvedConfigRoot ||
    (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : process.cwd());

  return workspaceRoot;
}

class AgentContextProvider {
  constructor(workspaceRoot) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatchers();
    this._onDidChangeTreeData.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.disposeWatchers();
    this.watchers = CONTEXT_FILES.map(({ relativePath }) => watchFile(this.resolvePath(relativePath), () => this.refresh()));
    this.refresh();
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this.workspaceRoot) {
      return Promise.resolve([
        new vscode.TreeItem('No se detectó un workspace activo', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    if (element) {
      return Promise.resolve(element.children || []);
    }

    const items = CONTEXT_FILES.map((fileMeta) => this.createTreeItem(fileMeta)).filter(Boolean);

    if (items.length === 0) {
      return Promise.resolve([
        createInfoItem('Ejecuta ./agent/bootstrap.sh para generar los contextos.', 'info')
      ]);
    }

    return Promise.resolve(items);
  }

  createTreeItem({ label, description, relativePath }) {
    const absolute = this.resolvePath(relativePath);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.tooltip = absolute;

    if (fs.existsSync(absolute)) {
      item.command = {
        command: 'vscode.open',
        title: 'Abrir contexto',
        arguments: [vscode.Uri.file(absolute)]
      };
      item.iconPath = new vscode.ThemeIcon('book');
    } else {
      item.description = `${description} (pendiente)`;
      item.iconPath = new vscode.ThemeIcon('warning');
      item.tooltip = 'Archivo no encontrado. Ejecuta el bootstrap del agente.';
    }

    return item;
  }

  resolvePath(relative) {
    if (!this.workspaceRoot) {
      return relative;
    }
    return path.isAbsolute(relative) ? relative : path.join(this.workspaceRoot, relative);
  }

  openQuickPick() {
    const options = CONTEXT_FILES.map((meta) => {
      const absolute = this.resolvePath(meta.relativePath);
      const exists = fs.existsSync(absolute);
      return {
        label: meta.label,
        description: exists ? meta.description : 'Archivo pendiente de generar',
        absolute
      };
    });

    vscode.window.showQuickPick(options, { placeHolder: 'Selecciona un contexto para abrir' }).then((picked) => {
      if (picked && fs.existsSync(picked.absolute)) {
        vscode.workspace.openTextDocument(picked.absolute).then((doc) => vscode.window.showTextDocument(doc));
      } else if (picked) {
        vscode.window.showWarningMessage('El archivo aún no existe. Ejecuta los scripts del agente.');
      }
    });
  }

  disposeWatchers() {
    if (this.watchers) {
      this.watchers.forEach((watcher) => watcher && watcher.close && watcher.close());
    }
    this.watchers = [];
  }
}

class ComposerTreeProvider {
  constructor(workspaceRoot) {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatcher();
    this._onDidChangeTreeData.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.disposeWatcher();
    this.watcher = watchFile(this.getTargetPath(), () => this.refresh());
    this.refresh();
  }

  refresh() {
    this.cachedTree = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this.workspaceRoot) {
      return [];
    }

    if (element) {
      return element.children || [];
    }

    const target = this.getTargetPath();
    if (!fs.existsSync(target)) {
      return [createInfoItem('Genera agent/exports/composer_deps.json para ver dependencias.', 'info')];
    }

    if (!this.cachedTree) {
      this.cachedTree = buildComposerTree(target);
    }

    return this.cachedTree;
  }

  getTargetPath() {
    if (!this.workspaceRoot) {
      return COMPOSER_DATA_FILE;
    }
    return path.join(this.workspaceRoot, COMPOSER_DATA_FILE);
  }

  disposeWatcher() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    this.watcher = undefined;
  }
}

function buildComposerTree(targetFile) {
  try {
    const raw = fs.readFileSync(targetFile, 'utf-8');
    const data = JSON.parse(raw);
    const rootItems = toComposerNodes(data);
    return rootItems.length ? rootItems : [createInfoItem('No se encontraron dependencias en el JSON.', 'info')];
  } catch (error) {
    return [
      createInfoItem(`Error al parsear composer_deps.json: ${error.message}`, 'error')
    ];
  }
}

function toComposerNodes(data, parentKey = '') {
  if (Array.isArray(data)) {
    return data.map((entry, index) => {
      if (typeof entry === 'string') {
        return createLeaf(`${entry}`, '');
      }
      if (typeof entry === 'object') {
        const label = entry.package || entry.name || `${parentKey}[${index}]`;
        const version = entry.version || entry.pretty_version || entry.layer || '';
        const children = toComposerNodes(entry, label);
        return createBranch(label, version, children);
      }
      return createLeaf(`${entry}`, '');
    });
  }

  if (typeof data === 'object' && data !== null) {
    return Object.entries(data).map(([key, value]) => {
      if (typeof value === 'string') {
        return createLeaf(key, value);
      }
      const children = toComposerNodes(value, key);
      return createBranch(key, '', children);
    });
  }

  return [createLeaf(parentKey || 'valor', `${data}`)];
}

function createLeaf(label, description) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = description;
  item.iconPath = new vscode.ThemeIcon('symbol-namespace');
  return item;
}

function createBranch(label, description, children) {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = description;
  item.children = children;
  item.iconPath = new vscode.ThemeIcon('library');
  return item;
}

function createInfoItem(text, severity = 'info') {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  if (severity === 'error') {
    item.iconPath = new vscode.ThemeIcon('error');
  } else if (severity === 'warning') {
    item.iconPath = new vscode.ThemeIcon('warning');
  } else {
    item.iconPath = new vscode.ThemeIcon('info');
  }
  return item;
}

function registerSnippets(context, workspaceRoot) {
  const provider = new SeleniumCompletionProvider(workspaceRoot);
  const selector = [
    { language: 'javascript', scheme: 'file' },
    { language: 'typescript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
    { language: 'php', scheme: 'file' }
  ];

  selector.forEach((sel) => {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(sel, provider, '.', '$')
    );
  });

  context.subscriptions.push(provider);
  return provider;
}

class SeleniumCompletionProvider {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.cache = null;
    this.watcher = watchFile(this.getSnippetPath(), () => this.invalidate());
  }

  dispose() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    this.watcher = watchFile(this.getSnippetPath(), () => this.invalidate());
    this.invalidate();
  }

  invalidate() {
    this.cache = null;
  }

  getSnippetPath() {
    if (!this.workspaceRoot) {
      return SNIPPET_SOURCE_FILE;
    }
    return path.join(this.workspaceRoot, SNIPPET_SOURCE_FILE);
  }

  provideCompletionItems() {
    return this.getSnippets().map((snippet) => {
      const item = new vscode.CompletionItem(snippet.label, vscode.CompletionItemKind.Snippet);
      item.detail = snippet.detail;
      item.insertText = new vscode.SnippetString(snippet.insertText);
      item.documentation = snippet.documentation || snippet.detail;
      return item;
    });
  }

  getSnippets() {
    if (this.cache) {
      return this.cache;
    }

    const filePath = this.getSnippetPath();
    let snippets = [];

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        snippets = extractAnnotatedSnippets(raw);
      } catch (error) {
        console.error('No se pudieron extraer snippets del archivo', error);
      }
    }

    if (snippets.length === 0) {
      snippets = DEFAULT_SNIPPETS;
    }

    this.cache = snippets;
    return snippets;
  }
}

function extractAnnotatedSnippets(raw) {
  const snippets = [];
  const blockRegex = /@agent-snippet\s+(?<language>[a-zA-Z0-9_-]+)\s+(?<label>.+?)\s*?\n(?<body>[\s\S]*?)(?=@agent-snippet|$)/g;
  let match;

  while ((match = blockRegex.exec(raw)) !== null) {
    const language = match.groups.language.trim();
    const label = match.groups.label.trim();
    let body = match.groups.body.trim();

    if (body.startsWith('/*') && body.endsWith('*/')) {
      body = body.slice(2, -2).trim();
    }

    body = dedent(body);

    const snippetText = body.startsWith('```') ? stripCodeFence(body) : body;

    snippets.push({
      label: `selenium:${label.toLowerCase().replace(/\s+/g, '-')}`,
      detail: `Snippet definido en export_selenium_context.mjs (${language})`,
      language,
      insertText: snippetText
    });
  }

  return snippets;
}

function stripCodeFence(block) {
  const fence = block.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fence) {
    return fence[1];
  }
  return block;
}

function dedent(text) {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/)[0].length);

  const minIndent = indents.length ? Math.min(...indents) : 0;

  return lines.map((line) => line.slice(minIndent)).join('\n');
}

class DeptracDiagnostics {
  constructor(workspaceRoot) {
    this.collection = vscode.languages.createDiagnosticCollection('agentDeptrac');
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatcher();
    this.collection.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.refresh();
    this.resetWatcher();
  }

  getDeptracPath() {
    if (!this.workspaceRoot) {
      return DEPTRAC_FILE;
    }
    return path.join(this.workspaceRoot, DEPTRAC_FILE);
  }

  refresh() {
    const deptracPath = this.getDeptracPath();

    if (!fs.existsSync(deptracPath)) {
      this.collection.clear();
      return;
    }

    try {
      const raw = fs.readFileSync(deptracPath, 'utf-8');
      const payload = JSON.parse(raw);
      const violations = Array.isArray(payload.violations) ? payload.violations : [];

      const grouped = new Map();

      violations.forEach((violation) => {
        if (!violation || !violation.file) {
          return;
        }

        const filePath = path.isAbsolute(violation.file)
          ? violation.file
          : this.workspaceRoot
          ? path.join(this.workspaceRoot, violation.file)
          : violation.file;

        const uri = vscode.Uri.file(filePath);
        const diagnostics = grouped.get(uri.toString()) || [];

        const range = new vscode.Range(
          Math.max((violation.line || 1) - 1, 0),
          0,
          Math.max((violation.line || 1) - 1, 0),
          200
        );

        const diagnostic = new vscode.Diagnostic(
          range,
          violation.message || `Violación de capa (${violation.layer || 'sin capa'})`,
          vscode.DiagnosticSeverity.Warning
        );

        diagnostics.push(diagnostic);
        grouped.set(uri.toString(), diagnostics);
      });

      this.collection.clear();
      for (const [uriKey, diagnostics] of grouped.entries()) {
        this.collection.set(vscode.Uri.parse(uriKey), diagnostics);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error al leer deptrac_layers.json: ${error.message}`);
    }
  }

  resetWatcher() {
    this.disposeWatcher();
    const deptracPath = this.getDeptracPath();
    const watcher = watchFile(deptracPath, () => this.refresh());
    this.watcher = watcher;
  }

  disposeWatcher() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    this.watcher = undefined;
  }
}

class AgentWorkbenchViewProvider {
  constructor(context, workspaceRoot) {
    this.context = context;
    this.extensionUri = context.extensionUri;
    this.extensionPath = context.extensionPath;
    this.workspaceRoot = workspaceRoot;
    this.watchers = [];
    this.soundTimeout = undefined;
  }

  dispose() {
    this.disposeWatchers();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.resetWatchers();
    this.postState();
  }

  getWorkspaceRoot() {
    return this.workspaceRoot;
  }

  resolveWebviewView(webviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.joinPath(this.extensionUri, 'resources')
      ]
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    webviewView.onDidDispose(() => {
      this.disposeWatchers();
      this.webviewView = undefined;
    });
    this.resetWatchers();
    this.postState();
  }

  resetWatchers() {
    this.disposeWatchers();
    if (!this.webviewView || !this.workspaceRoot) {
      return;
    }

    const targets = new Set([
      BOOTSTRAP_SCRIPT,
      ...CONTEXT_FILES.map((meta) => meta.relativePath),
      COMPOSER_DATA_FILE,
      DEPTRAC_FILE,
      SNIPPET_SOURCE_FILE
    ]);

    targets.forEach((relativePath) => {
      const watcher = watchFile(this.resolveWorkspacePath(relativePath), () => this.handleWatchedFile(relativePath));
      if (watcher) {
        this.watchers.push(watcher);
      }
    });

    const configWatcher = watchFile(path.join(this.context.extensionPath, 'config.json'), () => this.postState());
    if (configWatcher) {
      this.watchers.push(configWatcher);
    }
  }

  disposeWatchers() {
    if (this.watchers && this.watchers.length) {
      this.watchers.forEach((watcher) => watcher && watcher.close && watcher.close());
    }
    this.watchers = [];
    if (this.soundTimeout) {
      clearTimeout(this.soundTimeout);
      this.soundTimeout = undefined;
    }
  }

  handleWatchedFile(relativePath) {
    this.postState();
    if (!relativePath || !SOUND_TRIGGER_RELATIVE_PATHS.has(relativePath)) {
      return;
    }
    this.scheduleDoneSound();
  }

  scheduleDoneSound() {
    if (this.soundTimeout) {
      clearTimeout(this.soundTimeout);
    }
    this.soundTimeout = setTimeout(() => {
      this.soundTimeout = undefined;
      void vscode.commands.executeCommand('agent.doneSound');
    }, 250);
  }

  postState() {
    if (!this.webviewView) {
      return;
    }
    const state = this.buildState();
    this.webviewView.webview.postMessage({ type: 'state', payload: state });
  }

  buildState() {
    const root = this.workspaceRoot;
    const hasWorkspace = Boolean(root);
    const bootstrapScriptPath = this.resolveWorkspacePath(BOOTSTRAP_SCRIPT);
    const snippetSourcePath = this.resolveWorkspacePath(SNIPPET_SOURCE_FILE);

    const soundInfo = this.getSoundInfo();

    const state = {
      hasWorkspace,
      workspaceRoot: root || '',
      hasBootstrapScript: hasWorkspace && fs.existsSync(bootstrapScriptPath),
      hasSeleniumContext:
        hasWorkspace &&
        fs.existsSync(this.resolveWorkspacePath(path.join('agent', 'exports', 'selenium_test_context.md'))),
      hasSeleniumNotes:
        hasWorkspace && fs.existsSync(this.resolveWorkspacePath(path.join('agent', 'notes', 'selenium-agent.md'))),
      hasComposerData: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(COMPOSER_DATA_FILE)),
      hasDeptracData: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(DEPTRAC_FILE)),
      snippetSourceExists: hasWorkspace && fs.existsSync(snippetSourcePath),
      snippetSource: SNIPPET_SOURCE_FILE,
      bootstrapScript: BOOTSTRAP_SCRIPT,
      soundSummary: soundInfo.label,
      soundReady: soundInfo.ready
    };

    return state;
  }

  getSoundInfo() {
    try {
      const config = getSoundConfig(this.context.extensionPath);
      if (config.soundFile) {
        return { label: 'Personalizado', ready: true };
      }
      if (process.platform === 'darwin') {
        return { label: 'Glass.aiff (por defecto)', ready: true };
      }
      return { label: 'Sin configurar', ready: false };
    } catch (error) {
      return { label: 'Config inválida', ready: false };
    }
  }

  async handleMessage(message) {
    if (!message || !message.command) {
      return;
    }

    switch (message.command) {
      case 'runBootstrap':
        await vscode.commands.executeCommand('agent.runBootstrap');
        this.postState();
        break;
      case 'runSeleniumExport':
        await vscode.commands.executeCommand('agent.runSeleniumExport');
        this.postState();
        break;
      case 'runDeptrac':
        await vscode.commands.executeCommand('agent.runDeptrac');
        this.postState();
        break;
      case 'openConfigurator':
        await vscode.commands.executeCommand('agent.configure');
        break;
      case 'openContexts':
        await vscode.commands.executeCommand('agentContextView.focus');
        await vscode.commands.executeCommand('agent.context.openQuickPick');
        break;
      case 'openComposer':
        await vscode.commands.executeCommand('agentComposerView.focus');
        await vscode.commands.executeCommand('agent.dependencies.refresh');
        break;
      case 'openSnippets':
        await this.openWorkspaceFile(SNIPPET_SOURCE_FILE);
        break;
      case 'openBootstrapFile':
        await this.openWorkspaceFile(BOOTSTRAP_SCRIPT);
        break;
      case 'openDocs':
        await this.openExtensionFile('README.md');
        break;
      case 'openConfig':
        await this.openExtensionFile('config.json');
        break;
      case 'playSound':
        await vscode.commands.executeCommand('agent.doneSound');
        break;
      case 'refreshState':
        this.postState();
        break;
      default:
        break;
    }
  }

  resolveWorkspacePath(relativePath) {
    if (!this.workspaceRoot) {
      return relativePath;
    }
    return path.isAbsolute(relativePath) ? relativePath : path.join(this.workspaceRoot, relativePath);
  }

  async openWorkspaceFile(relativePath) {
    if (!this.workspaceRoot) {
      vscode.window.showWarningMessage('No hay workspace configurado para el agente.');
      return;
    }
    const absolute = this.resolveWorkspacePath(relativePath);
    if (!fs.existsSync(absolute)) {
      vscode.window.showWarningMessage(`No se encontró ${relativePath}.`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(absolute);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async openExtensionFile(relativePath) {
    const absolute = path.join(this.extensionPath, relativePath);
    if (!fs.existsSync(absolute)) {
      vscode.window.showWarningMessage(`No se encontró ${relativePath} dentro de la extensión.`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(absolute);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  getHtmlForWebview(webview) {
    const nonce = getNonce();
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'agent.svg'));

    return `
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Agent Workbench</title>
          <style nonce="${nonce}">
            :root {
              color-scheme: light dark;
            }
            body {
              font-family: var(--vscode-font-family);
              font-size: var(--vscode-font-size);
              margin: 0;
              padding: 16px;
              color: var(--vscode-foreground);
              background: var(--vscode-sideBar-background);
            }
            header {
              display: flex;
              align-items: center;
              gap: 8px;
              margin-bottom: 16px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              font-size: 12px;
              color: var(--vscode-sideBarSectionHeader-foreground);
            }
            header img {
              width: 20px;
              height: 20px;
            }
            .status-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
              gap: 8px;
              margin-bottom: 16px;
            }
            .status-card {
              border: 1px solid var(--vscode-sideBarSectionHeader-border);
              border-radius: 6px;
              padding: 10px;
              background: var(--vscode-sideBarSectionHeader-background, transparent);
              display: flex;
              flex-direction: column;
              gap: 4px;
            }
            .status-title {
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
            }
            .status-value {
              font-size: 13px;
              font-weight: 600;
            }
            .status-value.ok {
              color: var(--vscode-testing-iconPassed);
            }
            .status-value.missing {
              color: var(--vscode-editorWarning-foreground);
            }
            .actions {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            button {
              appearance: none;
              border: 1px solid var(--vscode-button-border, transparent);
              background: var(--vscode-button-secondaryBackground);
              color: var(--vscode-button-secondaryForeground);
              border-radius: 6px;
              padding: 10px 12px;
              text-align: left;
              font-size: 13px;
              cursor: pointer;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            button.primary {
              background: var(--vscode-button-background);
              color: var(--vscode-button-foreground);
            }
            button:hover {
              filter: brightness(1.05);
            }
            footer {
              margin-top: 18px;
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
            }
            .tag {
              padding: 2px 6px;
              border-radius: 999px;
              font-size: 11px;
              border: 1px solid transparent;
            }
            .tag.ok {
              color: var(--vscode-testing-iconPassed);
              border-color: var(--vscode-testing-iconPassed);
            }
            .tag.missing {
              color: var(--vscode-editorWarning-foreground);
              border-color: var(--vscode-editorWarning-foreground);
            }
          </style>
        </head>
        <body>
          <header>
            <img src="${iconUri}" alt="Agent icon" />
            <span>Agent Toolkit</span>
          </header>
          <section class="status-grid">
            <div class="status-card">
              <div class="status-title">Workspace</div>
              <div id="status-workspace" class="status-value missing">No configurado</div>
            </div>
            <div class="status-card">
              <div class="status-title">bootstrap.sh</div>
              <div id="status-bootstrap" class="status-value missing">Pendiente</div>
            </div>
            <div class="status-card">
              <div class="status-title">Contexto Selenium</div>
              <div id="status-context" class="status-value missing">Pendiente</div>
            </div>
            <div class="status-card">
              <div class="status-title">Dependencias Composer</div>
              <div id="status-composer" class="status-value missing">Pendiente</div>
            </div>
            <div class="status-card">
              <div class="status-title">Deptrac</div>
              <div id="status-deptrac" class="status-value missing">Pendiente</div>
            </div>
            <div class="status-card">
              <div class="status-title">Snippets Selenium</div>
              <div id="status-snippets" class="status-value missing">Pendiente</div>
            </div>
            <div class="status-card">
              <div class="status-title">Sonido</div>
              <div id="status-sound" class="status-value missing">Sin configurar</div>
            </div>
          </section>

          <section class="actions">
            <button class="primary" data-command="runBootstrap">Ejecutar ./agent/bootstrap.sh</button>
            <button data-command="runSeleniumExport">Exportar contexto Selenium</button>
            <button data-command="runDeptrac">Ejecutar análisis Deptrac</button>
            <button data-command="openConfigurator">Configurar extensión…</button>
            <button data-command="openContexts">Abrir contextos</button>
            <button data-command="openComposer">Abrir dependencias</button>
            <button data-command="openSnippets">Editar snippets Selenium</button>
            <button data-command="openBootstrapFile">Abrir bootstrap.sh</button>
            <button data-command="openDocs">Ver documentación</button>
            <button data-command="openConfig">Editar config.json</button>
            <button data-command="playSound">Probar sonido</button>
          </section>

          <footer>
            Los botones ejecutan los scripts dentro del workspace configurado. Asegúrate de revisar la terminal “Agent Toolkit”.
          </footer>

          <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const statusElements = {
              workspace: document.getElementById('status-workspace'),
              bootstrap: document.getElementById('status-bootstrap'),
              context: document.getElementById('status-context'),
              composer: document.getElementById('status-composer'),
              deptrac: document.getElementById('status-deptrac'),
              snippets: document.getElementById('status-snippets'),
              sound: document.getElementById('status-sound')
            };

            function setStatus(element, okText, missingText, condition) {
              if (!element) {
                return;
              }
              element.textContent = condition ? okText : missingText;
              element.classList.toggle('ok', condition);
              element.classList.toggle('missing', !condition);
            }

            window.addEventListener('message', (event) => {
              const message = event.data;
              if (!message || message.type !== 'state') {
                return;
              }

              const state = message.payload;
              setStatus(statusElements.workspace, state.workspaceRoot || 'Configurado', 'No configurado', state.hasWorkspace);
              setStatus(statusElements.bootstrap, 'Disponible', 'Pendiente', state.hasBootstrapScript);
              setStatus(statusElements.context, 'Generado', 'Pendiente', state.hasSeleniumContext && state.hasSeleniumNotes);
              setStatus(statusElements.composer, 'Listo', 'Pendiente', state.hasComposerData);
              setStatus(statusElements.deptrac, 'Listo', 'Pendiente', state.hasDeptracData);
              setStatus(statusElements.snippets, 'Listo', 'Pendiente', state.snippetSourceExists);
              setStatus(statusElements.sound, state.soundSummary, state.soundSummary, state.soundReady);
            });

            document.querySelectorAll('button[data-command]').forEach((button) => {
              button.addEventListener('click', () => {
                const command = button.getAttribute('data-command');
                vscode.postMessage({ command });
              });
            });

            vscode.postMessage({ command: 'refreshState' });
          </script>
        </body>
      </html>
    `;
  }
}

async function openConfigurationUI(context) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = 'Configurar Agent Toolkit';
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.items = [
    {
      label: '$(folder) Seleccionar Workspace Root…',
      description: 'Apunta la extensión al directorio donde viven los archivos de agent.',
      action: 'workspaceRoot'
    },
    {
      label: '$(close) Limpiar Workspace Root',
      description: 'Vuelve a usar la carpeta raíz del workspace abierto.',
      action: 'workspaceRootClear'
    },
    {
      label: '$(file-media) Elegir archivo de sonido…',
      description: 'Selecciona un archivo local para el aviso de finalización.',
      action: 'soundFile'
    },
    {
      label: '$(mute) Usar sonido por defecto',
      description: 'Restablece la ruta de sonido configurada.',
      action: 'soundFileClear'
    },
    {
      label: '$(comment) Cambiar mensaje de notificación…',
      description: 'Texto que aparece junto al sonido de finalización.',
      action: 'soundMessage'
    },
    {
      label: '$(history) Restaurar mensaje por defecto',
      description: 'Vuelve al mensaje “🔔 El agente terminó su trabajo”.',
      action: 'soundMessageClear'
    },
    {
      label: '$(megaphone) Probar sonido',
      description: 'Reproduce inmediatamente el sonido configurado.',
      action: 'playSound'
    },
    {
      label: '$(book) Abrir documentación de la extensión',
      description: 'Muestra README.md para consultar instrucciones completas.',
      action: 'openDocs'
    },
    {
      label: '$(settings) Abrir config.json interno',
      description: 'Permite editar el fallback usado por la extensión.',
      action: 'openConfig'
    }
  ];

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    quickPick.hide();
    if (selected) {
      await handleConfigurationAction(selected.action, context);
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function handleConfigurationAction(action, context) {
  const settings = vscode.workspace.getConfiguration('agentToolkit');
  switch (action) {
    case 'workspaceRoot': {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: 'Selecciona la carpeta raíz de agent-kit'
      });
      if (result && result[0]) {
        await settings.update('workspaceRoot', result[0].fsPath, true);
        vscode.window.showInformationMessage('Workspace Root actualizado.');
      }
      break;
    }
    case 'workspaceRootClear': {
      await settings.update('workspaceRoot', '', true);
      vscode.window.showInformationMessage('Workspace Root restablecido al valor por defecto.');
      break;
    }
    case 'soundFile': {
      const result = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        title: 'Selecciona el archivo de sonido',
        filters: {
          Audio: ['mp3', 'wav', 'aiff', 'm4a']
        }
      });
      if (result && result[0]) {
        await settings.update('soundFile', result[0].fsPath, true);
        clearSoundConfigCache();
        vscode.window.showInformationMessage('Archivo de sonido actualizado.');
      }
      break;
    }
    case 'soundFileClear': {
      await settings.update('soundFile', '', true);
      clearSoundConfigCache();
      vscode.window.showInformationMessage('Se restableció el sonido por defecto.');
      break;
    }
    case 'soundMessage': {
      const current = settings.get('soundMessage') || '🔔 El agente terminó su trabajo';
      const value = await vscode.window.showInputBox({
        prompt: 'Mensaje que se mostrará cuando el agente termine.',
        value: current,
        placeHolder: current
      });
      if (value !== undefined) {
        await settings.update('soundMessage', value, true);
        clearSoundConfigCache();
        vscode.window.showInformationMessage('Mensaje actualizado.');
      }
      break;
    }
    case 'soundMessageClear': {
      await settings.update('soundMessage', undefined, true);
      clearSoundConfigCache();
      vscode.window.showInformationMessage('Mensaje restablecido.');
      break;
    }
    case 'playSound': {
      await vscode.commands.executeCommand('agent.doneSound');
      break;
    }
    case 'openDocs': {
      const docPath = path.join(context.extensionPath, 'README.md');
      if (fs.existsSync(docPath)) {
        const doc = await vscode.workspace.openTextDocument(docPath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        vscode.window.showWarningMessage('No se encontró README.md dentro de la extensión.');
      }
      break;
    }
    case 'openConfig': {
      const configPath = path.join(context.extensionPath, 'config.json');
      if (fs.existsSync(configPath)) {
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc, { preview: false });
      } else {
        vscode.window.showWarningMessage('No se encontró config.json dentro de la extensión.');
      }
      break;
    }
    default:
      break;
  }
}

async function runBootstrapScript(workspaceRoot, workbenchProvider) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const scriptPath = resolveWorkspacePath(workspaceRoot, BOOTSTRAP_SCRIPT);
  if (!fs.existsSync(scriptPath)) {
    vscode.window.showWarningMessage('No se encontró ./agent/bootstrap.sh en el workspace actual.');
    return;
  }

  runCommandsInTerminal(workspaceRoot, ['chmod +x ./agent/bootstrap.sh', './agent/bootstrap.sh'], {
    announce: 'Ejecutando ./agent/bootstrap.sh en la terminal Agent Toolkit…'
  });

  refreshWorkbenchSoon(workbenchProvider);
}

async function runSeleniumExport(workspaceRoot, workbenchProvider) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const scriptPath = resolveWorkspacePath(workspaceRoot, SNIPPET_SOURCE_FILE);
  if (!fs.existsSync(scriptPath)) {
    vscode.window.showWarningMessage('No se encontró agent/scripts/export_selenium_context.mjs.');
    return;
  }

  runCommandsInTerminal(workspaceRoot, ['node agent/scripts/export_selenium_context.mjs'], {
    announce: 'Exportando contexto Selenium…'
  });

  refreshWorkbenchSoon(workbenchProvider);
}

async function runDeptracScript(workspaceRoot, workbenchProvider) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const scriptPath = resolveWorkspacePath(workspaceRoot, path.join('agent', 'scripts', 'run_deptrac.sh'));
  if (!fs.existsSync(scriptPath)) {
    vscode.window.showWarningMessage('No se encontró agent/scripts/run_deptrac.sh.');
    return;
  }

  runCommandsInTerminal(
    workspaceRoot,
    ['chmod +x ./agent/scripts/run_deptrac.sh', './agent/scripts/run_deptrac.sh'],
    {
      announce: 'Ejecutando análisis Deptrac…'
    }
  );

  refreshWorkbenchSoon(workbenchProvider);
}

function refreshWorkbenchSoon(workbenchProvider) {
  if (!workbenchProvider || typeof workbenchProvider.postState !== 'function') {
    return;
  }
  setTimeout(() => workbenchProvider.postState(), 500);
}

function runCommandsInTerminal(workspaceRoot, commands, options = {}) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const terminal = getAgentTerminal(options.name || 'Agent Toolkit');
  terminal.show(true);
  terminal.sendText(`cd "${workspaceRoot}"`, true);
  commands.forEach((command) => terminal.sendText(command, true));

  if (options.announce) {
    vscode.window.showInformationMessage(options.announce);
  }

  return terminal;
}

function getAgentTerminal(name) {
  if (agentTerminal) {
    return agentTerminal;
  }

  agentTerminal = vscode.window.createTerminal({
    name: name || 'Agent Toolkit'
  });

  return agentTerminal;
}

function assertWorkspaceRoot(workspaceRoot) {
  if (workspaceRoot) {
    return true;
  }

  vscode.window.showWarningMessage('Configura un workspace root primero desde Agent: Configurar extensión.');
  return false;
}

function resolveWorkspacePath(workspaceRoot, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.join(workspaceRoot, targetPath);
}

function registerDoneSound(context) {
  const disposable = vscode.commands.registerCommand('agent.doneSound', async () => {
    try {
      const config = getSoundConfig(context.extensionPath);
      const soundFile = getSoundFilePath(config.soundFile, context.extensionPath);
      const message = config.message || '🔔 El agente terminó su trabajo';
      vscode.window.showInformationMessage(message);
      await playSound(soundFile);
    } catch (e) {
      const errorMessage =
        e && typeof e.message === 'string'
          ? `⚠️ ${e.message}`
          : '⚠️ No se pudo reproducir el sonido.';
      vscode.window.showErrorMessage(errorMessage);
    }
  });

  context.subscriptions.push(disposable);
}

let cachedSoundConfig = null;

function getSoundConfig(extensionRoot) {
  if (cachedSoundConfig) {
    return cachedSoundConfig;
  }

  const configPath = path.join(extensionRoot, 'config.json');
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (error) {
      vscode.window.showWarningMessage(`Config de sonido inválida: ${error.message}`);
    }
  }

  const settings = vscode.workspace.getConfiguration('agentToolkit');
  const merged = {
    soundFile: settings.get('soundFile') || fileConfig.soundFile || '',
    message: settings.get('soundMessage') || fileConfig.message || '🔔 El agente terminó su trabajo'
  };

  cachedSoundConfig = merged;
  return merged;
}

function clearSoundConfigCache() {
  cachedSoundConfig = null;
}

function getSoundFilePath(configuredPath, extensionRoot) {
  const platform = process.platform;
  const defaultSound =
    platform === 'darwin'
      ? '/System/Library/Sounds/Glass.aiff'
      : configuredPath;

  const candidate = configuredPath || defaultSound;

  if (!candidate) {
    throw new Error('No se ha definido un archivo de sonido.');
  }

  const expanded = candidate.startsWith('~')
    ? path.join(os.homedir(), candidate.slice(1).replace(/^[\\/]/, ''))
    : candidate;

  const normalized = path.isAbsolute(expanded)
    ? expanded
    : path.join(extensionRoot, expanded);

  if (!fs.existsSync(normalized)) {
    throw new Error('No se encontró el archivo de sonido configurado.');
  }

  return normalized;
}

function playSound(soundFile) {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    const { command, args } = getPlayerCommand(platform, soundFile);

    if (!command) {
      reject(new Error('La plataforma actual no es compatible.'));
      return;
    }

    const child = spawn(command, args, { stdio: 'ignore' });

    child.once('error', () => {
      reject(new Error('No se pudo reproducir el sonido.'));
    });

    child.once('close', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error('El reproductor de sonido terminó con errores.'));
    });
  });
}

function getPlayerCommand(platform, soundFile) {
  if (platform === 'darwin') {
    return { command: '/usr/bin/afplay', args: [soundFile] };
  }

  if (platform === 'linux') {
    return { command: 'paplay', args: [soundFile] };
  }

  if (platform === 'win32') {
    const escapedPath = soundFile.replace(/"/g, '""');
    const script = [
      '$player = New-Object System.Media.SoundPlayer',
      `$player.SoundLocation = "${escapedPath}"`,
      '$player.Load()',
      '$player.PlaySync()'
    ].join('; ');

    return { command: 'powershell', args: ['-NoProfile', '-Command', script] };
  }

  return { command: null, args: [] };
}

function watchFile(filePath, callback) {
  if (!filePath) {
    return null;
  }

  try {
    const dir = fs.existsSync(filePath) ? path.dirname(filePath) : path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      return null;
    }

    const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      if (!filename) {
        callback();
        return;
      }

      if (filename === path.basename(filePath)) {
        callback();
      }
    });

    return watcher;
  } catch (error) {
    console.warn(`No se pudo observar cambios en ${filePath}: ${error.message}`);
    return null;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 16; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
