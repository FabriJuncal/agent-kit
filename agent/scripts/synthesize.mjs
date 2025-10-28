#!/usr/bin/env node
import fs from 'fs';
const outDir = 'agent/exports';
const read = p=>{ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } };

const manifest  = read(`${outDir}/project_manifest.json`)||{};
const composer  = read(`${outDir}/composer_deps.json`);
const npm       = read(`${outDir}/npm_deps.json`);
const routesBE  = read(`${outDir}/routes.json`);
const routesTxt = fs.existsSync(`${outDir}/routes.txt`) ? true : false;
const routesFE  = read(`${outDir}/fe_routes.json`);
const lmap      = read(`${outDir}/laravel_map.json`);

// 1) Generar seeds compactos
const seeds = [];
if (manifest) seeds.push('exports/project_manifest.json');
if (composer) seeds.push('exports/composer_deps.json');
if (npm)      seeds.push('exports/npm_deps.json');
if (routesBE) seeds.push('exports/routes.json');
else if (routesTxt) seeds.push('exports/routes.txt');
if (routesFE) seeds.push('exports/fe_routes.json');
if (lmap)     seeds.push('exports/laravel_map.json');   // <— NUEVO

// 2) Escribir config.yaml mínimo
const yaml = `version: 1
project:
  name: ${manifest.name||'PROJECT'}
  root: .
context:
  seed:
${seeds.map(s=>`    - ${s}`).join('\n')}
  exclude: ["vendor/**","node_modules/**","storage/logs/**",".git/**"]
budgets:
  max_context_tokens: 12000
  soft_threshold: 9000
memory:
  type: file-notes
  path: agent/notes/AGENT_NOTES.md
`;
fs.writeFileSync('agent/config.yaml', yaml);

// 3) Prompt del sistema con pistas del stack
let stackHints = [];
if (composer) stackHints.push('Laravel');
if (npm && npm.deps && npm.deps['@angular/core']) stackHints.push('Angular');

const prompt = `# <role>
Agente para ${stackHints.join(' + ') || 'monorepo'} con foco en eficiencia de tokens.

# <objectives>
- Detectar problemas y proponer mejoras con evidencia.
- Usar exports compactos como mapa y abrir archivos puntuales.

# <context-seeds>
- project_manifest, composer/npm deps, routes, laravel_map (http/views/types/helpers/assets/storage).

# <outputs>
- Pasos accionables + diffs + riesgos + rollback.
`;
fs.writeFileSync('agent/system_prompt.md', prompt);

console.log(JSON.stringify({seeds, prompt_bytes: prompt.length}, null, 2));
