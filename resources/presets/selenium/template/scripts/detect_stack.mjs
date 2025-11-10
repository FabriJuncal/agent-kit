#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const has = p => fs.existsSync(path.resolve(process.cwd(), p));
const pkg = has('package.json') ? JSON.parse(fs.readFileSync('package.json','utf8')) : null;

const signals = {
  laravel: [
    has('artisan'), has('bootstrap/app.php'), has('composer.json')
  ].every(Boolean),
  angular: [
    has('angular.json') || (pkg && ((pkg.dependencies||{})['@angular/core']))
  ].some(Boolean),
  nx: has('nx.json') || (pkg && ((pkg.devDependencies||{}).nx)),
  vite: (pkg && ((pkg.devDependencies||{}).vite)),
  nextjs: (pkg && ((pkg.dependencies||{}).next)),
};

const result = { signals };
console.log(JSON.stringify(result, null, 2));
