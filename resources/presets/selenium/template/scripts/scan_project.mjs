#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ARGS = new Set(process.argv.slice(2));
if (ARGS.has('--help') || ARGS.has('-h')) {
  console.log(`Uso:
  node agent/scripts/scan_project.mjs [--json]

Opciones:
  --json    Imprime el JSON completo además del resumen.
  --help    Muestra esta ayuda.
`);
  process.exit(0);
}

const WORKSPACE = process.cwd();
const PROJECT_METADATA_FILE = path.join('agent', 'exports', 'project_metadata.json');
const DEFAULT_MAX_DEPTH = 3;
const IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'node_modules',
  'vendor',
  '.output',
  'agent'
]);

const STACK_INDICATORS = [
  {
    id: 'angular',
    label: 'Angular',
    preset: 'angular',
    ui: true,
    matchers: [{ type: 'file', patterns: ['angular.json', '**/angular.json'] }]
  },
  {
    id: 'ionic',
    label: 'Ionic',
    preset: 'ionic',
    ui: true,
    matchers: [{ type: 'file', patterns: ['ionic.config.json', '**/ionic.config.json'] }]
  },
  {
    id: 'next',
    label: 'Next.js',
    preset: 'next',
    ui: true,
    matchers: [
      {
        type: 'file',
        patterns: ['next.config.js', 'next.config.ts', 'next.config.mjs', '**/next.config.js', '**/next.config.ts', '**/next.config.mjs']
      }
    ]
  },
  {
    id: 'react',
    label: 'React',
    preset: 'react',
    ui: true,
    matchers: [
      { type: 'packageDependency', dependency: 'react', filePatterns: ['package.json', '**/package.json'] },
      { type: 'file', patterns: ['src/App.tsx', 'src/App.jsx', '**/src/App.tsx', '**/src/App.jsx'] }
    ]
  },
  {
    id: 'laravel',
    label: 'Laravel',
    preset: 'laravel',
    matchers: [
      { type: 'file', patterns: ['artisan', '**/artisan'] },
      { type: 'composerDependency', dependency: 'laravel/framework' }
    ]
  },
  {
    id: 'docker',
    label: 'Solo contenedores',
    preset: 'docker',
    matchers: [
      { type: 'file', patterns: ['docker-compose.yml', 'compose.yml', 'compose.yaml', 'Dockerfile', '**/docker-compose.yml', '**/Dockerfile'] }
    ]
  }
];

const ensureParentDir = (target) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
};

const resolveAbsolute = (relativePath) =>
  path.isAbsolute(relativePath) ? relativePath : path.join(WORKSPACE, relativePath);

const exists = (target) => {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
};

const findFilesByName = (fileName, maxDepth = DEFAULT_MAX_DEPTH) => {
  const matches = [];
  const queue = [{ dir: WORKSPACE, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && depth + 1 <= maxDepth) {
          queue.push({ dir: absolute, depth: depth + 1 });
        }
        continue;
      }
      if (entry.isFile() && entry.name === fileName) {
        matches.push(absolute);
      }
    }
  }
  return matches;
};

const pathMatchesPattern = (pattern, options = {}) => {
  if (!pattern) return false;
  const normalized = pattern.replace(/\\/g, '/');
  if (normalized.startsWith('**/')) {
    const fileName = normalized.slice(3);
    return findFilesByName(fileName, options.maxDepth || DEFAULT_MAX_DEPTH).length > 0;
  }
  return exists(resolveAbsolute(pattern));
};

const readJson = (target) => {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
};

const detectPackageDependency = (dependency, patterns = ['package.json'], maxDepth = DEFAULT_MAX_DEPTH) => {
  for (const pattern of patterns) {
    if (pattern.startsWith('**/')) {
      const fileName = pattern.slice(3);
      const files = findFilesByName(fileName, maxDepth);
      for (const file of files) {
        const pkg = readJson(file);
        if (pkg && hasDependency(pkg, dependency)) {
          return file;
        }
      }
    } else {
      const absolute = resolveAbsolute(pattern);
      const pkg = readJson(absolute);
      if (pkg && hasDependency(pkg, dependency)) {
        return absolute;
      }
    }
  }
  return null;
};

const detectComposerDependency = (dependency) => {
  const files = findFilesByName('composer.json', DEFAULT_MAX_DEPTH);
  for (const file of files) {
    const composer = readJson(file);
    if (composer && hasDependency(composer, dependency)) {
      return file;
    }
  }
  return null;
};

const hasDependency = (manifest, dependency) => {
  if (!manifest) return false;
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'require'];
  return buckets.some((key) => manifest[key] && manifest[key][dependency]);
};

const detectFrameworks = () => {
  const frameworks = [];
  STACK_INDICATORS.forEach((indicator) => {
    const info = { id: indicator.id, label: indicator.label, preset: indicator.preset, matches: [] };
    indicator.matchers.forEach((matcher) => {
      if (matcher.type === 'file') {
        matcher.patterns.forEach((pattern) => {
          if (pathMatchesPattern(pattern, { maxDepth: DEFAULT_MAX_DEPTH })) {
            const normalized = pattern.startsWith('**/') ? pattern.slice(3) : pattern;
            info.matches.push(normalized);
          }
        });
      } else if (matcher.type === 'packageDependency') {
        const file = detectPackageDependency(matcher.dependency, matcher.filePatterns, DEFAULT_MAX_DEPTH);
        if (file) info.matches.push(path.relative(WORKSPACE, file));
      } else if (matcher.type === 'composerDependency') {
        const file = detectComposerDependency(matcher.dependency);
        if (file) info.matches.push(path.relative(WORKSPACE, file));
      }
    });
    if (info.matches.length) {
      info.hasUi = Boolean(indicator.ui);
      frameworks.push(info);
    }
  });
  return frameworks;
};

const detectDockerTargets = (frameworks) => frameworks.filter((fw) => fw.id === 'docker');

const detectMonorepo = () => {
  const manifests = ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'turbo.json', 'nx.json', 'lerna.json', 'workspace.json'];
  if (manifests.some((file) => pathMatchesPattern(file, { maxDepth: 1 }))) {
    return true;
  }
  const dirs = ['apps', 'packages', 'services', 'modules'];
  return dirs.some((dir) => {
    const absolute = resolveAbsolute(dir);
    if (!exists(absolute)) return false;
    try {
      const entries = fs.readdirSync(absolute, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).length >= 2;
    } catch {
      return false;
    }
  });
};

const detectHeadlessFallback = () => {
  const hasComposer = pathMatchesPattern('composer.json') || findFilesByName('composer.json').length > 0;
  const hasPkg = pathMatchesPattern('package.json') || findFilesByName('package.json').length > 0;
  return hasComposer || hasPkg;
};

const choosePreset = (frameworks, hasDockerOnly, hasHeadlessFallback) => {
  const priority = ['angular', 'ionic', 'next', 'react', 'laravel'];
  for (const id of priority) {
    if (frameworks.some((fw) => fw.id === id)) {
      return id;
    }
  }
  if (hasDockerOnly) return 'docker';
  if (hasHeadlessFallback) return 'headless';
  return 'generic';
};

const writeMetadata = (metadata) => {
  ensureParentDir(PROJECT_METADATA_FILE);
  fs.writeFileSync(PROJECT_METADATA_FILE, JSON.stringify(metadata, null, 2));
};

const main = () => {
  const frameworks = detectFrameworks();
  const dockerTargets = detectDockerTargets(frameworks);
  const hasHeadlessFallback = detectHeadlessFallback();
  const isMonorepo = detectMonorepo();
  const hasDockerOnly = frameworks.length > 0 && frameworks.length === dockerTargets.length;
  const recommendedPreset = choosePreset(frameworks, hasDockerOnly, hasHeadlessFallback);

  const metadata = {
    version: 1,
    scannedAt: new Date().toISOString(),
    workspaceRoot: WORKSPACE,
    frameworks: frameworks.map((fw) => ({
      id: fw.id,
      label: fw.label,
      preset: fw.preset,
      matches: fw.matches
    })),
    hasUi: frameworks.some((fw) => fw.hasUi),
    hasDocker: dockerTargets.length > 0,
    dockerTargets: dockerTargets.map((fw) => fw.matches).flat(),
    isMonorepo,
    recommendedPreset
  };

  writeMetadata(metadata);

  const stackSummary = metadata.frameworks.length
    ? metadata.frameworks.map((fw) => fw.label).join(', ')
    : 'Sin frameworks específicos';
  console.log(`🔍 Workspace analizado: ${WORKSPACE}`);
  console.log(`📦 Stacks detectados: ${stackSummary}`);
  console.log(`📁 Tipo: ${metadata.isMonorepo ? 'Monorepo' : 'Proyecto clásico'}`);
  console.log(`⭐ Preset sugerido: ${metadata.recommendedPreset}`);
  if (ARGS.has('--json')) {
    console.log(JSON.stringify(metadata, null, 2));
  }
};

try {
  main();
} catch (error) {
  console.error(`No se pudo escanear el proyecto: ${error.message || error}`);
  process.exitCode = 1;
}
