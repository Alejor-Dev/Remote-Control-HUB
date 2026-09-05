import { WebSocketServer } from 'ws';
import {
  ALLOWED_INPUT_MESSAGES,
  AUDIO_FORMAT,
  MAX_AUDIO_CHUNK,
  MAX_TEXT_PAYLOAD,
} from '../../shared/protocol.js';

const MEDIA_KEYS = Object.freeze({
  'media.playpause': 'mediaplaypause',
  'media.next': 'mediasnext',
  'media.previous': 'mediaprev',
  'media.volume.up': 'mediavolup',
  'media.volume.down': 'mediavoldown',
  'media.mute': 'mediamute',
  'media.stop': 'mediastop',
});

function validateInputFrame(t, payload) {
  const schema = ALLOWED_INPUT_MESSAGES[t];
  if (!schema) return null;
  for (const [field, type] of Object.entries(schema)) {
    const v = payload[field];
    if (type === 'array') {
      if (!Array.isArray(v)) return null;
    } else if (typeof v !== type) {
      return null;
    }
  }
  return true;
}

// Guardia anti-abuso: token bucket por conexion.
function makeRateLimiter(maxPerSec = 200, burst = 400) {
  let tokens = burst;
  let last = Date.now();
  return function allow() {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * maxPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export class ControlServer {
  constructor({ httpServer, tlsServer = null, devices, pairing, input, audio, log = () => {} }) {
    this.httpServer = httpServer;
    this.tlsServer = tlsServer;
    this.devices = devices;
    this.pairing = pairing;
    this.input = input;
    this.audio = audio;
    this.log = log;
    this.sockets = new Map(); // ws -> { deviceId, allow }
    this.wssList = [];
  }

  #heartbeatLoop = null;

  start() {
    const servers = [this.httpServer, this.tlsServer].filter(Boolean);
    for (const server of servers) {
      const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_TEXT_PAYLOAD });
      wss.on('connection', (ws) => this.#onConnection(ws));
      this.wssList.push(wss);
    }
    this.#heartbeatLoop = setInterval(() => this.#checkHealth(), 15_000);
    this.#heartbeatLoop.unref?.();
  }

  #onConnection(ws) {
    const ctx = { deviceId: null, allow: makeRateLimiter() };
    this.sockets.set(ws, ctx);
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data, isBinary) => this.#onMessage(ws, ctx, data, isBinary));
    ws.on('close', () => this.#onClose(ws, ctx));
    ws.on('error', () => {});
  }

  #onMessage(ws, ctx, data, isBinary) {
    try {
      this.#handleMessage(ws, ctx, data, isBinary);
    } catch (err) {
      this.log('error', `[ws] error procesando mensaje: ${err.stack}`);
      this.#send(ws, { t: 'error', e: 'internal_error' });
    }
  }

  #handleMessage(ws, ctx, data, isBinary) {
    if (!ctx.allow()) {
      this.#send(ws, { t: 'error', e: 'rate_limit' });
      ws.close(1008, 'rate limit');
      return;
    }

    // Frames binarios = audio PCM de un dispositivo autorizado.
    if (isBinary) {
      if (!ctx.deviceId || !this.devices.get(ctx.deviceId)?.perms?.audio || data.length > MAX_AUDIO_CHUNK) {
        return;
      }
      this.audio.write(data);
      return;
    }

    if (Buffer.isBuffer(data) && data.length > MAX_TEXT_PAYLOAD) {
      ws.close(1009);
      return;
    }

    let frame;
    try {
      frame = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!frame || typeof frame.t !== 'string') return;

    // Autenticacion: solo 'hello' antes de validar token.
    if (!ctx.deviceId && frame.t !== 'hello') {
      this.#send(ws, { t: 'auth.required' });
      return;
    }

    switch (frame.t) {
      case 'hello':
        this.#handleHello(ws, ctx, frame);
        break;
      case 'heartbeat':
        if (ctx.deviceId) this.devices.markSeen(ctx.deviceId);
        this.#send(ws, { t: 'pong', at: Date.now() });
        break;
      case 'audio.start':
        void this.#handleAudioStart(ws, ctx, frame);
        break;
      case 'audio.stop':
        this.audio.stop();
        break;
      case 'audio.volume': {
        if (typeof frame.volume === 'number') this.audio.setVolume(frame.volume);
        break;
      }
      case 'media.playpause':
      case 'media.next':
      case 'media.previous':
      case 'media.volume.up':
      case 'media.volume.down':
      case 'media.mute':
      case 'media.stop':
        this.#dispatchMedia(ctx, frame.t);
        break;
      default:
        this.#dispatchInput(ctx, frame);
    }
  }

  #handleHello(ws, ctx, frame) {
    const device = this.devices.resolveToken(frame.token);
    if (!device) {
      this.#send(ws, { t: 'auth.denied', reason: 'token invalido o revocado' });
      ws.close(1008, 'unauthorized');
      return;
    }
    ctx.deviceId = device.id;
    device.connected = true;
    this.devices.markSeen(device.id);
    this.#send(ws, {
      t: 'welcome',
      deviceId: device.id,
      perms: { ...device.perms },
      audioFormat: { ...AUDIO_FORMAT },
    });
    this.log('info', `[ws] dispositivo autorizado conectado: ${device.name}`);
  }

  #dispatchInput(ctx, frame) {
    if (!ctx.deviceId) return;
    const device = this.devices.get(ctx.deviceId);
    if (!device) return;

    if (!validateInputFrame(frame.t, frame)) {
      this.#sendCtrlError(ctx, 'input', frame.t);
      return;
    }

    switch (frame.t) {
      case 'input.mouse.move':
        if (device.perms.mouse) this.input.mouseMove(frame.dx, frame.dy);
        break;
      case 'input.mouse.absolute':
        if (device.perms.mouse) this.input.mouseAbsolute(frame.x, frame.y);
        break;
      case 'input.mouse.down':
        if (device.perms.mouse) this.input.mouseDown(frame.button);
        break;
      case 'input.mouse.up':
        if (device.perms.mouse) this.input.mouseUp(frame.button);
        break;
      case 'input.mouse.click':
        if (device.perms.mouse) this.input.mouseClick(frame.button, frame.double);
        break;
      case 'input.mouse.scroll':
        if (device.perms.mouse) this.input.mouseScroll(frame.dy);
        break;
      case 'input.key.down':
        if (device.perms.keyboard) this.input.keyDown(frame.key);
        break;
      case 'input.key.up':
        if (device.perms.keyboard) this.input.keyUp(frame.key);
        break;
      case 'input.key.tap':
        if (device.perms.keyboard) this.input.keyTap(frame.key);
        break;
      case 'input.key.combo':
        if (device.perms.keyboard) this.input.combo(frame.keys);
        break;
      case 'input.text':
        if (device.perms.keyboard) this.input.typeText(frame.text);
        break;
    }
  }

  #dispatchMedia(ctx, t) {
    const device = this.devices.get(ctx.deviceId);
    if (!device || !device.perms.keyboard) return;
    const key = MEDIA_KEYS[t];
    if (key) this.input.keyTap(key);
  }

  async #handleAudioStart(ws, ctx, frame) {
    try {
      const device = this.devices.get(ctx.deviceId);
      if (!device || !device.perms?.audio) return;
      await this.audio.start({ rate: AUDIO_FORMAT.rate, channels: AUDIO_FORMAT.channels, volume: frame.volume ?? 1 });
      if (ws.readyState === ws.OPEN) {
        this.#send(ws, {
          t: 'audio.ready',
          rate: AUDIO_FORMAT.rate,
          channels: AUDIO_FORMAT.channels,
          sampleSize: 16,
        });
      }
    } catch (err) {
      this.log('error', `[ws] audio.start fallo: ${err.message}`);
      this.#send(ws, { t: 'error', e: 'audio_init_failed', message: err.message });
    }
  }

  #sendCtrlError(ctx, kind, t) {
    const ws = [...this.sockets.entries()].find(([, c]) => c === ctx)?.[0];
    if (ws) this.#send(ws, { t: 'error', e: 'invalid_frame', kind, type: t });
  }

  #send(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch {}
    }
  }

  #onClose(ws, ctx) {
    this.sockets.delete(ws);
    if (ctx.deviceId) {
      const d = this.devices.get(ctx.deviceId);
      if (d) d.connected = false;
      this.log('info', `[ws] dispositivo desconectado: ${ctx.deviceId}`);
    }
  }

  #checkHealth() {
    for (const wss of this.wssList) {
      for (const ws of wss.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        try {
          ws.ping();
        } catch {}
      }
    }
  }

  stop() {
    clearInterval(this.#heartbeatLoop);
    for (const wss of this.wssList) {
      for (const ws of wss.clients) {
        try {
          ws.close();
        } catch {}
      }
      wss.close();
    }
    this.wssList = [];
  }
}