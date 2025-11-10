#!/usr/bin/env node
/**
 * Escaneo profundo del árbol Laravel para generar un mapa compacto:
 * - app/Http (Controllers, Middleware, Requests)
 * - app/Http/Kernel.php (middleware groups y routeMiddleware)
 * - app/Types (enums/clases)
 * - app/Helpers (funciones)
 * - resources/views (blades y components)
 * - resources/js y resources/css (entry points)
 * - storage (subcarpetas y conteos)
 *
 * Sin dependencias externas. 100% Node stdlib.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUTDIR = path.join(ROOT, 'agent/exports');
fs.mkdirSync(OUTDIR, { recursive: true });

const exists = (p) => fs.existsSync(p);
const isDir = (p) => exists(p) && fs.lstatSync(p).isDirectory();
const isFile = (p) => exists(p) && fs.lstatSync(p).isFile();

const REL = (p) => path.relative(ROOT, p);

const IGNORE_DIRS = new Set(['vendor','node_modules','.git','agent','storage/framework/cache','storage/logs']);

/** Walk recursivo con filtros sencillos */
function walk(dir, out = [], filterFile = () => true) {
  if (!isDir(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = REL(p);
    if (IGNORE_DIRS.has(name)) continue;
    try {
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p, out, filterFile);
      else if (st.isFile()) {
        if (filterFile(p, name, rel)) out.push(p);
      }
    } catch {}
  }
  return out;
}

/** Helpers de parsing simple */
function readSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function matchAll(re, s) { return [...s.matchAll(re)].map(m=>m[1]); }
function uniq(arr) { return [...new Set(arr)]; }

/** 1) app/Http subtree */
const HTTP_DIR = path.join(ROOT, 'app/Http');
const httpFiles = walk(HTTP_DIR, [], (p, name) => name.endsWith('.php'));
const controllers = httpFiles.filter(p => /\/Controllers\/.+\.php$/.test(p)).map(REL);
const middleware = httpFiles.filter(p => /\/Middleware\/.+\.php$/.test(p)).map(REL);
const requests = httpFiles.filter(p => /\/Requests\/.+\.php$/.test(p)).map(REL);

/** 2) Kernel.php → middleware groups y routeMiddleware */
const KERNEL = path.join(ROOT, 'app/Http/Kernel.php');
const kernelSrc = readSafe(KERNEL);
function extractArrayMap(name) {
  // e.g. protected $middlewareGroups = [ 'web' => [ ... ], 'api' => [ ... ] ];
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const m = kernelSrc.match(re);
  if (!m) return {};
  const body = m[1];
  // "key" => [ ... ], 'key' => [...]
  const itemRe = /['"]([^'"]+)['"]\s*=>\s*\[([\s\S]*?)\]/g;
  const out = {};
  let im;
  while ((im = itemRe.exec(body)) !== null) {
    const key = im[1];
    const val = im[2];
    const entries = matchAll(/['"]([^'"]+)['"]/g, val);
    out[key] = uniq(entries);
  }
  return out;
}
function extractArrayList(name) {
  // e.g. protected $middleware = [ \App\...\::class, ... ];
  const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
  const m = kernelSrc.match(re);
  if (!m) return [];
  const entries = matchAll(/['"]([^'"]+)['"]|::class/g, m[1])
    .map(x => x || '') // when ::class matched, previous group may be empty
    .filter(Boolean);
  return uniq(entries);
}
const kernel = {
  middleware: extractArrayList('protected\\s+\\$middleware'),
  middlewareGroups: extractArrayMap('protected\\s+\\$middlewareGroups'),
  routeMiddleware: extractArrayMap('protected\\s+\\$routeMiddleware'),
};

/** 3) app/Types → enums/clases */
const TYPES_DIR = path.join(ROOT, 'app/Types');
const typeFiles = walk(TYPES_DIR, [], (p, name) => name.endsWith('.php'));
const types = typeFiles.map((p) => {
  const src = readSafe(p);
  const isEnum = /(^|\s)enum\s+([A-Za-z_][A-Za-z0-9_]*)/m.test(src);
  const enumName = (src.match(/(^|\s)enum\s+([A-Za-z_][A-Za-z0-9_]*)/m)||[])[2] || null;
  const className = (src.match(/(^|\s)class\s+([A-Za-z_][A-Za-z0-9_]*)/m)||[])[2] || null;
  const constants = matchAll(/case\s+([A-Za-z_][A-Za-z0-9_]*)/g, src);
  return {
    file: REL(p),
    kind: isEnum ? 'enum' : 'class',
    name: enumName || className,
    enumCases: isEnum ? constants : [],
  };
});

/** 4) app/Helpers → funciones globales */
const HELPERS_DIR = path.join(ROOT, 'app/Helpers');
const helperFiles = walk(HELPERS_DIR, [], (p, name) => name.endsWith('.php'));
const helpers = helperFiles.map((p) => {
  const src = readSafe(p);
  const funcs = matchAll(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, src);
  return { file: REL(p), functions: uniq(funcs) };
});

/** 5) resources/views → blades y components */
const VIEWS_DIR = path.join(ROOT, 'resources/views');
const bladeFiles = walk(VIEWS_DIR, [], (p, name) => name.endsWith('.blade.php'));
function bladeNameFromPath(p) {
  // resources/views/admin/users/index.blade.php -> admin.users.index
  const rel = path.relative(VIEWS_DIR, p);
  const noExt = rel.replace(/\.blade\.php$/, '');
  return noExt.split(path.sep).join('.');
}
const views = bladeFiles.map((p) => {
  const src = readSafe(p);
  // detectar includes/componentes usados
  const includes = uniq([
    ...matchAll(/@include\(\s*['"]([^'"]+)['"]/g, src),
    ...matchAll(/@includeIf\(\s*['"]([^'"]+)['"]/g, src),
    ...matchAll(/@includeWhen\([^)]+['"]([^'"]+)['"]/g, src),
  ]);
  const components = uniq([
    ...matchAll(/<x-([a-zA-Z0-9\.\-\:]+)[\s>]/g, src),
    ...matchAll(/@component\(\s*['"]([^'"]+)['"]/g, src),
  ]);
  return {
    file: REL(p),
    name: bladeNameFromPath(p),
    includes,
    components
  };
});

// components folder
const COMPONENTS_DIR = path.join(VIEWS_DIR, 'components');
const viewComponents = isDir(COMPONENTS_DIR)
  ? walk(COMPONENTS_DIR, [], (p, n) => n.endsWith('.blade.php')).map(REL)
  : [];

/** 6) resources/js y resources/css */
const JS_DIR = path.join(ROOT, 'resources/js');
const CSS_DIR = path.join(ROOT, 'resources/css');
const jsFiles = walk(JS_DIR, [], (p, n)=> /\.(m?jsx?|tsx?)$/.test(n)).map(REL).slice(0, 200);
const cssFiles = walk(CSS_DIR, [], (p, n)=> /\.(s?css|postcss)$/.test(n)).map(REL).slice(0, 200);

/** 7) storage (subcarpetas y conteos) */
const STORAGE_DIR = path.join(ROOT, 'storage');
const storageTop = isDir(STORAGE_DIR) ? fs.readdirSync(STORAGE_DIR)
  .filter(n => !['framework/cache','logs'].includes(n))
  .map(n => path.join(STORAGE_DIR, n)) : [];
const storageSummary = storageTop.map((p) => {
  let files = 0;
  let bytes = 0;
  const maxCount = 2000; // evita recorrer infinito
  function walkStorage(d) {
    for (const name of fs.readdirSync(d)) {
      const q = path.join(d, name);
      const st = fs.lstatSync(q);
      if (st.isDirectory()) walkStorage(q);
      else {
        files++; bytes += st.size || 0;
        if (files > maxCount) return;
      }
    }
  }
  try { isDir(p) && walkStorage(p); } catch {}
  return { dir: REL(p), files, approxBytes: bytes };
});

/** 8) routes/*.php lista (además de artisan route:list) */
const ROUTES_DIR = path.join(ROOT, 'routes');
const routePhpFiles = walk(ROUTES_DIR, [], (p, n)=> n.endsWith('.php')).map(REL);

/** 9) Resultado */
const result = {
  generatedAt: new Date().toISOString(),
  http: {
    controllers,
    middleware,
    requests,
    kernel, // middleware, groups, routeMiddleware
  },
  types,
  helpers,
  views: {
    blades: views,
    components: viewComponents,
  },
  assets: {
    js: jsFiles,
    css: cssFiles,
  },
  storage: storageSummary,
  routesPhpFiles: routePhpFiles,
};

fs.writeFileSync(path.join(OUTDIR, 'laravel_map.json'), JSON.stringify(result, null, 2));
console.log(`Wrote ${REL(path.join(OUTDIR,'laravel_map.json'))}`);
