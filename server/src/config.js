import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envNumber(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

const config = {
  host: process.env.RCH_HOST || '0.0.0.0',
  port: envNumber('RCH_PORT', 8742),
  dataDir: process.env.RCH_DATA_DIR || path.join(__dirname, '..', 'data'),
  // Uso real => false. En true, los eventos de input se loguean y NO se ejecutan:
  // sirve para pruebas seguras sin mover el mouse de la maquina.
  inputDryRun: envBool('RCH_INPUT_DRY_RUN', false),
  // En true, el audio recibido se guarda en un .wav en vez de reproducirse.
  audioDryRun: envBool('RCH_AUDIO_DRY_RUN', false),
  audioDevice: envNumber('RCH_AUDIO_DEVICE', -1),
  pairingCodeTtlMs: envNumber('RCH_PAIRING_TTL_MS', 120_000),
  sessionTtlDays: envNumber('RCH_SESSION_TTL_DAYS', 30),
  heartbeatMs: envNumber('RCH_HEARTBEAT_MS', 30_000),
  maxDevices: envNumber('RCH_MAX_DEVICES', 16),
  // Si se define RCH_ADMIN_TOKEN, toda la API de administracion exige este
  // token (Header "x-admin-token"). La UI de admin lo pide una vez.
  adminToken: process.env.RCH_ADMIN_TOKEN || '',
  // Abrir o no el navegador en la UI de admin al arrancar.
  openBrowser: envBool('RCH_OPEN_BROWSER', true),
  logLevel: process.env.RCH_LOG_LEVEL || 'info',
};

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export { config };