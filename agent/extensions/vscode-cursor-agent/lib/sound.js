const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MESSAGE = '🔔 El agente terminó su trabajo';
const configCache = new Map();

function getSetting(settings, key) {
  if (!settings) {
    return undefined;
  }
  if (typeof settings.get === 'function') {
    return settings.get(key);
  }
  return settings[key];
}

function readFileConfig(extensionRoot, warn) {
  if (!extensionRoot) {
    return {};
  }

  const configPath = path.join(extensionRoot, 'config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (typeof warn === 'function') {
      warn(`Config de sonido inválida: ${error.message}`);
    }
    return {};
  }
}

function loadSoundConfig({ extensionRoot, settings, warn } = {}) {
  const cacheKey = extensionRoot || '__global__';
  if (configCache.has(cacheKey)) {
    return configCache.get(cacheKey);
  }

  const fileConfig = readFileConfig(extensionRoot, warn);
  const config = {
    soundFile: getSetting(settings, 'soundFile') || fileConfig.soundFile || '',
    message: getSetting(settings, 'soundMessage') || fileConfig.message || DEFAULT_MESSAGE
  };

  configCache.set(cacheKey, config);
  return config;
}

function clearSoundConfigCache(extensionRoot) {
  if (!extensionRoot) {
    configCache.clear();
    return;
  }
  const cacheKey = extensionRoot || '__global__';
  configCache.delete(cacheKey);
}

function resolveSoundFile({ configuredPath, extensionRoot } = {}) {
  const platform = process.platform;
  const defaultSound = platform === 'darwin' ? '/System/Library/Sounds/Glass.aiff' : configuredPath;
  const candidate = configuredPath || defaultSound;

  if (!candidate) {
    throw new Error('No se ha definido un archivo de sonido.');
  }

  const expanded = candidate.startsWith('~')
    ? path.join(os.homedir(), candidate.slice(1).replace(/^[\\/]/, ''))
    : candidate;

  const normalized = path.isAbsolute(expanded)
    ? expanded
    : path.join(extensionRoot || process.cwd(), expanded);

  if (!fs.existsSync(normalized)) {
    throw new Error('No se encontró el archivo de sonido configurado.');
  }

  return normalized;
}

function playSound(soundFile) {
  return new Promise((resolve, reject) => {
    const { command, args } = getPlayerCommand(process.platform, soundFile);

    if (!command) {
      reject(new Error('La plataforma actual no es compatible.'));
      return;
    }

    const child = spawn(command, args, { stdio: 'ignore' });

    child.once('error', () => reject(new Error('No se pudo reproducir el sonido.')));
    child.once('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error('El reproductor de sonido terminó con errores.'));
      }
    });
  });
}

function getPlayerCommand(platform, soundFile) {
  if (platform === 'darwin') {
    return { command: '/usr/bin/afplay', args: [soundFile] };
  }

  if (platform === 'linux') {
    return { command: 'paplay', args: [soundFile] };
  }

  if (platform === 'win32') {
    const escapedPath = soundFile.replace(/"/g, '""');
    const script = [
      '$player = New-Object System.Media.SoundPlayer',
      `$player.SoundLocation = "${escapedPath}"`,
      '$player.Load()',
      '$player.PlaySync()'
    ].join('; ');

    return { command: 'powershell', args: ['-NoProfile', '-Command', script] };
  }

  return { command: null, args: [] };
}

async function runDoneSound({ extensionRoot, settings, info, warn } = {}) {
  const config = loadSoundConfig({ extensionRoot, settings, warn });
  const soundFile = resolveSoundFile({ configuredPath: config.soundFile, extensionRoot });
  const message = config.message || DEFAULT_MESSAGE;

  if (typeof info === 'function') {
    info(message);
  }

  await playSound(soundFile);

  return { message, soundFile };
}

module.exports = {
  runDoneSound,
  loadSoundConfig,
  resolveSoundFile,
  playSound,
  clearSoundConfigCache
};
