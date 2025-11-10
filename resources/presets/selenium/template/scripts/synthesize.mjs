#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const outDir = 'agent/exports';
const notesPath = 'agent/notes/AGENT_NOTES.md';

const readJson = (target) => {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
};

const manifest = readJson(path.join(outDir, 'project_manifest.json')) || {};
const composerDeps = readJson(path.join(outDir, 'composer_deps.json'));
const npmDeps = readJson(path.join(outDir, 'npm_deps.json'));
const signals = readJson(path.join(outDir, 'signals.json'));
const metadata = readJson(path.join(outDir, 'project_metadata.json'));
const routesJson = readJson(path.join(outDir, 'routes.json'));
const routesTxtPath = fs.existsSync(path.join(outDir, 'routes.txt')) ? path.join(outDir, 'routes.txt') : null;
const routesFE = readJson(path.join(outDir, 'fe_routes.json'));
const laravelMap = readJson(path.join(outDir, 'laravel_map.json'));
const seleniumCtxPath = path.join(outDir, 'selenium_test_context.md');
const hasSeleniumCtx = fs.existsSync(seleniumCtxPath);

const writeDepsSummary = () => {
  const sections = [];
  if (composerDeps && Array.isArray(composerDeps.packages)) {
    const topComposer = composerDeps.packages.slice(0, 12).map((pkg) => `- ${pkg.name} (${pkg.version || 'latest'})`);
    if (topComposer.length) {
      sections.push('## Composer (principales)', '', ...topComposer, '');
    }
  }
  if (npmDeps && npmDeps.deps) {
    const topNpm = Object.entries(npmDeps.deps)
      .slice(0, 12)
      .map(([name, version]) => `- ${name}@${version}`);
    if (topNpm.length) {
      sections.push('## npm (principales)', '', ...topNpm, '');
    }
  }
  if (!sections.length) {
    return false;
  }
  const content = ['# Dependencies Summary', '', ...sections].join('\n');
  fs.writeFileSync(path.join(outDir, 'deps_summary.md'), content.trim() + '\n');
  return true;
};

const writeRoutesSummary = () => {
  const summaryPath = path.join(outDir, 'routes_summary.md');
  const lines = ['# Routes Summary', ''];
  let hasContent = false;
  if (Array.isArray(routesJson) && routesJson.length) {
    const webRoutes = routesJson.filter((route) => route.method && /GET|HEAD/i.test(route.method));
    webRoutes.slice(0, 40).forEach((route) => {
      lines.push(`- \`${route.method}\` ${route.uri} → ${route.action || 'closure'}`);
    });
    if (webRoutes.length > 40) {
      lines.push(`- ... (${webRoutes.length - 40} rutas adicionales en routes.json)`);
    }
    hasContent = webRoutes.length > 0;
  } else if (routesTxtPath) {
    const raw = fs.readFileSync(routesTxtPath, 'utf8');
    raw
      .split('\n')
      .filter(Boolean)
      .slice(0, 40)
      .forEach((line) => lines.push(`- ${line}`));
    hasContent = raw.trim().length > 0;
  }
  if (!hasContent) {
    return false;
  }
  fs.writeFileSync(summaryPath, lines.join('\n') + '\n');
  return true;
};

const depsSummaryWritten = writeDepsSummary();
const routesSummaryWritten = writeRoutesSummary();

const seeds = [];
if (manifest) seeds.push('exports/project_manifest.json');
if (fs.existsSync(path.join(outDir, 'project_metadata.json'))) seeds.push('exports/project_metadata.json');
if (fs.existsSync(path.join(outDir, 'signals.json'))) seeds.push('exports/signals.json');
if (depsSummaryWritten) seeds.push('exports/deps_summary.md');
if (routesSummaryWritten) seeds.push('exports/routes_summary.md');
if (routesFE) seeds.push('exports/fe_routes.json');
if (laravelMap) seeds.push('exports/laravel_map.json');
if (hasSeleniumCtx) seeds.push('exports/selenium_test_context.md');

const yaml = `version: 1
project:
  name: ${manifest.name || 'PROJECT'}
  root: .
context:
  seed:
${seeds.map((s) => `    - ${s}`).join('\n')}
  exclude: ["vendor/**","node_modules/**","storage/logs/**",".git/**"]
budgets:
  max_context_tokens: 12000
  soft_threshold: 9000
compaction:
  on_soft_threshold:
    summarize_history_to_tokens: 800
    keep_last_messages: 6
    drop_tool_outputs_older_than_hours: 6
memory:
  type: file-notes
  path: agent/notes/AGENT_NOTES.md
`;
fs.writeFileSync('agent/config.yaml', yaml);

const stackHints = [];
if (signals?.signals?.laravel) stackHints.push('Laravel');
if (signals?.signals?.angular) stackHints.push('Angular');
if (signals?.signals?.nextjs) stackHints.push('Next.js');
if (signals?.signals?.react && !stackHints.includes('React')) stackHints.push('React');
if (metadata?.isMonorepo) stackHints.push('Monorepo');

const prompt = `# <role>
Agente para ${stackHints.join(' + ') || 'entorno híbrido'} con foco en eficiencia de tokens.

# <objectives>
- Mantener los exports (seed) como fuente única de verdad y actualizarlos cuando falte contexto.
- Documentar cambios relevantes en agent/notes/AGENT_NOTES.md en lugar de repetirlos en la ventana de tokens.
- Preparar pruebas E2E/Selenium basadas en \`selenium_test_context.md\`, rutas y laravel_map cuando aplique.

# <context-seeds>
- project_manifest, project_metadata, signals, deps_summary, routes_summary, laravel_map y selenium_test_context (cuando exista).

# <outputs>
- Pasos accionables, diffs propuestos y riesgos + rollback.
- Para pruebas: describir casos, Page Objects y scripts Selenium (Python + pytest) reutilizables.
`;
fs.writeFileSync('agent/system_prompt.md', prompt);

if (!fs.existsSync(notesPath)) {
  fs.mkdirSync(path.dirname(notesPath), { recursive: true });
  fs.writeFileSync(
    notesPath,
    `# Decisions\n- Registra aquí endpoints, formularios y acuerdos clave.\n\n# Todos\n- [ ] Mantener la metadata del proyecto al día (node agent/scripts/scan_project.mjs).\n\n# References\n- agent/notes/selenium-agent.md\n`,
    'utf8'
  );
}

console.log(JSON.stringify({ seeds, prompt_bytes: prompt.length }, null, 2));
