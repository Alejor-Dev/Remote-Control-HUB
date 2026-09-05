import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { config, ensureDataDir } from './config.js';
import { getLocalIPv4s } from './ip.js';
import { getTlsOptions } from './tls.js';
import { listWindowsAudioDevices } from './audio/sink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_HTML = path.join(__dirname, 'ui', 'admin.html');
const APP_DIR = path.join(__dirname, '..', 'public', 'app');
const SHARED_DIR = path.join(__dirname, '..', '..', 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export class HttpServer {
  constructor({ devices, pairing, input, audio, apps = [], log = () => {} }) {
    this.devices = devices;
    this.pairing = pairing;
    this.input = input;
    this.audio = audio;
    this.log = log;
    this.startedAt = Date.now();
  }

  start() {
    this.server = http.createServer((req, res) => this.#handle(req, res));
    this.tlsServer = null;
    const tlsOptions = getTlsOptions();
    if (tlsOptions) {
      this.tlsServer = https.createServer(tlsOptions, (req, res) => this.#handle(req, res));
    }
    return new Promise((resolve) => {
      const listening = [this.server.listen(config.port, config.host)];
      if (this.tlsServer) {
        listening.push(this.tlsServer.listen(config.tlsPort, config.host));
      }
      Promise.all(
        listening.map(
          (srv) =>
            new Promise((res) => {
              srv.once('listening', res);
              srv.once('error', res);
            }),
        ),
      ).then(() => resolve(this.server));
    });
  }

  getUrls() {
    const ips = getLocalIPv4s();
    const ip = ips[0]?.address || '127.0.0.1';
    if (this.tlsServer) {
      return {
        ips: ips.map((i) => i.address),
        hostname: `https://${ip}:${config.tlsPort}`,
        httpHostname: `http://${ip}:${config.port}`,
      };
    }
    return {
      ips: ips.map((i) => i.address),
      hostname: `http://${ips[0]?.address || '127.0.0.1'}:${config.port}`,
    };
  }

  #json(res, code, body) {
    const payload = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  }

  #page(res, file, noCache = false) {
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
      if (noCache) headers['Cache-Control'] = 'no-cache, must-revalidate';
      res.writeHead(200, headers);
      res.end(data);
    });
  }

  #guardAdmin(req, res, next) {
    if (config.adminToken && req.headers['x-admin-token'] !== config.adminToken) {
      this.#json(res, 401, { error: 'admin_token_required' });
      return false;
    }
    next();
    return true;
  }

  #readJson(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 16 * 1024) {
          resolve(null);
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          resolve(null);
        }
      });
    });
  }

  async #handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;

    try {
      // --- Admin UI + PWA (estaticos) ---
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        return this.#page(res, ADMIN_HTML);
      }
      if (req.method === 'GET' && p.startsWith('/app')) {
        let rel = p.slice(4).replace(/\\/g, '/').replace(/^\/+/, '') || 'index.html';
        const file = path.join(APP_DIR, rel);
        if (!file.startsWith(APP_DIR)) return this.#json(res, 403, { error: 'forbidden' });
        return this.#page(res, file, true);
      }

      if (req.method === 'GET' && p.startsWith('/shared/')) {
        const rel = p.slice('/shared/'.length).replace(/^\/+/, '') || 'protocol.js';
        const file = path.join(SHARED_DIR, rel.replace(/\\/g, '/'));
        if (!file.startsWith(SHARED_DIR)) return this.#json(res, 403, { error: 'forbidden' });
        return this.#page(res, file, true);
      }

      // --- API ---
      if (!p.startsWith('/api/')) return this.#json(res, 404, { error: 'not_found' });

      if (req.method === 'GET' && p === '/api/qr') {
        return this.#guardAdmin(req, res, async () => {
          const { hostname } = this.getUrls();
          const url = `${hostname}/app`;
          const dataUrl = await QRCode.toDataURL(url, {
            width: 420,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' },
          });
          this.#json(res, 200, { url, dataUrl });
        });
      }

      if (req.method === 'GET' && p === '/api/status') {
        return this.#guardAdmin(req, res, async () => {
          const { ips, hostname } = this.getUrls();
          const inputEvents = this.input.dryLog ? this.input.dryLog.slice(-25) : [];
          let audioDevices = null;
          if (process.platform === 'win32') {
            try {
              audioDevices = await listWindowsAudioDevices();
            } catch {
              audioDevices = null;
            }
          }
          this.#json(res, 200, {
            running: true,
            host: hostname,
            ips,
            port: config.port,
            uptime: Date.now() - this.startedAt,
            pending: this.pairing.list(),
            devices: this.devices.list().map((d) => ({ ...d, connected: !!d.connected })),
            audio: {
              mode: config.audioDryRun ? 'capture' : 'playback',
              output: config.audioDevice,
              active: this.audio.active,
              delivered: this.audio.bytesDelivered,
              dropped: this.audio.bytesDropped,
              devices: audioDevices,
            },
            mode: { input: config.inputDryRun ? 'dry' : 'live', audio: config.audioDryRun ? 'capture' : 'live' },
            inputEvents,
          });
        });
      }

      if (req.method === 'POST' && p === '/api/pair/request') {
        const body = await this.#readJson(req);
        if (!body || typeof body.deviceId !== 'string' || body.deviceId.length < 8) {
          return this.#json(res, 400, { error: 'deviceId invalido' });
        }
        const { pairingId, code } = this.pairing.request(body.deviceId, String(body.name || ''));
        this.log('info', `[http] solicitud de emparejamiento: ${body.name} (${body.deviceId})`);
        const { hostname } = this.getUrls();
        this.#json(res, 200, { pairingId, code, ttlMs: config.pairingCodeTtlMs, serverHost: hostname });
        return;
      }

      if (req.method === 'POST' && p === '/api/pair/approve') {
        const body = await this.#readJson(req);
        if (!this.pairing.approve(String(body?.pairingId || ''))) {
          return this.#json(res, 404, { error: 'pairing inexistente o expirado' });
        }
        return this.#json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/pair/reject') {
        const body = await this.#readJson(req);
        return this.#json(res, 200, { ok: this.pairing.reject(String(body?.pairingId || '')) });
      }

      if (req.method === 'POST' && p === '/api/pair/confirm') {
        const body = await this.#readJson(req);
        if (!body || typeof body.pairingId !== 'string' || typeof body.code !== 'string') {
          return this.#json(res, 400, { error: 'payload invalido' });
        }
        const result = this.pairing.confirm(body.pairingId, body.code);
        if (!result.ok) return this.#json(res, 403, { error: result.reason });
        const { token, device } = this.devices.issueToken(result.pairing.deviceId, result.pairing.name);
        this.log('info', `[http] dispositivo emparejado: ${device.name}`);
        return this.#json(res, 200, { token, deviceId: device.id });
      }

      if (req.method === 'POST' && p.startsWith('/api/devices/') && p.includes('/toggle')) {
        return this.#guardAdmin(req, res, async () => {
          const id = p.split('/')[3];
          const body = await this.#readJson(req);
          const ok = this.devices.setPerm(id, body?.perm, body?.enabled);
          if (!ok) return this.#json(res, 400, { error: 'permiso o dispositivo invalido' });
          this.#json(res, 200, { ok: true });
        });
      }

      if (req.method === 'POST' && p.startsWith('/api/devices/') && p.endsWith('/revoke')) {
        return this.#guardAdmin(req, res, async () => {
          const id = p.split('/')[3];
          const ok = this.devices.revoke(id);
          if (!ok) return this.#json(res, 400, { error: 'dispositivo inexistente' });
          this.log('info', `[http] dispositivo revocado: ${id}`);
          this.#json(res, 200, { ok: true });
        });
      }

      if (req.method === 'POST' && p === '/api/server/stop') {
        return this.#guardAdmin(req, res, async () => {
          this.#json(res, 200, { ok: true });
          setTimeout(() => process.exit(0), 300);
        });
      }

      return this.#json(res, 404, { error: 'not_found' });
    } catch (err) {
      this.log('error', `[http] ${err.message}`);
      if (!res.headersSent) this.#json(res, 500, { error: 'internal_error' });
    }
  }
}