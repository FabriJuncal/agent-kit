#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const has = (p) => fs.existsSync(path.resolve(cwd, p));
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const pkg = has('package.json') ? readJson('package.json') : null;
const composer = has('composer.json') ? readJson('composer.json') : null;

const hasDependency = (manifest, dependency) =>
  Boolean(
    manifest &&
      ['dependencies', 'devDependencies', 'peerDependencies', 'require'].some(
        (key) => manifest[key] && manifest[key][dependency]
      )
  );

const hasDirWithMultiple = (dir) => {
  const target = path.resolve(cwd, dir);
  if (!fs.existsSync(target)) return false;
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).length >= 2;
  } catch {
    return false;
  }
};

const signals = {
  laravel: ['artisan', 'bootstrap/app.php', 'composer.json'].map(has).every(Boolean),
  angular: has('angular.json') || hasDependency(pkg, '@angular/core'),
  ionic: has('ionic.config.json') || hasDependency(pkg, '@ionic/angular') || hasDependency(pkg, '@ionic/react'),
  nx: has('nx.json') || hasDependency(pkg, 'nx'),
  vite: hasDependency(pkg, 'vite'),
  nextjs: hasDependency(pkg, 'next'),
  react: hasDependency(pkg, 'react') || hasDependency(pkg, 'react-dom'),
  docker: ['docker-compose.yml', 'compose.yml', 'compose.yaml', 'Dockerfile'].some(has),
  monorepo:
    ['pnpm-workspace.yaml', 'pnpm-workspace.yml', 'turbo.json', 'lerna.json', 'workspace.json'].some(has) ||
    ['apps', 'packages', 'services', 'modules'].some(hasDirWithMultiple),
};

signals.headless =
  !signals.angular && !signals.nextjs && !signals.react && (Boolean(pkg) || Boolean(composer));

const result = { signals };
console.log(JSON.stringify(result, null, 2));
