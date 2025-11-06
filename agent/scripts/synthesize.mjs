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
const seleniumCtxPath = `${outDir}/selenium_test_context.md`;
const hasSeleniumCtx = fs.existsSync(seleniumCtxPath);

// 1) Generar seeds compactos
const seeds = [];
if (manifest) seeds.push('exports/project_manifest.json');
if (composer) seeds.push('exports/composer_deps.json');
if (npm)      seeds.push('exports/npm_deps.json');
if (routesBE) seeds.push('exports/routes.json');
else if (routesTxt) seeds.push('exports/routes.txt');
if (routesFE) seeds.push('exports/fe_routes.json');
if (lmap)     seeds.push('exports/laravel_map.json');
if (hasSeleniumCtx) seeds.push('exports/selenium_test_context.md');

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
- Aprovechar los exports (incluyendo _selenium_test_context_) para mapear flujos críticos.
- Preparar y automatizar pruebas Selenium ordenadas cuando corresponda.

# <context-seeds>
- project_manifest, composer/npm deps, routes, laravel_map (http/views/types/helpers/assets/storage), selenium_test_context.

# <outputs>
- Pasos accionables + diffs + riesgos + rollback.
- Si se requieren pruebas end-to-end: enumerar casos de uso, generar Page Objects y tests Selenium (Python + pytest) con código limpio.
`;
fs.writeFileSync('agent/system_prompt.md', prompt);

console.log(JSON.stringify({seeds, prompt_bytes: prompt.length}, null, 2));
