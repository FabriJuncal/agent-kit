#!/usr/bin/env node
import fs from 'fs';
const outDir = 'agent/exports';
fs.mkdirSync(outDir, { recursive: true });
const manifest = {
  name: process.cwd().split('/').pop(),
  timestamp: new Date().toISOString(),
  dirs: fs.readdirSync('.').filter(d=>fs.existsSync(d) && fs.lstatSync(d).isDirectory() && !['vendor','node_modules','storage','.git','agent'].includes(d))
};
fs.writeFileSync(`${outDir}/project_manifest.json`, JSON.stringify(manifest, null, 2));
try { const pkg = JSON.parse(fs.readFileSync('package.json','utf8')); fs.writeFileSync(`${outDir}/npm_deps.json`, JSON.stringify({deps: pkg.dependencies||{}, dev: pkg.devDependencies||{}}, null, 2)); } catch(e){}
try { const comp = JSON.parse(fs.readFileSync('composer.lock','utf8')); fs.writeFileSync(`${outDir}/composer_deps.json`, JSON.stringify({packages: comp.packages||[], dev: comp['packages-dev']||[]}, null, 2)); } catch(e){}
