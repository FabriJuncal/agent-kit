const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

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
  '.output'
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
        patterns: [
          'next.config.js',
          'next.config.ts',
          'next.config.mjs',
          '**/next.config.js',
          '**/next.config.ts',
          '**/next.config.mjs'
        ]
      }
    ]
  },
  {
    id: 'react',
    label: 'React',
    preset: 'react',
    ui: true,
    matchers: [
      {
        type: 'packageDependency',
        dependency: 'react',
        filePatterns: ['package.json', '**/package.json']
      },
      {
        type: 'file',
        patterns: ['src/App.tsx', 'src/App.jsx', '**/src/App.tsx', '**/src/App.jsx']
      }
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
      {
        type: 'file',
        patterns: [
          'docker-compose.yml',
          'compose.yml',
          'compose.yaml',
          'Dockerfile',
          '**/docker-compose.yml',
          '**/Dockerfile'
        ]
      }
    ]
  }
];

function resolveAbsolute(workspaceRoot, relativePath) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(workspaceRoot, relativePath);
}

function pathMatchesPattern(workspaceRoot, pattern, options = {}) {
  if (!workspaceRoot || !pattern) {
    return false;
  }
  const normalized = pattern.replace(/\\/g, '/');
  if (normalized.startsWith('**/')) {
    const fileName = normalized.slice(3);
    const matches = findFilesByName(workspaceRoot, fileName, options.maxDepth || DEFAULT_MAX_DEPTH);
    return matches.length > 0;
  }
  const target = resolveAbsolute(workspaceRoot, pattern);
  return fs.existsSync(target);
}

function findFilesByName(workspaceRoot, fileName, maxDepth = DEFAULT_MAX_DEPTH) {
  if (!workspaceRoot || !fileName) {
    return [];
  }

  const matches = [];
  const queue = [{ dir: workspaceRoot, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth) {
      continue;
    }

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
}

function readJsonFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    // swallow parse errors, the caller will ignore the dependency
  }
  return null;
}

function detectPackageDependency(workspaceRoot, dependency, options = {}) {
  const patterns = options.filePatterns || ['package.json'];
  for (const pattern of patterns) {
    if (pattern.startsWith('**/')) {
      const name = pattern.slice(3);
      const files = findFilesByName(workspaceRoot, name, options.maxDepth || DEFAULT_MAX_DEPTH);
      for (const file of files) {
        const pkg = readJsonFile(file);
        if (pkg && hasDependency(pkg, dependency)) {
          return file;
        }
      }
    } else {
      const absolute = resolveAbsolute(workspaceRoot, pattern);
      const pkg = readJsonFile(absolute);
      if (pkg && hasDependency(pkg, dependency)) {
        return absolute;
      }
    }
  }
  return null;
}

function detectComposerDependency(workspaceRoot, dependency) {
  const composerFiles = findFilesByName(workspaceRoot, 'composer.json', DEFAULT_MAX_DEPTH);
  for (const file of composerFiles) {
    const composer = readJsonFile(file);
    if (composer && hasDependency(composer, dependency)) {
      return file;
    }
  }
  return null;
}

function hasDependency(manifest, dependency) {
  if (!manifest) {
    return false;
  }
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'require'];
  return buckets.some((bucket) => manifest[bucket] && manifest[bucket][dependency]);
}

function detectFrameworks(workspaceRoot, options = {}) {
  const maxDepth = options.maxDepth || DEFAULT_MAX_DEPTH;
  const frameworks = [];

  STACK_INDICATORS.forEach((indicator) => {
    const info = { id: indicator.id, label: indicator.label, preset: indicator.preset, matches: [] };
    indicator.matchers.forEach((matcher) => {
      if (matcher.type === 'file') {
        matcher.patterns.forEach((pattern) => {
          if (pathMatchesPattern(workspaceRoot, pattern, { maxDepth })) {
            const normalized = pattern.startsWith('**/') ? pattern.slice(3) : pattern;
            info.matches.push(normalized);
          }
        });
      } else if (matcher.type === 'packageDependency') {
        const dependencyFile = detectPackageDependency(workspaceRoot, matcher.dependency, {
          filePatterns: matcher.filePatterns,
          maxDepth
        });
        if (dependencyFile) {
          info.matches.push(path.relative(workspaceRoot, dependencyFile));
        }
      } else if (matcher.type === 'composerDependency') {
        const composerFile = detectComposerDependency(workspaceRoot, matcher.dependency);
        if (composerFile) {
          info.matches.push(path.relative(workspaceRoot, composerFile));
        }
      }
    });

    if (info.matches.length) {
      info.hasUi = Boolean(indicator.ui);
      frameworks.push(info);
    }
  });

  return frameworks;
}

function detectDockerTargets(frameworks) {
  return frameworks.filter((framework) => framework.id === 'docker');
}

function detectHeadlessFallback(workspaceRoot) {
  const hasComposer = pathMatchesPattern(workspaceRoot, 'composer.json') || findFilesByName(workspaceRoot, 'composer.json', DEFAULT_MAX_DEPTH).length > 0;
  const hasPkg = pathMatchesPattern(workspaceRoot, 'package.json') || findFilesByName(workspaceRoot, 'package.json', DEFAULT_MAX_DEPTH).length > 0;
  return hasComposer || hasPkg;
}

function detectMonorepo(workspaceRoot) {
  const manifestCandidates = ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'turbo.json', 'nx.json', 'lerna.json', 'workspace.json'];
  if (manifestCandidates.some((file) => pathMatchesPattern(workspaceRoot, file, { maxDepth: 1 }))) {
    return true;
  }

  const candidateDirs = ['apps', 'packages', 'services', 'modules'];
  return candidateDirs.some((dir) => hasMultipleSubdirectories(workspaceRoot, dir));
}

function hasMultipleSubdirectories(workspaceRoot, relativeDir) {
  const absolute = path.join(workspaceRoot, relativeDir);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    return false;
  }
  try {
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length >= 2;
  } catch {
    return false;
  }
}

function choosePreset(frameworks, hasDockerOnly, hasHeadlessFallback) {
  const priority = ['angular', 'ionic', 'next', 'react', 'laravel'];
  for (const id of priority) {
    if (frameworks.some((fw) => fw.id === id)) {
      return id;
    }
  }
  if (hasDockerOnly) {
    return 'docker';
  }
  if (hasHeadlessFallback) {
    return 'headless';
  }
  return 'generic';
}

async function scanWorkspace(workspaceRoot, options = {}) {
  if (!workspaceRoot) {
    throw new Error('No se definió la ruta del workspace.');
  }

  const frameworks = detectFrameworks(workspaceRoot, options);
  const dockerTargets = detectDockerTargets(frameworks);
  const hasUi = frameworks.some((fw) => fw.hasUi);
  const isMonorepo = detectMonorepo(workspaceRoot);
  const hasHeadlessFallback = detectHeadlessFallback(workspaceRoot);
  const hasDockerOnly = frameworks.length === dockerTargets.length && dockerTargets.length > 0;
  const recommendedPreset = choosePreset(frameworks, hasDockerOnly, hasHeadlessFallback);

  return {
    version: 1,
    scannedAt: new Date().toISOString(),
    workspaceRoot,
    frameworks: frameworks.map((framework) => ({
      id: framework.id,
      label: framework.label,
      preset: framework.preset,
      matches: framework.matches
    })),
    hasUi,
    hasDocker: dockerTargets.length > 0,
    dockerTargets: dockerTargets.map((fw) => fw.matches).flat(),
    isMonorepo,
    recommendedPreset
  };
}

async function writeMetadata(workspaceRoot, metadata) {
  if (!workspaceRoot || !metadata) {
    return;
  }
  const target = path.join(workspaceRoot, PROJECT_METADATA_FILE);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, JSON.stringify(metadata, null, 2), 'utf-8');
  return target;
}

function readMetadata(workspaceRoot) {
  if (!workspaceRoot) {
    return null;
  }
  const target = path.join(workspaceRoot, PROJECT_METADATA_FILE);
  if (!fs.existsSync(target)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(target, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`No se pudo leer project_metadata.json: ${error.message}`);
    return null;
  }
}

module.exports = {
  PROJECT_METADATA_FILE,
  scanWorkspace,
  writeMetadata,
  readMetadata,
  pathMatchesPattern
};
