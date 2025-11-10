#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');

const MESSAGE = '🔔 El agente terminó su tarea';

function fileExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function linuxOptions() {
  const candidates = [];
  const completeOga = '/usr/share/sounds/freedesktop/stereo/complete.oga';
  if (fileExists(completeOga)) {
    candidates.push({ command: 'paplay', args: [completeOga], label: 'paplay (complete.oga)' });
  }
  candidates.push({ command: 'canberra-gtk-play', args: ['-i', 'complete'], label: 'canberra-gtk-play (complete)' });
  const bellOga = '/usr/share/sounds/freedesktop/stereo/bell.oga';
  if (fileExists(bellOga)) {
    candidates.push({ command: 'paplay', args: [bellOga], label: 'paplay (bell.oga)' });
  }
  candidates.push({ command: 'spd-say', args: ['Trabajo completado'], label: 'spd-say' });
  return candidates;
}

function getSoundOptions() {
  const platform = process.platform;

  if (platform === 'darwin') {
    const glass = '/System/Library/Sounds/Glass.aiff';
    return [{ command: '/usr/bin/afplay', args: [glass], label: 'afplay (Glass.aiff)' }];
  }

  if (platform === 'linux') {
    return linuxOptions();
  }

  if (platform === 'win32') {
    const script = [
      "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null",
      "[System.Reflection.Assembly]::LoadWithPartialName('System.Media') | Out-Null",
      '[System.Media.SystemSounds]::Exclamation.Play()',
      'Start-Sleep -Milliseconds 800'
    ].join('; ');
    return [{ command: 'powershell', args: ['-NoProfile', '-Command', script], label: 'PowerShell SystemSounds' }];
  }

  return [];
}

function playSound() {
  const options = getSoundOptions();
  if (!options.length) {
    process.stdout.write('\x07');
    return Promise.resolve('campana del sistema');
  }

  return new Promise((resolve, reject) => {
    const tryOption = (index) => {
      if (index >= options.length) {
        process.stdout.write('\x07');
        resolve('campana del sistema');
        return;
      }

      const option = options[index];
      const child = spawn(option.command, option.args, { stdio: 'ignore' });

      child.once('error', () => {
        tryOption(index + 1);
      });

      child.once('close', (code) => {
        if (code === 0 || code === null) {
          resolve(option.label);
        } else {
          tryOption(index + 1);
        }
      });
    };

    tryOption(0);
  });
}

async function main() {
  console.log(MESSAGE);
  const player = await playSound();
  console.log(`Sonido reproducido con ${player}.`);
}

main().catch((error) => {
  console.error('No se pudo reproducir el sonido:', error.message || error);
  process.stdout.write('\x07');
});
