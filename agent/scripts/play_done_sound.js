#!/usr/bin/env node

const path = require('path');
const sound = require('../extensions/vscode-cursor-agent/lib/sound');

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--sound-file' && i + 1 < argv.length) {
      parsed.soundFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--message' && i + 1 < argv.length) {
      parsed.message = argv[i + 1];
      i += 1;
      continue;
    }
    console.warn(`Argumento desconocido: ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Uso: node agent/scripts/play_done_sound.js [opciones]

Opciones:
  --sound-file <ruta>   Usa un archivo de audio alternativo.
  --message <texto>     Sobrescribe el mensaje mostrado en consola.
  -h, --help            Muestra esta ayuda.
`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const extensionRoot = path.resolve(__dirname, '..', 'extensions', 'vscode-cursor-agent');
  const overrides =
    args.soundFile || args.message
      ? { soundFile: args.soundFile, soundMessage: args.message }
      : undefined;

  try {
    const result = await sound.runDoneSound({
      extensionRoot,
      settings: overrides,
      info: (message) => console.log(message),
      warn: (warning) => console.warn(warning)
    });
    console.log(`Archivo reproducido: ${result.soundFile}`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

run();
