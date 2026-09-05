import { spawn } from 'node:child_process';
import { config, ensureDataDir } from './config.js';
import { DeviceManager, PairingManager } from './security.js';
import { InputController } from './input/controller.js';
import { AudioSink } from './audio/sink.js';
import { HttpServer } from './http.js';
import { ControlServer } from './ws.js';
import { getLocalIPv4s } from './ip.js';

const LEVELS = { debug: 10, info: 20, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const log = (kind, message) => {
  const lv = LEVELS[kind];
  if (lv === undefined) return;
  if (lv < threshold) return;
  const ts = new Date().toISOString().slice(11, 23);
  console[ld(kind)](`[${ts}] ${message}`);
};
function ld(kind) {
  return kind === 'error' ? 'error' : 'info';
}

const devices = new DeviceManager();
const pairing = new PairingManager(devices);
const input = new InputController(log);
const audio = new AudioSink(log);

export const appState = { http: null, ws: null };

export async function start() {
  ensureDataDir();
  devices.cleanup();
  input.start();

  const httpServer = new HttpServer({ devices, pairing, input, audio, log });
  const server = await httpServer.start();
  appState.http = server;

  const ws = new ControlServer({ httpServer: server, tlsServer: httpServer.tlsServer, devices, pairing, input, audio, log });
  ws.start();
  appState.ws = ws;

  const { hostname, httpHostname } = httpServer.getUrls();
  log('info', `Remote Control Hub en ${hostname}`);
  if (httpHostname) log('info', `Panel/QR en ${httpHostname}`);
  if (config.inputDryRun) log('warn', 'MODO PRUEBA input: los eventos NO se ejecutan en la PC');
  if (config.audioDryRun) log('warn', 'MODO PRUEBA audio: el audio se captura a data/capture.raw, no se reproduce');

  if (config.openBrowser && process.env.RCH_NO_OPEN !== '1') {
    setTimeout(() => {
      try {
        spawn('cmd', ['/c', 'start', '', httpHostname || hostname], { windowsHide: true, detached: true, stdio: 'ignore' });
      } catch (err) {
        log('debug', `no se pudo abrir el navegador: ${err.message}`);
      }
    }, 400);
  }
}

function shutdown() {
  log('info', 'apagando...');
  try {
    audio.stop();
    input.stop();
    appState.ws?.stop();
    appState.http?.close();
  } catch {}
  setTimeout(() => process.exit(0), 200);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('index.js')) {
  start().catch((err) => {
    log('error', `arranque fallido: ${err.stack}`);
    process.exit(1);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { devices, pairing, input, audio, log };