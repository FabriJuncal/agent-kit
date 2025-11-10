#!/usr/bin/env node
import { execSync } from 'child_process';
const out = {};
try { out.git = execSync('git log --pretty=oneline | wc -l').toString().trim(); } catch {}
try { out.files = execSync('git ls-files | wc -l').toString().trim(); } catch {}
console.log(JSON.stringify(out, null, 2));
