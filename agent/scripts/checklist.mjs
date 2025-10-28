#!/usr/bin/env node
import fs from 'fs';
function ok(p){return fs.existsSync(p);}
const req = ['agent/config.yaml','agent/system_prompt.md','agent/exports/project_manifest.json'];
const missing = req.filter(p=>!ok(p));
console.log(JSON.stringify({ok: missing.length===0, missing}, null, 2));
process.exit(missing.length?1:0);
