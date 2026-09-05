import { state, saveHost, saveDeviceName, saveToken, clearToken, setTransport } from './core.js';
import { get, set } from './store.js';
import { Transport } from './ws.js';
import { pairRequest, pairConfirm } from './api.js';
import { emit, on } from './bus.js';
import { initTouchpad } from './views/touchpad.js';
import { initKeyboard } from './views/keyboard.js';
import { initMic } from './views/mic.js';
import { initMedia } from './views/media.js';
import { initSettings } from './views/settings.js';

const overlay = document.getElementById('overlay');
const statusDot = document.getElementById('statusDot');
const statusTitle = document.getElementById('statusTitle');
const statusSub = document.getElementById('statusSub');

let transport = null;
let heartbeat = null;

function setStatus(mode, title, sub) {
  statusDot.className = 'dot ' + mode; // on | working | (off)
  if (title !== undefined) statusTitle.textContent = title;
  if (sub !== undefined) statusSub.textContent = sub;
}

function showOverlay(html) {
  overlay.innerHTML = html;
  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ---------- Conexión ----------

function wsUrl() {
  const host = String(state.host).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

export function connect() {
  transport = new Transport({
    url: wsUrl(),
    token: state.token,
    onOpen: handleWelcome,
    onMessage: handleWsMessage,
    onClose: () => {
      state.connected = false;
      if (state.paired && !overlay.classList.contains('hidden')) {
        // silencioso: la reconexión la maneja el Transport
      } else if (state.paired) {
        setStatus('working', 'Remote Control Hub', 'Reconectando…');
      }
    },
  });
  setTransport(transport);
  transport.start();
  heartbeat = heartbeat || setInterval(() => {
    if (state.connected) transport?.send({ t: 'heartbeat' });
  }, 15000);
}

function handleWelcome(msg) {
  state.connected = true;
  state.perms = msg.perms || state.perms;
  state.audioFormat = msg.audioFormat || state.audioFormat;
  setStatus('on', 'Remote Control Hub', 'Conectado · ' + state.deviceName);
  if (!overlay.classList.contains('hidden')) hideOverlay();
}

function handleWsMessage(msg) {
  emit('wsMessage', msg);
  if (msg.t === 'auth.denied') {
    clearToken();
    transport?.stop();
    state.connected = false;
    renderConnect();
  } else if (msg.t === 'pong') {
    // vivo
  }
}

// ---------- Overlay de emparejamiento ----------

function renderConnect() {
  showOverlay(`
    <h1>Remote Control Hub</h1>
    <div class="centered-line">Tu teléfono se va a convertir en el control remoto de tu PC.</div>
    <div class="field">
      <label>Dirección del servidor</label>
      <input id="pairHost" class="input" value="${state.host}" />
    </div>
    <div class="field">
      <label>Nombre de este dispositivo</label>
      <input id="pairName" class="input" value="${state.deviceName}" />
    </div>
    <button id="pairStart" class="btn primary">Emparejar con mi PC</button>
    ${state.paired ? `<button id="pairReconnect" class="btn" style="margin-top:8px">Reconectar como ${state.deviceName}</button>` : ''}
    <div id="pairErr" class="err-banner" style="display:none"></div>
  `);

  document.getElementById('pairStart').addEventListener('click', async () => {
    saveHost(document.getElementById('pairHost').value.trim() || state.host);
    const name = document.getElementById('pairName').value.trim() || 'Mi celular';
    saveDeviceName(name);
    state.host = get('host', state.host);
    await startPairing();
  });
  const rec = document.getElementById('pairReconnect');
  if (rec) rec.addEventListener('click', () => {
    state.host = get('host', state.host);
    showOverlay(`<div class="centered-line"><span class="spin"></span>Conectando…</div>`);
    connect();
  });
}

async function startPairing() {
  const errEl = document.getElementById('pairErr');
  try {
    const { pairingId, code, ttlMs } = await pairRequest(state.deviceId, state.deviceName);
    showOverlay(`
      <h1>Emparejamiento</h1>
      <div class="code-big" id="pairCode">${code}</div>
      <div class="centered-line">Mostrá este código en la pantalla de tu PC y aprobá la conexión.</div>
      <div class="centered-line" style="font-size:12px">El código caduca en ${Math.round(ttlMs / 60000)} min.</div>
      <button id="pairConfirm" class="btn primary">Ya lo aprobé en la PC</button>
      <button id="pairCancel" class="btn" style="margin-top:8px">Cancelar</button>
      <div id="pairErr" class="err-banner" style="display:none"></div>
    `);
    document.getElementById('pairConfirm').addEventListener('click', async () => {
      const err = document.getElementById('pairErr');
      try {
        const res = await pairConfirm(pairingId, code);
        saveToken(res.token);
        state.host = get('host', state.host);
        showOverlay(`<div class="centered-line"><span class="spin"></span>Conectando…</div>`);
        connect();
      } catch (e) {
        err.style.display = 'block';
        err.textContent = e.message;
      }
    });
    document.getElementById('pairCancel').addEventListener('click', renderConnect);
  } catch (e) {
    errEl.style.display = 'block';
    errEl.textContent = 'No se pudo iniciar el emparejamiento: ' + e.message;
  }
}

// ---------- Navegación ----------

function switchView(name) {
  for (const sec of document.querySelectorAll('.content')) sec.classList.remove('active');
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  for (const btn of document.querySelectorAll('.nav button')) {
    btn.classList.toggle('active', btn.dataset.view === name);
  }
  if (name === 'keyboard') {
    const input = document.querySelector('#kbInput');
    setTimeout(() => input?.focus(), 60);
  }
}

function boot() {
  initTouchpad();
  initKeyboard(document.getElementById('view-keyboard'));
  initMic(document.getElementById('view-mic'));
  initMedia(document.getElementById('view-media'));
  initSettings(document.getElementById('view-settings'));

  for (const btn of document.querySelectorAll('.nav button')) {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  }
  document.getElementById('btnHome').addEventListener('click', renderConnect);

  on('unpaired', () => {
    transport?.stop();
    state.connected = false;
    setStatus('', 'Remote Control Hub', 'Sin conexión');
    renderConnect();
  });

  on('deviceNameChanged', (name) => {
    setStatus(state.connected ? 'on' : '', undefined, (state.connected ? 'Conectado · ' : '') + name);
  });

  setStatus('', 'Remote Control Hub', 'Conectando…');
  if (state.paired) {
    connect();
  } else {
    renderConnect();
  }
}

document.addEventListener('DOMContentLoaded', boot);