// Test de integración de Remote Control Hub.
// Levanta el servidor real en modo PRUEBA (input dry-run + audio capture) y
// ejercita: emparejamiento, WebSocket, permisos, eventos de input, audio y
// revocación. No mueve el mouse ni reproduce sonido en la maquina.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.log(`  ✘ ${label}`);
  }
}

function assertEq(a, b, label) {
  ok(a === b, `${label} (${JSON.stringify(a)} == ${JSON.stringify(b)})`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages = [];
    const waiting = [];
    ws.on('error', reject);
    ws.on('message', (d, isBinary) => {
      const m = isBinary ? { binary: true, data: d } : JSON.parse(d.toString());
      messages.push(m);
      const still = [];
      for (const w of waiting) {
        if (!w(m)) still.push(w);
      }
      waiting.length = 0;
      waiting.push(...still);
    });
    ws.on('open', () =>
      resolve({
        ws,
        messages,
        next(pred, timeoutMs = 5000) {
          return new Promise((res, rej) => {
            const check = (m) => {
              if (pred(m)) {
                const idx = messages.indexOf(m);
                if (idx !== -1) messages.splice(idx, 1);
                res(m);
                return true;
              }
              return false;
            };
            for (let i = 0; i < messages.length; i++) {
              if (check(messages[i])) return;
            }
            waiting.push(check);
            setTimeout(() => {
              const i = waiting.indexOf(check);
              if (i !== -1) waiting.splice(i, 1);
              rej(new Error('timeout esperando mensaje'));
            }, timeoutMs);
          });
        },
      }),
    );
  });
}

async function waitFor(read) {
  for (let i = 0; i < 60; i++) {
    try {
      const st = await read();
      if (st) return st;
    } catch {}
    await sleep(500);
  }
  throw new Error('servidor no respondio a tiempo');
}

function pcmChunk(freq = 440, frames = 4096, rate = 48000) {
  const buf = Buffer.allocUnsafe(frames * 2);
  for (let i = 0; i < frames; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * 12000;
    buf.writeInt16LE(Math.round(v), i * 2);
  }
  return buf;
}

function wavHeader(dataLength, rate = 48000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLength, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLength, 40);
  return h;
}

async function main() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rch-test-'));
  const base = `http://127.0.0.1:${port}`;

  console.log(`[setup] puerto=${port} data=${dataDir}`);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      RCH_PORT: String(port),
      RCH_HOST: '127.0.0.1',
      RCH_DATA_DIR: dataDir,
      RCH_INPUT_DRY_RUN: 'true',
      RCH_AUDIO_DRY_RUN: 'true',
      RCH_OPEN_BROWSER: 'false',
      RCH_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => (serverLog += d));
  child.stderr.on('data', (d) => (serverLog += d));

  const api = async (p, method = 'GET', body = null) => {
    const res = await fetch(base + p, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  };

  try {
    console.log('[FASE 1] conexión y emparejamiento');
    await waitFor(() => api('/api/status'));

    const st0 = (await api('/api/status')).data;
    ok(st0.running === true, 'servidor responde /api/status');
    assertEq(st0.mode.input, 'dry', 'modo input en PRUEBA');
    assertEq(st0.mode.audio, 'capture', 'modo audio en CAPTURA');

    const qr = await api('/api/qr');
    ok(typeof qr.data.dataUrl === 'string' && qr.data.dataUrl.startsWith('data:image/png'), 'QR genérico disponible');
    ok(qr.data.url.includes('/app'), 'URL del QR apunta al cliente móvil');

    const home = await fetch(base + '/');
    const homeText = await home.text();
    ok(home.status === 200 && homeText.includes('Remote Control Hub'), 'UI de administración servida');

    const appHtml = await (await fetch(base + '/app/')).text();
    ok(appHtml.includes('Touchpad') && appHtml.includes('Micrófono'), 'cliente PWA servida');

    const sharedJs = await fetch(base + '/shared/keys.js');
    ok(sharedJs.status === 200, 'módulos compartidos servidos');

    const devId = 'test-device-0001';
    const pair = await api('/api/pair/request', 'POST', { deviceId: devId, name: 'Test Phone' });
    ok(pair.status === 200 && pair.data.pairingId && /^\d{6}$/.test(pair.data.code), 'request de emparejamiento devuelve código');

    const st1 = (await api('/api/status')).data;
    ok(st1.pending.some((p) => p.deviceId === devId), 'PC ve la solicitud pendiente');
    assertEq(st1.pending.find((p) => p.deviceId === devId).code, pair.data.code, 'código mostrado en la PC coincide');

    ok((await api('/api/pair/approve', 'POST', { pairingId: pair.data.pairingId })).status === 200, 'aprobado desde la PC');

    const wrong = await api('/api/pair/confirm', 'POST', { pairingId: pair.data.pairingId, code: '999999' });
    assertEq(wrong.status, 403, 'código incorrecto rechazado');

    const good = await api('/api/pair/confirm', 'POST', { pairingId: pair.data.pairingId, code: pair.data.code });
    ok(good.status === 200 && typeof good.data.token === 'string', 'confirmación exitosa entrega token');

    const st2 = (await api('/api/status')).data;
    ok(st2.devices.some((d) => d.id === devId), 'dispositivo registrado');

    console.log('[FASE 1] WebSocket');
    const c = await openWs(`ws://127.0.0.1:${port}/ws`);
    c.ws.send(JSON.stringify({ t: 'hello', token: good.data.token }));
    const welcome = await c.next((m) => m.t === 'welcome');
    ok(!!welcome && welcome.deviceId === devId, 'handshake autentica y da welcome');
    ok(welcome.perms.mouse === true && welcome.perms.keyboard === true && welcome.perms.audio === true, 'permisos por defecto activados');

    c.ws.send(JSON.stringify({ t: 'heartbeat' }));
    const pong = await c.next((m) => m.t === 'pong');
    ok(!!pong, 'heartbeat responde pong');

    console.log('[FASES 2-3] input (dry-run)');
    c.ws.send(JSON.stringify({ t: 'input.mouse.move', dx: 50, dy: -30 }));
    c.ws.send(JSON.stringify({ t: 'input.mouse.click', button: 'left', double: false }));
    c.ws.send(JSON.stringify({ t: 'input.mouse.scroll', dy: -120 }));
    c.ws.send(JSON.stringify({ t: 'input.key.combo', keys: ['ctrl', 'c'] }));
    c.ws.send(JSON.stringify({ t: 'input.text', text: 'hola' }));
    c.ws.send(JSON.stringify({ t: 'media.playpause' }));
    await sleep(400);

    let ev = (await api('/api/status')).data.inputEvents;
    ok(ev.some((e) => e.cmd === 'move' && e.dx === 50 && e.dy === -30), 'mouse.move registrado (dry)');
    ok(ev.some((e) => e.cmd === 'click' && e.button === 0 && !e.double), 'mouse.click izquierdo registrado');
    ok(ev.some((e) => e.cmd === 'scroll' && e.amount === -120), 'scroll registrado');
    ok(ev.some((e) => e.cmd === 'combo' && e.keys.length === 2), 'combo (ctrl+c) registrado');
    ok(ev.some((e) => e.cmd === 'text' && e.text === 'hola'), 'texto UTF-8 registrado');
    ok(ev.some((e) => e.cmd === 'keytap' && e.vk === 0xb3), 'tecla multimedia play/pause registrada');

    const invalid = await api('/api/status');
    // permisos: desactivar mouse y comprobar que NO se emite evento nuevo
    await api(`/api/devices/${devId}/toggle`, 'POST', { perm: 'mouse', enabled: false });
    const before = (await api('/api/status')).data.inputEvents.length;
    c.ws.send(JSON.stringify({ t: 'input.mouse.move', dx: 10, dy: 10 }));
    await sleep(400);
    const after = (await api('/api/status')).data.inputEvents.length;
    assertEq(after, before, 'movimiento de mouse BLOQUEADO al desactivar permiso');
    await api(`/api/devices/${devId}/toggle`, 'POST', { perm: 'mouse', enabled: true });

    console.log('[FASE 4] audio (captura)');
    c.ws.send(JSON.stringify({ t: 'audio.start', rate: 48000, channels: 1, volume: 1 }));
    const ready = await c.next((m) => m.t === 'audio.ready');
    ok(!!ready && ready.rate === 48000, 'audio.ready confirmado');

    const chunk1 = pcmChunk(440, 4096);
    const chunk2 = pcmChunk(880, 4096);
    c.ws.send(chunk1);
    c.ws.send(chunk2);
    await sleep(300);

    c.ws.send(JSON.stringify({ t: 'audio.stop' }));

    // En modo captura el helper finaliza el archivo al cerrar el stream;
    // PowerShell tarda ~1s en arrancar, así que sondeamos hasta poder leerlo.
    const capturePath = path.join(dataDir, 'capture.raw');
    let captureBytes = null;
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      if (!fs.existsSync(capturePath)) continue;
      try {
        captureBytes = fs.statSync(capturePath).size;
        fs.readFileSync(capturePath);
        break;
      } catch {
        continue; // aun bloqueado por el helper, reintentamos
      }
    }
    ok(captureBytes !== null && captureBytes >= chunk1.length + chunk2.length, `audio capturado en capture.raw (${captureBytes} bytes)`);

    const wavPath = path.join(dataDir, 'capture.wav');
    fs.writeFileSync(wavPath, Buffer.concat([wavHeader(captureBytes), fs.readFileSync(capturePath)]));
    const wavCheck = fs.readFileSync(wavPath);
    ok(wavCheck.toString('ascii', 0, 4) === 'RIFF' && wavCheck.toString('ascii', 8, 12) === 'WAVE', 'captura envuelta como WAV válido');
    ok(wavCheck.readUInt32LE(24) === 48000, 'WAV a 48 kHz');

    console.log('[FASE 5] seguridad');
    const c2 = await openWs(`ws://127.0.0.1:${port}/ws`);
    c2.ws.send(JSON.stringify({ t: 'hello', token: 'token-invalido' }));
    const denied = await c2.next((m) => m.t === 'auth.denied');
    ok(!!denied, 'token inválido rechazado');

    const revoke = await api(`/api/devices/${devId}/revoke`, 'POST', {});
    assertEq(revoke.status, 200, 'dispositivo revocado');

    const c3 = await openWs(`ws://127.0.0.1:${port}/ws`);
    c3.ws.send(JSON.stringify({ t: 'hello', token: good.data.token }));
    const denied3 = await c3.next((m) => m.t === 'auth.denied');
    ok(!!denied3, 'token revocado ya no autentica');

    const stLast = (await api('/api/status')).data;
    ok(!stLast.devices.some((d) => d.id === devId), 'dispositivo fuera del registro');

    console.log(`\nRESULTADO: ${passed} ok, ${failed} fail`);
  } catch (err) {
    console.error('ERROR:');
    console.error(err.stack || err);
    console.error('\n--- log del servidor ---');
    console.error(serverLog);
    failed++;
  } finally {
    child.kill();
    await sleep(500);
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  }

  if (failed) process.exit(1);
}

main();