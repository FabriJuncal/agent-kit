const vscode = require('vscode');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const sound = require('./lib/sound');

const PRESETS_ROOT = 'resources/presets';
const CUSTOM_ACTIONS_FILE = path.join('agent', 'custom_actions.json');
const SELENIUM_MODULES_FILE = path.join('agent', 'exports', 'selenium_modules.json');
const SELENIUM_RUNNER = path.join('agent', 'scripts', 'run_selenium_tests.sh');
const SELENIUM_RUNNER_ASSET = path.join('resources', 'assets', 'run_selenium_tests.sh');
const DEFAULT_PROMPT_RUNNER = 'cursor agent --prompt "{prompt}"';
const AI_AGENT_SECRET_PREFIX = 'agentToolkit.aiAgent';

const AI_AGENT_CATALOG = [
  {
    id: 'codex',
    label: 'Codex CLI',
    description: 'Utiliza la CLI oficial de Codex (requiere "codex auth login").',
    requiresCliLogin: true,
    defaultRunner: 'codex generate -m code-1 --prompt "{prompt}"'
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    description: 'Requiere una API key para usar openai api responses.create.',
    credentialFields: [
      {
        id: 'apiKey',
        label: 'OPENAI_API_KEY',
        placeholder: 'sk-xxxx',
        secret: true
      }
    ],
    envMapping: {
      OPENAI_API_KEY: 'apiKey'
    },
    defaultRunner: 'npx openai responses.create -i "{prompt}"'
  },
  {
    id: 'custom',
    label: 'Agente personalizado',
    description: 'Define tu propio proveedor, variable de entorno y runner.',
    custom: true
  }
];

class AiAuthManager {
  constructor(context) {
    this.context = context;
  }

  getProviderById(id) {
    return AI_AGENT_CATALOG.find((provider) => provider.id === id);
  }

  getProviderChoices() {
    return AI_AGENT_CATALOG.map((provider) => ({
      id: provider.id,
      label: provider.label,
      description: provider.description
    }));
  }

  getMetadataKey(workspaceRoot) {
    return `${AI_AGENT_SECRET_PREFIX}:meta:${workspaceRoot || 'global'}`;
  }

  getSecretKey(workspaceRoot) {
    return `${AI_AGENT_SECRET_PREFIX}:secret:${workspaceRoot || 'global'}`;
  }

  async configure(workspaceRoot) {
    if (!assertWorkspaceRoot(workspaceRoot)) {
      return null;
    }

    const pick = await vscode.window.showQuickPick(
      this.getProviderChoices().map((provider) => ({
        label: provider.label,
        description: provider.description,
        providerId: provider.id
      })),
      { placeHolder: 'Selecciona el agente de IA que deseas usar', matchOnDescription: true }
    );

    if (!pick) {
      return null;
    }

    const provider = this.getProviderById(pick.providerId);
    if (!provider) {
      vscode.window.showWarningMessage('El agente seleccionado no está disponible.');
      return null;
    }

    const metadata = {
      providerId: provider.id,
      providerLabel: provider.label,
      envMapping: provider.envMapping ? { ...provider.envMapping } : {},
      defaultRunner: provider.defaultRunner || DEFAULT_PROMPT_RUNNER,
      custom: Boolean(provider.custom)
    };

    const secretValues = {};

    if (provider.requiresCliLogin) {
      const loggedIn = await ensureCodexSession(workspaceRoot);
      if (!loggedIn) {
        vscode.window.showWarningMessage('No se pudo validar la sesión de Codex. Intenta nuevamente.');
        return null;
      }
    }

    if (provider.custom) {
      const customLabel = await vscode.window.showInputBox({
        prompt: 'Nombre para identificar a tu agente de IA',
        placeHolder: 'Mi agente corporativo'
      });
      if (!customLabel) {
        return null;
      }
      metadata.providerLabel = customLabel;

      const envName = await vscode.window.showInputBox({
        prompt: 'Nombre de la variable de entorno que recibirá el token',
        placeHolder: 'AGENT_AI_TOKEN',
        value: 'AGENT_AI_TOKEN'
      });
      if (!envName) {
        return null;
      }
      metadata.envMapping = { [envName.trim()]: 'token' };

      const runner = await vscode.window.showInputBox({
        prompt: 'Comando predeterminado para enviar prompts',
        placeHolder: DEFAULT_PROMPT_RUNNER,
        value: DEFAULT_PROMPT_RUNNER
      });
      if (runner) {
        metadata.defaultRunner = runner.trim();
      }

      const token = await vscode.window.showInputBox({
        prompt: 'Token o credencial para tu agente',
        password: true,
        placeHolder: 'token-super-secreto'
      });
      if (!token) {
        return null;
      }
      secretValues.token = token.trim();
    } else {
      for (const field of provider.credentialFields || []) {
        const value = await vscode.window.showInputBox({
          prompt: field.label,
          placeHolder: field.placeholder || '',
          password: field.secret !== false,
          ignoreFocusOut: true
        });
        if (!value) {
          return null;
        }
        secretValues[field.id] = value.trim();
      }
    }

    await this.persistSession(workspaceRoot, metadata, secretValues);
    return metadata;
  }

  async clear(workspaceRoot) {
    await this.context.workspaceState.update(this.getMetadataKey(workspaceRoot), undefined);
    await this.context.secrets.delete(this.getSecretKey(workspaceRoot));
  }

  getSummary(workspaceRoot) {
    const metadata = this.context.workspaceState.get(this.getMetadataKey(workspaceRoot));
    if (!metadata) {
      return { connected: false, label: 'Sin agente IA configurado' };
    }
    return {
      connected: true,
      label: metadata.providerLabel || metadata.providerId,
      providerId: metadata.providerId
    };
  }

  getDefaultRunner(workspaceRoot) {
    const metadata = this.context.workspaceState.get(this.getMetadataKey(workspaceRoot));
    return metadata && metadata.defaultRunner ? metadata.defaultRunner : undefined;
  }

  async getSession(workspaceRoot) {
    const metadata = this.context.workspaceState.get(this.getMetadataKey(workspaceRoot));
    if (!metadata) {
      return null;
    }
    const secretKey = this.getSecretKey(workspaceRoot);
    const stored = await this.context.secrets.get(secretKey);
    if (!stored) {
      return null;
    }
    let payload;
    try {
      payload = JSON.parse(stored);
    } catch (error) {
      console.warn('No se pudieron parsear las credenciales de IA', error);
      return null;
    }
    if (!payload || payload.providerId !== metadata.providerId) {
      return null;
    }

    const env = {};
    Object.entries(metadata.envMapping || {}).forEach(([envName, fieldId]) => {
      const value = payload.values ? payload.values[fieldId] : undefined;
      if (value) {
        env[envName] = value;
      }
    });

    return {
      metadata,
      env,
      runner: metadata.defaultRunner || DEFAULT_PROMPT_RUNNER
    };
  }

  async persistSession(workspaceRoot, metadata, secretValues) {
    await this.context.workspaceState.update(this.getMetadataKey(workspaceRoot), metadata);
    await this.context.secrets.store(
      this.getSecretKey(workspaceRoot),
      JSON.stringify({ providerId: metadata.providerId, values: secretValues || {} })
    );
  }
}

class PresetManager {
  constructor(context, workspaceRoot) {
    this.context = context;
    this.extensionPath = context.extensionPath;
    this.workspaceRoot = workspaceRoot;
    this.presets = this.loadPresets();
    this.currentPreset = undefined;
    this._onDidChangePreset = new vscode.EventEmitter();
    this.onDidChangePreset = this._onDidChangePreset.event;
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this._onDidChangePreset.dispose();
  }

  loadPresets() {
    const presetsDir = path.join(this.extensionPath, PRESETS_ROOT);
    if (!fs.existsSync(presetsDir)) {
      return [];
    }

    const entries = fs.readdirSync(presetsDir, { withFileTypes: true });
    const presets = [];

    entries.forEach((entry) => {
      if (!entry.isDirectory()) {
        return;
      }

      const presetRoot = path.join(presetsDir, entry.name);
      const manifestPath = path.join(presetRoot, 'manifest.json');

      if (!fs.existsSync(manifestPath)) {
        return;
      }

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const templateDir = manifest.templateDir || '.';
        const contextFiles = manifest.contextFiles || [];
        const explicitWatchFiles = manifest.watchFiles || [];
        const watchFiles = Array.from(
          new Set([
            ...explicitWatchFiles,
            ...contextFiles.map((entry) => entry.relativePath).filter(Boolean)
          ])
        );

        presets.push({
          ...manifest,
          rootPath: presetRoot,
          templatePath: path.join(presetRoot, templateDir),
          contextFiles,
          watchFiles,
          tasks: manifest.tasks || [],
          commands: manifest.commands || {},
          data: manifest.data || {},
          defaultSnippets: manifest.defaultSnippets || []
        });
      } catch (error) {
        console.warn(`No se pudo cargar el manifest del preset ${entry.name}: ${error.message}`);
      }
    });

    return presets.sort((a, b) => a.name.localeCompare(b.name));
  }

  setWorkspaceRoot(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    const resolved = this.resolvePreset();
    this.updateCurrentPreset(resolved);
  }

  async selectPreset(id) {
    const configuration = vscode.workspace.getConfiguration('agentToolkit');
    await configuration.update('preset', id || '', true);
    this.updateCurrentPreset(this.findPresetById(id) || this.detectPreset() || this.getDefaultPreset());
  }

  updateCurrentPreset(preset) {
    const nextPreset = preset || this.getDefaultPreset();
    const changed = !this.currentPreset || !nextPreset || this.currentPreset.id !== nextPreset.id;
    this.currentPreset = nextPreset;
    if (changed) {
      this._onDidChangePreset.fire(this.currentPreset);
    }
  }

  resolvePreset() {
    const configuration = vscode.workspace.getConfiguration('agentToolkit');
    const configuredId = configuration.get('preset');
    if (configuredId) {
      const preset = this.findPresetById(configuredId);
      if (preset) {
        return preset;
      }
    }
    return this.detectPreset() || this.getDefaultPreset();
  }

  detectPreset() {
    if (!this.workspaceRoot) {
      return undefined;
    }

    return this.presets.find((preset) => this.matchesWorkspace(preset, this.workspaceRoot));
  }

  matchesWorkspace(preset, workspaceRoot) {
    const detection = preset.detection || {};
    const requiredFiles = detection.requiredFiles || [];

    return requiredFiles.every((relativePath) => {
      const target = path.join(workspaceRoot, relativePath);
      return fs.existsSync(target);
    });
  }

  findPresetById(id) {
    if (!id) {
      return undefined;
    }
    return this.presets.find((preset) => preset.id === id);
  }

  getDefaultPreset() {
    return this.presets[0];
  }

  getPreset() {
    return this.currentPreset || this.getDefaultPreset();
  }

  getPresetSummary() {
    const preset = this.getPreset();
    return preset
      ? { id: preset.id, name: preset.name, description: preset.description || '' }
      : undefined;
  }

  getContextFiles() {
    const preset = this.getPreset();
    return preset ? preset.contextFiles : [];
  }

  getWatchFiles() {
    const preset = this.getPreset();
    return preset ? preset.watchFiles : [];
  }

  getTasks() {
    const preset = this.getPreset();
    return preset ? preset.tasks : [];
  }

  getCommandDefinition(commandId) {
    const preset = this.getPreset();
    if (!preset || !preset.commands) {
      return undefined;
    }
    return preset.commands[commandId];
  }

  getData(pathKey) {
    const preset = this.getPreset();
    return preset && preset.data ? preset.data[pathKey] : undefined;
  }

  getBootstrapScript() {
    return this.getData('bootstrapScript');
  }

  getComposerDataFile() {
    return this.getData('composerData');
  }

  getDeptracFile() {
    return this.getData('deptracFile');
  }

  getSnippetSourceFile() {
    return this.getData('snippetSource');
  }

  getDefaultSnippets() {
    const preset = this.getPreset();
    return preset ? preset.defaultSnippets : [];
  }

  getTemplatePath(id) {
    const preset = this.findPresetById(id);
    return preset ? preset.templatePath : undefined;
  }

  getPresetChoices() {
    return this.presets.map((preset) => ({
      id: preset.id,
      label: preset.name,
      description: preset.description,
      detail: preset.id
    }));
  }
}

let agentTerminal;
let aiAuthManager;
let globalWorkbenchProvider;

function activate(context) {
  let currentWorkspaceRoot = resolveWorkspaceRoot();

  aiAuthManager = new AiAuthManager(context);
  const presetManager = new PresetManager(context, currentWorkspaceRoot);

  const contextProvider = new AgentContextProvider(currentWorkspaceRoot, presetManager);
  const composerProvider = new ComposerTreeProvider(currentWorkspaceRoot, presetManager);
  const snippetProvider = registerSnippets(context, currentWorkspaceRoot, presetManager);
  const deptracDiagnostics = new DeptracDiagnostics(currentWorkspaceRoot, presetManager);
  const workbenchProvider = new AgentWorkbenchViewProvider(
    context,
    currentWorkspaceRoot,
    presetManager,
    aiAuthManager
  );
  globalWorkbenchProvider = workbenchProvider;

  const updateWorkspaceRoot = (newRoot) => {
    currentWorkspaceRoot = newRoot;
    presetManager.setWorkspaceRoot(newRoot);
    contextProvider.setWorkspaceRoot(newRoot);
    composerProvider.setWorkspaceRoot(newRoot);
    snippetProvider.setWorkspaceRoot(newRoot);
    deptracDiagnostics.setWorkspaceRoot(newRoot);
    workbenchProvider.setWorkspaceRoot(newRoot);
  };

  context.subscriptions.push(
    presetManager,
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
    vscode.commands.registerCommand('agent.configure', () =>
      openConfigurationUI(context, presetManager, workbenchProvider, aiAuthManager)
    ),
    vscode.commands.registerCommand('agent.customActions.configure', () =>
      configureCustomActions(currentWorkspaceRoot, workbenchProvider, aiAuthManager)
    ),
    vscode.commands.registerCommand('agent.ai.configure', () =>
      configureAiAgent(currentWorkspaceRoot, aiAuthManager, workbenchProvider)
    ),
    vscode.commands.registerCommand('agent.runBootstrap', () =>
      runPresetCommand('agent.runBootstrap', currentWorkspaceRoot, presetManager, {
        workbenchProvider,
        snippetProvider
      })
    ),
    vscode.commands.registerCommand('agent.runSeleniumExport', () =>
      runPresetCommand('agent.runSeleniumExport', currentWorkspaceRoot, presetManager, {
        workbenchProvider,
        snippetProvider
      })
    ),
    vscode.commands.registerCommand('agent.runDeptrac', () =>
      runPresetCommand('agent.runDeptrac', currentWorkspaceRoot, presetManager, {
        workbenchProvider,
        snippetProvider
      })
    ),
    vscode.commands.registerCommand('agent.runCustomAction', (actionId) =>
      runCustomAction(currentWorkspaceRoot, actionId, aiAuthManager)
    ),
    vscode.commands.registerCommand('agent.runSeleniumModules', () =>
      runSeleniumModules(currentWorkspaceRoot)
    ),
    vscode.commands.registerCommand('agent.installAgentKit', () =>
      installAgentKit(context, currentWorkspaceRoot, presetManager, aiAuthManager, {
        workbenchProvider,
        contextProvider,
        composerProvider,
        snippetProvider,
        deptracDiagnostics
      })
    ),
    vscode.commands.registerCommand('agent.reinstallAgentKit', () =>
      installAgentKit(
        context,
        currentWorkspaceRoot,
        presetManager,
        aiAuthManager,
        {
          workbenchProvider,
          contextProvider,
          composerProvider,
          snippetProvider,
          deptracDiagnostics
        },
        { reinstall: true }
      )
    ),
    vscode.commands.registerCommand('agent.cleanAgentKit', () =>
      cleanAgentKit(currentWorkspaceRoot, {
        workbenchProvider,
        contextProvider,
        composerProvider,
        snippetProvider,
        deptracDiagnostics
      })
    ),
    vscode.commands.registerCommand('agent.scaffoldAgent', () =>
      scaffoldAgentDirectory(context, currentWorkspaceRoot, presetManager, {
        workbenchProvider,
        contextProvider,
        composerProvider,
        snippetProvider,
        deptracDiagnostics
      })
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('agentToolkit.workspaceRoot')) {
        const newRoot = resolveWorkspaceRoot();
        updateWorkspaceRoot(newRoot);
      }
      if (event.affectsConfiguration('agentToolkit.preset')) {
        const configuredPreset = vscode.workspace.getConfiguration('agentToolkit').get('preset') || '';
        const currentPreset = presetManager.getPresetSummary();
        const currentId = currentPreset ? currentPreset.id : '';
        if (configuredPreset !== currentId) {
          void presetManager.selectPreset(configuredPreset);
        }
      }
      if (event.affectsConfiguration('agentToolkit.soundFile') || event.affectsConfiguration('agentToolkit.soundMessage')) {
        sound.clearSoundConfigCache(context.extensionPath);
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
  constructor(workspaceRoot, presetManager) {
    this.presetManager = presetManager;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.watchers = [];
    this.presetSubscription = this.presetManager.onDidChangePreset(() => this.handlePresetChanged());
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatchers();
    if (this.presetSubscription) {
      this.presetSubscription.dispose();
    }
    this._onDidChangeTreeData.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.resetWatchers();
    this.refresh();
  }

  resetWatchers() {
    this.disposeWatchers();
    const contextFiles = this.presetManager.getContextFiles();
    this.watchers = contextFiles
      .map(({ relativePath }) => watchFile(this.resolvePath(relativePath), () => this.refresh()))
      .filter(Boolean);
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

    const contextFiles = this.presetManager.getContextFiles();
    if (!contextFiles.length) {
      return Promise.resolve([createInfoItem('Este preset no define contextos automáticos.', 'info')]);
    }

    const items = contextFiles.map((fileMeta) => this.createTreeItem(fileMeta)).filter(Boolean);
    return Promise.resolve(
      items.length ? items : [createInfoItem('Genera los archivos de contexto desde el bootstrap.', 'info')]
    );
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
    const contextFiles = this.presetManager.getContextFiles();
    if (!contextFiles.length) {
      vscode.window.showInformationMessage('El preset activo no define contextos automáticos.');
      return;
    }

    const options = contextFiles.map((meta) => {
      const absolute = this.resolvePath(meta.relativePath);
      const exists = fs.existsSync(absolute);
      return {
        label: meta.label,
        description: exists ? meta.description : 'Archivo pendiente de generar',
        absolute,
        exists
      };
    });

    vscode.window
      .showQuickPick(options, { placeHolder: 'Selecciona un contexto para abrir' })
      .then((picked) => {
        if (!picked) {
          return;
        }
        if (!picked.exists) {
          vscode.window.showWarningMessage('El archivo aún no existe. Ejecuta los scripts del agente.');
          return;
        }
        vscode.workspace.openTextDocument(picked.absolute).then((doc) => vscode.window.showTextDocument(doc));
      });
  }

  disposeWatchers() {
    if (this.watchers) {
      this.watchers.forEach((watcher) => watcher && watcher.close && watcher.close());
    }
    this.watchers = [];
  }

  handlePresetChanged() {
    this.resetWatchers();
    this.refresh();
  }
}

class ComposerTreeProvider {
  constructor(workspaceRoot, presetManager) {
    this.presetManager = presetManager;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.presetSubscription = this.presetManager.onDidChangePreset(() => this.handlePresetChanged());
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatcher();
    if (this.presetSubscription) {
      this.presetSubscription.dispose();
    }
    this._onDidChangeTreeData.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.resetWatcher();
    this.refresh();
  }

  resetWatcher() {
    this.disposeWatcher();
    const targetPath = this.getTargetPath();
    if (!targetPath) {
      return;
    }
    this.watcher = watchFile(targetPath, () => this.refresh());
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
    if (!target) {
      return [createInfoItem('El preset activo no define dependencias Composer.', 'info')];
    }

    if (!fs.existsSync(target)) {
      return [createInfoItem(`${target} pendiente de generar.`, 'info')];
    }

    if (!this.cachedTree) {
      this.cachedTree = buildComposerTree(target);
    }

    return this.cachedTree;
  }

  getTargetPath() {
    const relative = this.presetManager.getComposerDataFile();
    if (!relative) {
      return undefined;
    }

    if (!this.workspaceRoot) {
      return path.isAbsolute(relative) ? relative : path.join('.', relative);
    }

    return path.isAbsolute(relative) ? relative : path.join(this.workspaceRoot, relative);
  }

  disposeWatcher() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    this.watcher = undefined;
  }

  handlePresetChanged() {
    this.resetWatcher();
    this.refresh();
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

function registerSnippets(context, workspaceRoot, presetManager) {
  const provider = new PresetCompletionProvider(workspaceRoot, presetManager);
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

class PresetCompletionProvider {
  constructor(workspaceRoot, presetManager) {
    this.workspaceRoot = workspaceRoot;
    this.presetManager = presetManager;
    this.cache = null;
    this.watcher = undefined;
    this.presetSubscription = this.presetManager.onDidChangePreset(() => this.handlePresetChanged());
    this.resetWatcher();
  }

  dispose() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    if (this.presetSubscription) {
      this.presetSubscription.dispose();
    }
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.resetWatcher();
    this.invalidate();
  }

  resetWatcher() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    const snippetPath = this.getSnippetPath();
    if (snippetPath) {
      this.watcher = watchFile(snippetPath, () => this.invalidate());
    } else {
      this.watcher = undefined;
    }
  }

  invalidate() {
    this.cache = null;
  }

  getSnippetPath() {
    const relative = this.presetManager.getSnippetSourceFile();
    if (!relative) {
      return undefined;
    }

    if (!this.workspaceRoot) {
      return path.isAbsolute(relative) ? relative : path.join('.', relative);
    }

    return path.isAbsolute(relative) ? relative : path.join(this.workspaceRoot, relative);
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

    if (filePath && fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        snippets = extractAnnotatedSnippets(raw);
      } catch (error) {
        console.error('No se pudieron extraer snippets del archivo', error);
      }
    }

    if (snippets.length === 0) {
      snippets = this.presetManager.getDefaultSnippets();
    }

    this.cache = snippets;
    return snippets;
  }

  handlePresetChanged() {
    this.resetWatcher();
    this.invalidate();
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
  constructor(workspaceRoot, presetManager) {
    this.collection = vscode.languages.createDiagnosticCollection('agentDeptrac');
    this.presetManager = presetManager;
    this.presetSubscription = this.presetManager.onDidChangePreset(() => this.handlePresetChanged());
    this.setWorkspaceRoot(workspaceRoot);
  }

  dispose() {
    this.disposeWatcher();
    if (this.presetSubscription) {
      this.presetSubscription.dispose();
    }
    this.collection.dispose();
  }

  setWorkspaceRoot(root) {
    this.workspaceRoot = root;
    this.refresh();
    this.resetWatcher();
  }

  getDeptracPath() {
    const relative = this.presetManager.getDeptracFile();
    if (!relative) {
      return undefined;
    }
    if (!this.workspaceRoot) {
      return path.isAbsolute(relative) ? relative : path.join('.', relative);
    }
    return path.isAbsolute(relative) ? relative : path.join(this.workspaceRoot, relative);
  }

  refresh() {
    const deptracPath = this.getDeptracPath();

    if (!deptracPath || !fs.existsSync(deptracPath)) {
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
    if (!deptracPath) {
      return;
    }
    this.watcher = watchFile(deptracPath, () => this.refresh());
  }

  disposeWatcher() {
    if (this.watcher && this.watcher.close) {
      this.watcher.close();
    }
    this.watcher = undefined;
  }

  handlePresetChanged() {
    this.refresh();
    this.resetWatcher();
  }
}

class AgentWorkbenchViewProvider {
  constructor(context, workspaceRoot, presetManager, aiAuthManager) {
    this.context = context;
    this.extensionUri = context.extensionUri;
    this.extensionPath = context.extensionPath;
    this.workspaceRoot = workspaceRoot;
    this.presetManager = presetManager;
    this.aiAuthManager = aiAuthManager;
    this.watchers = [];
    this.soundTimeout = undefined;
    this.showConfigPanel = false;
    this.presetSubscription = this.presetManager.onDidChangePreset(() => {
      this.resetWatchers();
      this.postState();
    });
  }

  dispose() {
    this.disposeWatchers();
    if (this.presetSubscription) {
      this.presetSubscription.dispose();
    }
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

    const watchTargets = new Set([
      ...this.presetManager.getWatchFiles(),
      CUSTOM_ACTIONS_FILE,
      SELENIUM_MODULES_FILE
    ]);

    watchTargets.forEach((relativePath) => {
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
    const hasAgent = hasWorkspace && hasAgentStructure(root);
    if (!hasAgent && this.showConfigPanel) {
      this.showConfigPanel = false;
    }
    const showConfigPanel = hasAgent ? this.showConfigPanel : false;
    const soundInfo = this.getSoundInfo();
    const aiSummary = this.aiAuthManager ? this.aiAuthManager.getSummary(this.workspaceRoot) : { connected: false, label: 'Sin agente IA configurado' };

    const presetSummary = this.presetManager.getPresetSummary();
    const statuses = [];

    statuses.push({
      id: 'workspace',
      label: 'Workspace',
      ok: hasWorkspace,
      okText: hasWorkspace ? (presetSummary ? presetSummary.name : 'Configurado') : 'Configurado',
      failText: 'No configurado',
      detail: hasWorkspace ? root : ''
    });

    statuses.push({
      id: 'ai-agent',
      label: 'Agente IA',
      ok: aiSummary.connected,
      okText: aiSummary.connected ? aiSummary.label : 'No configurado',
      failText: aiSummary.label || 'No configurado'
    });

    statuses.push({
      id: 'agent-kit',
      label: 'Agent Kit',
      ok: hasAgent,
      okText: 'Instalado',
      failText: 'Instalar pendiente'
    });

    const contextFiles = this.presetManager.getContextFiles();
    contextFiles.forEach((context) => {
      const exists = hasWorkspace && fs.existsSync(this.resolveWorkspacePath(context.relativePath));
      statuses.push({
        id: `context:${context.relativePath}`,
        label: context.label,
        ok: exists,
        okText: 'Disponible',
        failText: 'Pendiente'
      });
    });

    const bootstrapScript = this.presetManager.getBootstrapScript();
    if (bootstrapScript) {
      statuses.push({
        id: 'bootstrap',
        label: path.basename(bootstrapScript),
        ok: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(bootstrapScript)),
        okText: 'Disponible',
        failText: 'Pendiente'
      });
    }

    const composerData = this.presetManager.getComposerDataFile();
    if (composerData) {
      statuses.push({
        id: 'composer',
        label: 'Dependencias',
        ok: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(composerData)),
        okText: 'Listas',
        failText: 'Pendientes'
      });
    }

    const deptracFile = this.presetManager.getDeptracFile();
    if (deptracFile) {
      statuses.push({
        id: 'deptrac',
        label: 'Deptrac',
        ok: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(deptracFile)),
        okText: 'Listo',
        failText: 'Pendiente'
      });
    }

    const snippetSource = this.presetManager.getSnippetSourceFile();
    if (snippetSource) {
      statuses.push({
        id: 'snippets',
        label: 'Snippets',
        ok: hasWorkspace && fs.existsSync(this.resolveWorkspacePath(snippetSource)),
        okText: 'Listos',
        failText: 'Pendiente'
      });
    }

    statuses.push({
      id: 'sound',
      label: 'Sonido',
      ok: soundInfo.ready,
      okText: soundInfo.label,
      failText: soundInfo.label
    });

    const actions = this.buildActions({ hasWorkspace, hasAgent });
    const configActions = this.buildConfigActions({
      hasWorkspace,
      hasAgent,
      bootstrapScript,
      composerData,
      snippetSource
    });

    return {
      hasWorkspace,
      hasAgent,
      workspaceRoot: root || '',
      preset: presetSummary,
      statuses,
      actions,
      configActions,
      aiSummary,
      showConfigPanel,
      soundSummary: soundInfo.label,
      soundReady: soundInfo.ready
    };
  }

  getSoundInfo() {
    try {
      const config = sound.loadSoundConfig({
        extensionRoot: this.context.extensionPath,
        settings: vscode.workspace.getConfiguration('agentToolkit'),
        warn: (message) => vscode.window.showWarningMessage(message)
      });
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

  buildActions({ hasWorkspace, hasAgent }) {
    const actions = [];
    const seen = new Set();

    const pushAction = (action) => {
      if (!action || !action.command) {
        return;
      }
      const key = action.key || `${action.command}:${(action.args || []).join('|')}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      actions.push(action);
    };

    if (!hasWorkspace || !hasAgent) {
      pushAction({ command: 'agent.installAgentKit', label: 'Instalar Agent Kit', primary: true });
      return actions;
    }

    const customActions = getCustomActionsSafe(this.workspaceRoot);
    customActions.forEach((action) => {
      pushAction({
        key: `custom:${action.id}`,
        command: 'agent.runCustomAction',
        args: [action.id],
        label: action.label + (action.type === 'prompt' ? ' • IA' : ' • Script')
      });
    });

    pushAction({ command: 'agent.customActions.configure', label: 'Crear Función' });
    pushAction({ command: 'agent.runSeleniumModules', label: 'Ejecutar Test Selenium' });
    pushAction({
      command: 'toggleConfigPanel',
      label: this.showConfigPanel ? 'Ocultar configuración' : 'Configuración'
    });
    pushAction({ command: 'agent.reinstallAgentKit', label: 'Reinstalar Agent Kit' });
    pushAction({ command: 'agent.cleanAgentKit', label: 'Limpiar', danger: true });

    return actions;
  }

  buildConfigActions({ hasWorkspace, hasAgent, bootstrapScript, composerData, snippetSource }) {
    if (!hasWorkspace || !hasAgent) {
      return [];
    }

    const actions = [];
    const pushAction = (action) => action && actions.push(action);

    pushAction({ command: 'openContexts', label: 'Abrir contextos' });
    if (composerData) {
      pushAction({ command: 'openComposer', label: 'Abrir dependencias' });
    }
    if (snippetSource) {
      pushAction({ command: 'openSnippets', label: 'Editar snippets' });
    }
    if (bootstrapScript) {
      pushAction({ command: 'openBootstrapFile', label: 'Abrir bootstrap' });
    }
    pushAction({ command: 'openConfigurator', label: 'Configuración de la extensión' });
    pushAction({ command: 'openConfig', label: 'Editar config.json' });
    pushAction({ command: 'openDocs', label: 'Ver documentación' });
    pushAction({ command: 'playSound', label: 'Probar sonido' });
    pushAction({ command: 'agent.ai.configure', label: 'Configurar agente IA' });

    return actions;
  }

  async handleMessage(message) {
    if (!message || !message.command) {
      return;
    }

    const { command, args } = message;

    switch (command) {
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
        await this.openPresetFile(this.presetManager.getSnippetSourceFile(), 'No se definió un archivo de snippets para este preset.');
        break;
      case 'openBootstrapFile':
        await this.openPresetFile(this.presetManager.getBootstrapScript(), 'No se definió bootstrap para este preset.');
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
      case 'toggleConfigPanel':
        this.showConfigPanel = !this.showConfigPanel;
        this.postState();
        break;
      case 'choosePreset':
        await this.showPresetPicker();
        break;
      case 'selectAiAgent':
        await vscode.commands.executeCommand('agent.ai.configure');
        break;
      case 'refreshState':
        this.postState();
        break;
      default:
        if (command && typeof command === 'string' && command.startsWith('agent.')) {
          await vscode.commands.executeCommand(command, ...(Array.isArray(args) ? args : []));
          this.postState();
        }
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

  async openPresetFile(relativePath, missingMessage) {
    if (!relativePath) {
      if (missingMessage) {
        vscode.window.showInformationMessage(missingMessage);
      }
      return;
    }
    await this.openWorkspaceFile(relativePath);
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

  async showPresetPicker() {
    const presets = this.presetManager.getPresetChoices();
    if (!presets.length) {
      vscode.window.showWarningMessage('No se encontraron presets instalados.');
      return;
    }

    const current = this.presetManager.getPresetSummary();
    const pick = await vscode.window.showQuickPick(
      presets.map((preset) => ({
        label: preset.label,
        description: preset.description,
        detail: preset.detail,
        picked: current && current.id === preset.id,
        presetId: preset.id
      })),
      { placeHolder: 'Selecciona el preset a utilizar', matchOnDescription: true }
    );

    if (pick && pick.presetId) {
      await this.presetManager.selectPreset(pick.presetId);
      vscode.window.showInformationMessage(`Preset activo: ${pick.label}`);
      this.postState();
    }
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
            header .title {
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            header .title span:first-child {
              font-size: 11px;
            }
            header .title span:last-child {
              font-size: 10px;
              text-transform: none;
              letter-spacing: 0.02em;
              color: var(--vscode-descriptionForeground);
            }
            .preset-description {
              margin-top: -12px;
              margin-bottom: 16px;
              color: var(--vscode-descriptionForeground);
              font-size: 12px;
            }
            .status-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
              gap: 8px;
              margin-bottom: 8px;
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
            .status-detail {
              font-size: 11px;
              color: var(--vscode-descriptionForeground);
            }
            .actions {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .action-list {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .action-list.hidden {
              display: none;
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
            button.danger {
              background: var(--vscode-inputValidation-errorBackground);
              color: var(--vscode-inputValidation-errorForeground);
            }
            button:disabled {
              opacity: 0.5;
              cursor: default;
            }
            button:hover {
              filter: brightness(1.05);
            }
            .no-actions {
              font-size: 12px;
              color: var(--vscode-descriptionForeground);
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
            <div class="title">
              <span>Agent Toolkit</span>
              <span id="preset-name">Cargando preset…</span>
            </div>
          </header>
          <p class="preset-description" id="preset-description"></p>

          <section class="status-grid" id="status-grid"></section>

          <section class="actions">
            <div id="main-actions" class="action-list"></div>
            <div id="config-actions" class="action-list hidden"></div>
          </section>

          <footer>
            Los botones ejecutan los scripts dentro del workspace configurado. Asegúrate de revisar la terminal “Agent Toolkit”.
          </footer>

          <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            const statusContainer = document.getElementById('status-grid');
            const mainActionsContainer = document.getElementById('main-actions');
            const configActionsContainer = document.getElementById('config-actions');
            const presetName = document.getElementById('preset-name');
            const presetDescription = document.getElementById('preset-description');

            window.addEventListener('message', (event) => {
              const message = event.data;
              if (!message || message.type !== 'state') {
                return;
              }
              renderState(message.payload);
            });

            function renderState(state) {
              if (presetName) {
                presetName.textContent = state.preset ? state.preset.name : 'Preset no definido';
              }
              if (presetDescription) {
                presetDescription.textContent = state.preset && state.preset.description ? state.preset.description : '';
              }

              if (statusContainer) {
                statusContainer.innerHTML = '';
                (state.statuses || []).forEach((status) => {
                  const card = document.createElement('div');
                  card.className = 'status-card';

                  const title = document.createElement('div');
                  title.className = 'status-title';
                  title.textContent = status.label || 'Estado';
                  card.appendChild(title);

                  const value = document.createElement('div');
                  value.className = 'status-value';
                  value.classList.add(status.ok ? 'ok' : 'missing');
                  value.textContent = status.ok ? status.okText || 'Listo' : status.failText || 'Pendiente';
                  card.appendChild(value);

                  if (status.detail) {
                    const detail = document.createElement('div');
                    detail.className = 'status-detail';
                    detail.textContent = status.detail;
                    card.appendChild(detail);
                  }

                  statusContainer.appendChild(card);
                });
              }

              renderActionList(mainActionsContainer, state.actions || [], true);
              renderActionList(configActionsContainer, state.configActions || [], state.showConfigPanel);
            }

            function renderActionList(container, actions, visible) {
              if (!container) {
                return;
              }
              container.innerHTML = '';
              container.classList.toggle('hidden', !visible);
              if (!visible) {
                return;
              }
              if (!actions.length) {
                const placeholder = document.createElement('div');
                placeholder.className = 'no-actions';
                placeholder.textContent = 'Sin acciones disponibles.';
                container.appendChild(placeholder);
                return;
              }
              actions.forEach((action) => {
                const button = createButton(action);
                if (button) {
                  container.appendChild(button);
                }
              });
            }

            function createButton(action) {
              if (!action || !action.command) {
                return null;
              }
              const button = document.createElement('button');
              if (action.primary) {
                button.classList.add('primary');
              }
              if (action.danger) {
                button.classList.add('danger');
              }
              button.textContent = action.label || action.command;
              button.disabled = Boolean(action.disabled);
              button.addEventListener('click', () => {
                vscode.postMessage({ command: action.command, args: action.args || [] });
              });
              return button;
            }

            vscode.postMessage({ command: 'refreshState' });
          </script>
        </body>
      </html>
    `;
  }
}

async function openConfigurationUI(context, presetManager, workbenchProvider, aiManager) {
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
      label: '$(robot) Configurar agente IA…',
      description: 'Selecciona el proveedor y guarda las credenciales.',
      action: 'aiConfigure'
    },
    {
      label: '$(debug-restart) Limpiar agente IA',
      description: 'Elimina las credenciales almacenadas del agente IA.',
      action: 'aiClear'
    },
    {
      label: '$(list-selection) Gestionar botones personalizados…',
      description: 'Crea, edita o elimina acciones propias del panel.',
      action: 'customActions'
    },
    {
      label: '$(symbol-structure) Seleccionar preset…',
      description: 'Cambia el preset activo (plantilla y automatizaciones).',
      action: 'presetSelect'
    },
    {
      label: '$(debug-continue-small) Usar detección automática de preset',
      description: 'Limpia el preset fijo y deja que la extensión lo determine.',
      action: 'presetClear'
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
      await handleConfigurationAction(selected.action, context, presetManager, workbenchProvider, aiManager);
    }
  });

  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}

async function handleConfigurationAction(action, context, presetManager, workbenchProvider, aiManager) {
  const settings = vscode.workspace.getConfiguration('agentToolkit');
  const workspaceRoot =
    workbenchProvider && typeof workbenchProvider.getWorkspaceRoot === 'function'
      ? workbenchProvider.getWorkspaceRoot()
      : resolveWorkspaceRoot();
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
    case 'aiConfigure': {
      await configureAiAgent(workspaceRoot, aiManager, workbenchProvider);
      break;
    }
    case 'aiClear': {
      if (aiManager) {
        await aiManager.clear(workspaceRoot);
        vscode.window.showInformationMessage('El agente IA se desconectó correctamente.');
        if (workbenchProvider && typeof workbenchProvider.postState === 'function') {
          workbenchProvider.postState();
        }
      }
      break;
    }
    case 'customActions': {
      await configureCustomActions(workspaceRoot, workbenchProvider, aiManager);
      break;
    }
    case 'presetSelect': {
      if (workbenchProvider && typeof workbenchProvider.showPresetPicker === 'function') {
        await workbenchProvider.showPresetPicker();
      } else if (presetManager) {
        await showPresetQuickPick(presetManager);
      }
      break;
    }
    case 'presetClear': {
      if (presetManager) {
        await presetManager.selectPreset('');
        vscode.window.showInformationMessage('Preset restablecido; se volverá a detectar automáticamente.');
      }
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
        sound.clearSoundConfigCache(context.extensionPath);
        vscode.window.showInformationMessage('Archivo de sonido actualizado.');
      }
      break;
    }
    case 'soundFileClear': {
      await settings.update('soundFile', '', true);
      sound.clearSoundConfigCache(context.extensionPath);
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
        sound.clearSoundConfigCache(context.extensionPath);
        vscode.window.showInformationMessage('Mensaje actualizado.');
      }
      break;
    }
    case 'soundMessageClear': {
      await settings.update('soundMessage', undefined, true);
      sound.clearSoundConfigCache(context.extensionPath);
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

async function showPresetQuickPick(presetManager) {
  const presets = presetManager ? presetManager.getPresetChoices() : [];
  if (!presetManager || !presets.length) {
    vscode.window.showWarningMessage('No se encontraron presets configurados.');
    return;
  }

  const current = presetManager.getPresetSummary();
  const pick = await vscode.window.showQuickPick(
    presets.map((preset) => ({
      label: preset.label,
      description: preset.description,
      detail: preset.detail,
      picked: current && current.id === preset.id,
      presetId: preset.id
    })),
    { placeHolder: 'Selecciona el preset activo', matchOnDescription: true }
  );

  if (pick && pick.presetId !== undefined) {
    await presetManager.selectPreset(pick.presetId);
    vscode.window.showInformationMessage(`Preset activo: ${pick.label}`);
  }
}

async function runPresetCommand(commandId, workspaceRoot, presetManager, options = {}) {
  if (!presetManager) {
    vscode.window.showWarningMessage('No hay gestor de presets disponible.');
    return;
  }

  const definition = presetManager.getCommandDefinition(commandId);
  if (!definition) {
    vscode.window.showInformationMessage('El preset activo no define esta acción.');
    return;
  }

  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const commands = Array.isArray(definition.commands)
    ? definition.commands
    : typeof definition.commands === 'string'
      ? [definition.commands]
      : [];

  if (!commands.length) {
    vscode.window.showWarningMessage('La acción no tiene comandos configurados.');
    return;
  }

  runCommandsInTerminal(workspaceRoot, commands, {
    announce: definition.announce,
    name: definition.terminalName || 'Agent Toolkit'
  });

  if (definition.invalidateSnippets && options.snippetProvider && typeof options.snippetProvider.invalidate === 'function') {
    options.snippetProvider.invalidate();
  }

  if (definition.refreshImmediately && options.workbenchProvider && typeof options.workbenchProvider.postState === 'function') {
    options.workbenchProvider.postState();
  } else {
    refreshWorkbenchSoon(options.workbenchProvider);
  }
}

async function scaffoldAgentDirectory(context, workspaceRoot, presetManager, providers = {}) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return false;
  }

  const choices = presetManager ? presetManager.getPresetChoices() : [];
  if (!presetManager || !choices.length) {
    vscode.window.showErrorMessage('No hay presets disponibles para crear la carpeta agent/.');
    return false;
  }

  const current = presetManager.getPresetSummary();
  let selectedPreset = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(
    choices.map((choice) => ({
      label: choice.label,
      description: choice.description,
      detail: `ID: ${choice.id}`,
      presetId: choice.id,
      picked: current && current.id === choice.id
    })),
    {
      placeHolder: 'Selecciona la plantilla de agent/ que quieres copiar',
      matchOnDescription: true
    }
  );

  if (!selectedPreset) {
    return false;
  }

  if (!selectedPreset.presetId && selectedPreset.id) {
    selectedPreset = { ...selectedPreset, presetId: selectedPreset.id };
  }

  const templateRoot = presetManager.getTemplatePath(selectedPreset.presetId);
  if (!templateRoot || !fs.existsSync(templateRoot)) {
    vscode.window.showErrorMessage('La plantilla seleccionada no tiene archivos para copiar.');
    return false;
  }

  const destinationRoot = path.join(workspaceRoot, 'agent');

  let overwriteExisting = false;

  if (fs.existsSync(destinationRoot)) {
    const choice = await vscode.window.showWarningMessage(
      'Ya existe una carpeta agent/. ¿Cómo quieres proceder?',
      { modal: true },
      'Actualizar archivos faltantes',
      'Sobrescribir con plantilla',
      'Cancelar'
    );

    if (!choice || choice === 'Cancelar') {
      return false;
    }

    overwriteExisting = choice === 'Sobrescribir con plantilla';
  } else {
    await fsp.mkdir(destinationRoot, { recursive: true });
  }

  const summary = { created: 0, updated: 0, skipped: 0 };
  await copyDirectory(templateRoot, destinationRoot, { overwriteExisting, summary });

  const parts = [];
  if (summary.created) {
    parts.push(`${summary.created} nuevos`);
  }
  if (summary.updated) {
    parts.push(`${summary.updated} actualizados`);
  }
  if (!parts.length) {
    parts.push('Sin cambios');
  }

  const presetLabel = selectedPreset.label || selectedPreset.presetId;
  vscode.window.showInformationMessage(`Estructura agent lista (${parts.join(', ')}) • Preset: ${presetLabel}`);

  if (presetManager) {
    await presetManager.selectPreset(selectedPreset.presetId);
  }

  if (providers.workbenchProvider && typeof providers.workbenchProvider.resetWatchers === 'function') {
    providers.workbenchProvider.resetWatchers();
  }
  if (providers.workbenchProvider && typeof providers.workbenchProvider.postState === 'function') {
    providers.workbenchProvider.postState();
  }
  if (providers.workbenchProvider && typeof providers.workbenchProvider.scheduleDoneSound === 'function') {
    providers.workbenchProvider.scheduleDoneSound();
  }

  if (providers.contextProvider && typeof providers.contextProvider.setWorkspaceRoot === 'function') {
    providers.contextProvider.setWorkspaceRoot(workspaceRoot);
  }

  if (providers.composerProvider && typeof providers.composerProvider.setWorkspaceRoot === 'function') {
    providers.composerProvider.setWorkspaceRoot(workspaceRoot);
    if (typeof providers.composerProvider.refresh === 'function') {
      providers.composerProvider.refresh();
    }
  }

  if (providers.snippetProvider && typeof providers.snippetProvider.setWorkspaceRoot === 'function') {
    providers.snippetProvider.setWorkspaceRoot(workspaceRoot);
  }

  if (providers.deptracDiagnostics && typeof providers.deptracDiagnostics.setWorkspaceRoot === 'function') {
    providers.deptracDiagnostics.setWorkspaceRoot(workspaceRoot);
  }

  return true;
}

async function configureAiAgent(workspaceRoot, aiManager, workbenchProvider) {
  if (!aiManager) {
    vscode.window.showWarningMessage('No hay un gestor de credenciales de IA disponible.');
    return;
  }

  const metadata = await aiManager.configure(workspaceRoot);
  if (metadata) {
    vscode.window.showInformationMessage(`Agente IA configurado: ${metadata.providerLabel}`);
    if (workbenchProvider && typeof workbenchProvider.postState === 'function') {
      workbenchProvider.postState();
    }
  }
}

async function configureCustomActions(workspaceRoot, workbenchProvider, aiManager) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const actions = readCustomActions(workspaceRoot);
  const pickItems = [
    ...actions.map((action) => ({
      label: action.label,
      description: action.type === 'prompt' ? 'Prompt IA' : 'Script',
      detail: action.type === 'prompt' ? (action.runner || DEFAULT_PROMPT_RUNNER) : action.scriptPath,
      action
    })),
    {
      label: '$(add) Crear nuevo botón…',
      action: null
    }
  ];

  const picked = await vscode.window.showQuickPick(pickItems, {
    placeHolder: 'Selecciona un botón personalizado o crea uno nuevo',
    matchOnDescription: true
  });

  if (!picked) {
    return;
  }

  if (!picked.action) {
    const created = await promptCustomActionDetails(workspaceRoot, undefined, aiManager);
    if (!created) {
      return;
    }
    actions.push(created);
    await saveCustomActions(workspaceRoot, actions);
    vscode.window.showInformationMessage(`Botón "${created.label}" creado.`);
  } else {
    const action = picked.action;
    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(pencil) Editar', value: 'edit' },
        { label: '$(trash) Eliminar', value: 'delete' },
        { label: '$(play) Probar ahora', value: 'run' }
      ],
      { placeHolder: `Acción para "${action.label}"` }
    );

    if (!choice) {
      return;
    }

    if (choice.value === 'edit') {
      const updated = await promptCustomActionDetails(workspaceRoot, action, aiManager);
      if (!updated) {
        return;
      }
      const index = actions.findIndex((item) => item.id === action.id);
      actions[index] = updated;
      await saveCustomActions(workspaceRoot, actions);
      vscode.window.showInformationMessage(`Botón "${updated.label}" actualizado.`);
    } else if (choice.value === 'delete') {
      const confirm = await vscode.window.showWarningMessage(
        `¿Eliminar el botón "${action.label}"?`,
        { modal: true },
        'Eliminar'
      );
      if (confirm === 'Eliminar') {
        const index = actions.findIndex((item) => item.id === action.id);
        actions.splice(index, 1);
        await saveCustomActions(workspaceRoot, actions);
        vscode.window.showInformationMessage(`Botón "${action.label}" eliminado.`);
      }
    } else if (choice.value === 'run') {
      await runCustomAction(workspaceRoot, action.id, aiManager);
    }
  }

  if (workbenchProvider && typeof workbenchProvider.postState === 'function') {
    workbenchProvider.postState();
  }
}

async function runCustomAction(workspaceRoot, actionId, aiManager) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  const actions = readCustomActions(workspaceRoot);
  const action = actions.find((item) => item.id === actionId);
  if (!action) {
    vscode.window.showWarningMessage('No se encontró el botón personalizado solicitado.');
    return;
  }

  if (action.type === 'prompt') {
    await executePromptAction(workspaceRoot, action, aiManager);
    return;
  }

  await executeScriptAction(workspaceRoot, action);
}

async function runSeleniumModules(workspaceRoot) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  if (!hasAgentStructure(workspaceRoot)) {
    vscode.window.showWarningMessage('Primero instala Agent Kit para ejecutar las pruebas Selenium.');
    return;
  }

  const modules = readSeleniumModules(workspaceRoot);
  if (!modules.length) {
    vscode.window.showWarningMessage('No se encontraron módulos en agent/exports/selenium_modules.json.');
    return;
  }

  const picks = await vscode.window.showQuickPick(
    modules.map((module) => ({
      label: module.name || module.id,
      description: module.description || module.testPath || '',
      detail: module.testPath || '',
      moduleId: module.id
    })),
    {
      canPickMany: true,
      placeHolder: 'Selecciona los módulos Selenium a ejecutar'
    }
  );

  if (!picks || picks.length === 0) {
    return;
  }

  const selectedIds = picks.map((pick) => pick.moduleId).filter(Boolean);
  if (!selectedIds.length) {
    vscode.window.showWarningMessage('No se seleccionó ningún módulo válido.');
    return;
  }

  const runnerPath = path.join(workspaceRoot, SELENIUM_RUNNER);
  if (!fs.existsSync(runnerPath)) {
    vscode.window.showWarningMessage('No se encontró agent/scripts/run_selenium_tests.sh.');
    return;
  }

  const modulesParam = selectedIds.join(',');
  runCommandsInTerminal(
    workspaceRoot,
    [`chmod +x ${SELENIUM_RUNNER}`, `${SELENIUM_RUNNER} --modules ${modulesParam}`],
    { announce: `Ejecutando módulos Selenium (${modulesParam})…` }
  );
}

async function installAgentKit(
  context,
  workspaceRoot,
  presetManager,
  aiManager,
  providers,
  options = {}
) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  if (options.reinstall) {
    await removeAgentStructure(workspaceRoot);
  }

  const success = await scaffoldAgentDirectory(context, workspaceRoot, presetManager, providers);
  if (!success) {
    return;
  }

  await ensureSeleniumRunner(workspaceRoot, context.extensionPath);
  await ensureSeleniumModulesFile(workspaceRoot);
  await runPresetCommandIfAvailable('agent.runBootstrap', workspaceRoot, presetManager, providers);
  await runPresetCommandIfAvailable('agent.runSeleniumExport', workspaceRoot, presetManager, providers);
  await runPresetCommandIfAvailable('agent.runDeptrac', workspaceRoot, presetManager, providers);

  if (providers.workbenchProvider && typeof providers.workbenchProvider.resetWatchers === 'function') {
    providers.workbenchProvider.resetWatchers();
  }
  refreshWorkbenchSoon(providers.workbenchProvider);
}

async function cleanAgentKit(workspaceRoot, providers) {
  if (!assertWorkspaceRoot(workspaceRoot)) {
    return;
  }

  await removeAgentStructure(workspaceRoot);
  vscode.window.showInformationMessage('Se eliminó la carpeta agent/.');
  if (providers && providers.workbenchProvider) {
    if (typeof providers.workbenchProvider.resetWatchers === 'function') {
      providers.workbenchProvider.resetWatchers();
    }
    providers.workbenchProvider.postState();
  }
  if (providers && providers.contextProvider && typeof providers.contextProvider.refresh === 'function') {
    providers.contextProvider.refresh();
  }
  if (providers && providers.composerProvider && typeof providers.composerProvider.refresh === 'function') {
    providers.composerProvider.refresh();
  }
  if (providers && providers.snippetProvider && typeof providers.snippetProvider.invalidate === 'function') {
    providers.snippetProvider.invalidate();
  }
}

async function removeAgentStructure(workspaceRoot) {
  if (!workspaceRoot) {
    return;
  }
  const target = path.join(workspaceRoot, 'agent');
  try {
    await fsp.rm(target, { recursive: true, force: true });
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudo eliminar agent/: ${error.message}`);
  }
}

async function runPresetCommandIfAvailable(commandId, workspaceRoot, presetManager, options) {
  if (!presetManager || !presetManager.getCommandDefinition(commandId)) {
    return;
  }
  await runPresetCommand(commandId, workspaceRoot, presetManager, options || {});
}

function refreshWorkbenchSoon(workbenchProvider) {
  if (!workbenchProvider || typeof workbenchProvider.postState !== 'function') {
    return;
  }
  setTimeout(() => workbenchProvider.postState(), 500);
}

async function promptCustomActionDetails(workspaceRoot, existing, aiManager) {
  const label = await vscode.window.showInputBox({
    prompt: 'Nombre del botón',
    placeHolder: 'Deploy staging',
    value: existing ? existing.label : ''
  });
  if (!label) {
    return undefined;
  }

  const type = existing
    ? existing.type
    : await vscode.window.showQuickPick(
        [
          { label: 'Ejecutar script', value: 'script' },
          { label: 'Enviar prompt IA', value: 'prompt' }
        ],
        { placeHolder: 'Seleccione el tipo de botón' }
      ).then((pick) => (pick ? pick.value : undefined));

  if (!type) {
    return undefined;
  }

  if (type === 'script') {
    const scriptPath = await vscode.window.showInputBox({
      prompt: 'Comando o ruta del script a ejecutar',
      placeHolder: './scripts/deploy.sh o npm run build',
      value: existing ? existing.scriptPath : ''
    });
    if (!scriptPath) {
      return undefined;
    }
    return {
      id: existing ? existing.id : generateCustomActionId(label, workspaceRoot),
      label,
      type,
      scriptPath: scriptPath.trim()
    };
  }

  if (aiManager) {
    let session = await aiManager.getSession(workspaceRoot);
    if (!session) {
      const decision = await vscode.window.showWarningMessage(
        'Necesitas seleccionar un agente de IA antes de crear este botón.',
        'Configurar agente IA',
        'Cancelar'
      );
      if (decision === 'Configurar agente IA') {
        const configured = await aiManager.configure(workspaceRoot);
        if (!configured) {
          return undefined;
        }
        session = await aiManager.getSession(workspaceRoot);
        if (globalWorkbenchProvider && typeof globalWorkbenchProvider.postState === 'function') {
          globalWorkbenchProvider.postState();
        }
      } else {
        return undefined;
      }
    }
  }

  const promptText = await vscode.window.showInputBox({
    prompt: 'Prompt a enviar al agente de IA',
    placeHolder: 'Describe el estado del sprint…',
    value: existing ? existing.prompt : ''
  });
  if (!promptText) {
    return undefined;
  }

  const aiRunnerDefault =
    (existing && existing.runner) ||
    (aiManager && aiManager.getDefaultRunner(workspaceRoot)) ||
    DEFAULT_PROMPT_RUNNER;

  const runner = await vscode.window.showInputBox({
    prompt: 'Comando que recibirá el prompt (usa {prompt} como placeholder)',
    placeHolder: DEFAULT_PROMPT_RUNNER,
    value: aiRunnerDefault
  });
  if (!runner) {
    return undefined;
  }

  if (isCodexRunner(runner)) {
    const authenticated = await ensureCodexSession(workspaceRoot);
    if (!authenticated) {
      vscode.window.showWarningMessage('No se pudo validar la sesión de Codex. Intenta nuevamente luego de iniciar sesión.');
      return undefined;
    }
  }

  return {
    id: existing ? existing.id : generateCustomActionId(label, workspaceRoot),
    label,
    type,
    prompt: promptText,
    runner: runner.trim()
  };
}

async function executeScriptAction(workspaceRoot, action) {
  const command = action.scriptPath;
  if (!command) {
    vscode.window.showWarningMessage('El botón no tiene un script configurado.');
    return;
  }

  runCommandsInTerminal(workspaceRoot, [command], {
    announce: `Ejecutando ${action.label}…`,
    name: 'Agent Toolkit'
  });
}

async function executePromptAction(workspaceRoot, action, aiManager) {
  const promptText = action.prompt;
  if (!promptText) {
    vscode.window.showWarningMessage('El botón no tiene un prompt configurado.');
    return;
  }

  let aiSession = aiManager ? await aiManager.getSession(workspaceRoot) : null;
  if (!aiSession && aiManager) {
    const decision = await vscode.window.showWarningMessage(
      'No hay un agente IA configurado. Configúralo antes de continuar.',
      'Configurar agente IA',
      'Cancelar'
    );
    if (decision === 'Configurar agente IA') {
      const configured = await aiManager.configure(workspaceRoot);
      if (!configured) {
        return;
      }
      aiSession = await aiManager.getSession(workspaceRoot);
      if (globalWorkbenchProvider && typeof globalWorkbenchProvider.postState === 'function') {
        globalWorkbenchProvider.postState();
      }
    } else {
      return;
    }
  }

  const runnerTemplate = action.runner || (aiSession && aiSession.runner) || DEFAULT_PROMPT_RUNNER;
  if (isCodexRunner(runnerTemplate)) {
    const authenticated = await ensureCodexSession(workspaceRoot);
    if (!authenticated) {
      vscode.window.showWarningMessage('Codex no reporta sesión activa. Vuelve a intentarlo después de iniciar sesión.');
      return;
    }
  }

  const escapedPrompt = escapePromptForShell(promptText);
  const commandText = runnerTemplate.includes('{prompt}')
    ? runnerTemplate.replace(/\{prompt\}/g, escapedPrompt)
    : `${runnerTemplate} "${escapedPrompt}"`;

  const terminal = getAgentTerminal('Agent Toolkit');
  terminal.show(true);
  terminal.sendText(`cd "${workspaceRoot}"`, true);
  const commandWithCredentials = applyEnvToCommand(commandText, aiSession ? aiSession.env : undefined);
  terminal.sendText(commandWithCredentials, true);
  vscode.window.showInformationMessage(`Prompt enviado para "${action.label}".`);
}

function escapePromptForShell(text) {
  return text.replace(/"/g, '\\"');
}

function applyEnvToCommand(command, envVars) {
  if (!envVars || !Object.keys(envVars).length) {
    return command;
  }

  const entries = Object.entries(envVars);
  if (!entries.length) {
    return command;
  }

  if (process.platform === 'win32') {
    const assignments = entries.map(([key, value]) => `$env:${key}="${escapePowerShell(value)}"`).join('; ');
    return `${assignments}; ${command}`;
  }

  const exports = entries.map(([key, value]) => `${key}="${escapePromptForShell(value)}"`).join(' ');
  return `${exports} ${command}`;
}

function escapePowerShell(text) {
  return text.replace(/`/g, '``').replace(/"/g, '`"');
}

function isCodexRunner(runnerTemplate) {
  if (!runnerTemplate) {
    return false;
  }
  const normalized = runnerTemplate.trim().toLowerCase();
  return normalized.startsWith('codex ') || normalized.includes(' codex ');
}

async function ensureCodexLogin(workspaceRoot) {
  return new Promise((resolve) => {
    const child = spawn('codex', ['auth', 'whoami'], {
      cwd: workspaceRoot || undefined,
      stdio: 'ignore'
    });

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function ensureCodexSession(workspaceRoot) {
  const loggedIn = await ensureCodexLogin(workspaceRoot);
  if (loggedIn) {
    return true;
  }
  return promptCodexLogin(workspaceRoot);
}

async function promptCodexLogin(workspaceRoot) {
  const choice = await vscode.window.showInformationMessage(
    'Codex CLI no tiene una sesión activa. ¿Deseas ejecutar "codex auth login" ahora?',
    'Iniciar sesión',
    'Cancelar'
  );
  if (choice !== 'Iniciar sesión') {
    return false;
  }

  const terminal = getAgentTerminal('Agent Toolkit');
  terminal.show(true);
  if (workspaceRoot) {
    terminal.sendText(`cd "${workspaceRoot}"`, true);
  }
  terminal.sendText('codex auth login', true);

  const confirm = await vscode.window.showInformationMessage(
    'Completa el login en la terminal y presiona "Listo" para continuar.',
    { modal: true },
    'Listo',
    'Cancelar'
  );
  if (confirm !== 'Listo') {
    return false;
  }

  return ensureCodexLogin(workspaceRoot);
}

function getCustomActionsPath(workspaceRoot) {
  if (!workspaceRoot) {
    return CUSTOM_ACTIONS_FILE;
  }
  return path.join(workspaceRoot, CUSTOM_ACTIONS_FILE);
}

function readCustomActions(workspaceRoot) {
  const target = getCustomActionsPath(workspaceRoot);
  if (!fs.existsSync(target)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudieron leer los botones personalizados: ${error.message}`);
    return [];
  }
}

async function saveCustomActions(workspaceRoot, actions) {
  const target = getCustomActionsPath(workspaceRoot);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, JSON.stringify(actions, null, 2), 'utf-8');
}

function getCustomActionsSafe(workspaceRoot) {
  try {
    return readCustomActions(workspaceRoot);
  } catch (error) {
    console.warn('No se pudieron cargar los botones personalizados', error);
    return [];
  }
}

function generateCustomActionId(label, workspaceRoot) {
  const base = (label || 'custom-action').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'action';
  const actions = readCustomActions(workspaceRoot);
  let candidate = base;
  let suffix = 1;
  while (actions.some((action) => action.id === candidate)) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

function getSeleniumModulesPath(workspaceRoot) {
  if (!workspaceRoot) {
    return SELENIUM_MODULES_FILE;
  }
  return path.join(workspaceRoot, SELENIUM_MODULES_FILE);
}

function readSeleniumModules(workspaceRoot) {
  const target = getSeleniumModulesPath(workspaceRoot);
  if (!fs.existsSync(target)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(target, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudieron leer los módulos Selenium: ${error.message}`);
    return [];
  }
}

async function ensureSeleniumModulesFile(workspaceRoot) {
  const target = getSeleniumModulesPath(workspaceRoot);
  if (fs.existsSync(target)) {
    return;
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, '[]', 'utf-8');
}

async function ensureSeleniumRunner(workspaceRoot, extensionPath) {
  if (!workspaceRoot || !extensionPath) {
    return;
  }
  const source = path.join(extensionPath, SELENIUM_RUNNER_ASSET);
  if (!fs.existsSync(source)) {
    return;
  }
  const target = path.join(workspaceRoot, SELENIUM_RUNNER);
  try {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
    await ensureExecutable(target);
  } catch (error) {
    vscode.window.showWarningMessage(`No se pudo preparar run_selenium_tests.sh: ${error.message}`);
  }
}

function hasAgentStructure(workspaceRoot) {
  if (!workspaceRoot) {
    return false;
  }
  const agentRoot = path.join(workspaceRoot, 'agent');
  if (!fs.existsSync(agentRoot)) {
    return false;
  }
  const bootstrap = path.join(agentRoot, 'bootstrap.sh');
  const scriptsDir = path.join(agentRoot, 'scripts');
  const exportsDir = path.join(agentRoot, 'exports');
  return fs.existsSync(bootstrap) && fs.existsSync(scriptsDir) && fs.existsSync(exportsDir);
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

async function copyDirectory(source, destination, options) {
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath, options);
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    const targetExists = await pathExists(targetPath);
    if (targetExists && !options.overwriteExisting) {
      options.summary.skipped += 1;
      continue;
    }

    await fsp.copyFile(sourcePath, targetPath);
    await ensureExecutable(targetPath);

    if (targetExists) {
      options.summary.updated += 1;
    } else {
      options.summary.created += 1;
    }
  }
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

async function ensureExecutable(filePath) {
  if (!shouldMakeExecutable(filePath)) {
    return;
  }

  try {
    await fsp.chmod(filePath, 0o755);
  } catch (error) {
    console.warn(`No se pudieron ajustar permisos en ${filePath}: ${error.message}`);
  }
}

function shouldMakeExecutable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.sh' || ext === '.mjs') {
    return true;
  }

  const executableNames = new Set(['init.sh']);
  return executableNames.has(path.basename(filePath));
}

function registerDoneSound(context) {
  const disposable = vscode.commands.registerCommand('agent.doneSound', async () => {
    try {
      await sound.runDoneSound({
        extensionRoot: context.extensionPath,
        settings: vscode.workspace.getConfiguration('agentToolkit'),
        info: (message) => vscode.window.showInformationMessage(message),
        warn: (message) => vscode.window.showWarningMessage(message)
      });
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
