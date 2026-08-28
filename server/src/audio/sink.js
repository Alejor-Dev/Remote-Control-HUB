import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(__dirname, '..', '..', 'helpers', 'windows-audio.ps1');
const PS = 'powershell.exe';

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER];

// Sumidero de audio del lado PC: recibe PCM 16-bit LE del cliente y lo envia a
// un helper waveOut persistente (reproduccion) o a un .wav por sesión (captura).
// Aplica ganancia (volumen/mute) en servidor por bloque.
//
// - Modo reproduccion: el helper se levanta una vez y se reutiliza entre
//   sesiones para evitar la latencia de arranque de PowerShell (~1s) al volver
//   a usar el micrófono.
// - Modo captura: cada sesión usa un proceso propio que finaliza el archivo al
//   cerrar el stream, para que el .raw quede listo al detenerse.
export class AudioSink {
  constructor(log = () => {}) {
    this.log = log;
    this.child = null;
    this.exitPromise = null;
    this.volume = 1;
    this.rate = 48000;
    this.channels = 1;
    this.running = false;
    this.bytesDelivered = 0;
    this.bytesDropped = 0;
  }

  start({ rate = 48000, channels = 1, volume = 1 } = {}) {
    this.rate = rate;
    this.channels = channels;
    this.volume = Math.max(0, Math.min(1, volume));
    this.running = true;
    this.bytesDelivered = 0;
    this.bytesDropped = 0;

    // En modo reproduccion se reutiliza el helper persistente ya vivo.
    if (!config.audioDryRun && this.child && this.child.stdin.writable) {
      this.log('info', '[audio] sesión reutilizando helper vivo');
      return;
    }
    this.#spawn();
  }

  #spawn() {
    const dryRun = config.audioDryRun;
    const outFile = path.join(config.dataDir, 'capture.raw');
    const args = dryRun
      ? [...PS_ARGS, '-DryRun', '-OutFile', outFile, '-Rate', String(this.rate), '-Channels', String(this.channels)]
      : [...PS_ARGS, '-Rate', String(this.rate), '-Channels', String(this.channels), '-Device', String(config.audioDevice)];

    this.log('info', `[audio] abriendo sink rate=${this.rate} ch=${this.channels} dry=${dryRun}`);
    const child = spawn(PS, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (d) => this.log('debug', `[audio>] ${d.toString().trim()}`));
    child.stderr.on('data', (d) => this.log('error', `[audio!] ${d.toString().trim()}`));
    child.on('exit', (code) => {
      this.log('info', `[audio] helper terminado (code=${code})`);
      this.child = null;
    });
    this.child = child;
    this.exitPromise = new Promise((res) => child.once('exit', () => res()));
  }

  get active() {
    return this.running && !!this.child && this.child.stdin.writable;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
  }

  // Aplica una ganancia lineal a una cadena de PCM16 LE.
  #applyGain(buffer, gain) {
    const out = Buffer.allocUnsafe(buffer.length);
    for (let i = 0; i + 1 < buffer.length; i += 2) {
      const s = buffer.readInt16LE(i);
      const scaled = Math.max(-32768, Math.min(32767, Math.round(s * gain)));
      out.writeInt16LE(scaled, i);
    }
    return out;
  }

  write(chunk) {
    if (!this.active) {
      this.bytesDropped += chunk.length;
      return;
    }
    const data = this.volume >= 1 ? chunk : this.#applyGain(chunk, this.volume);
    try {
      this.child.stdin.write(data);
      this.bytesDelivered += chunk.length;
    } catch {
      this.bytesDropped += chunk.length;
    }
  }

  // Detiene la sesión actual.
  // - Reproduccion: deja de alimentar al helper persistente (sigue vivo).
  // - Captura: cierra stdin para que el helper finalice el archivo .raw.
  stop() {
    this.running = false;
    if (config.audioDryRun && this.child) {
      const child = this.child;
      this.child = null;
      try {
        child.stdin.end();
      } catch {}
      this.exitPromise = new Promise((res) => child.once('exit', () => res()));
    }
  }

  // Promesa que se resuelve cuando el helper actual termina (útil para tests).
  waitIdle() {
    return this.exitPromise || Promise.resolve();
  }
}

// Lista dispositivos de salida disponibles ("N:N0|Nombre0;N1|Nombre1").
export function listWindowsAudioDevices() {
  return new Promise((resolve) => {
    const child = spawn(PS, [...PS_ARGS, '-ListDevices'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => resolve(out.trim()));
  });
}