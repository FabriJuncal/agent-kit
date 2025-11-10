#!/usr/bin/env node
import fs from 'fs';
const outDir = 'agent/exports';
fs.mkdirSync(outDir,{recursive:true});
const angular = JSON.parse(fs.readFileSync('angular.json','utf8'));
fs.writeFileSync(`${outDir}/angular_workspace.json`, JSON.stringify({projects: Object.keys(angular.projects||{}), defaultProject: angular.defaultProject||null}, null, 2));
