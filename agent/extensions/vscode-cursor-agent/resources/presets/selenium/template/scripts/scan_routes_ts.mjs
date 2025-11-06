#!/usr/bin/env node
import fs from 'fs';
import { glob } from 'glob';
const files = await glob('**/*.{routes,routing}.ts', { ignore: ['node_modules/**','dist/**','agent/**'] });
const items = [];
for (const f of files) {
  const code = fs.readFileSync(f,'utf8');
  const matches = [...code.matchAll(/path:\s*['"]([^'"\n]+)['"]/g)].map(m=>m[1]);
  items.push({file: f, paths: matches.slice(0,50)});
}
fs.mkdirSync('agent/exports',{recursive:true});
fs.writeFileSync('agent/exports/fe_routes.json', JSON.stringify({routes: items}, null, 2));
