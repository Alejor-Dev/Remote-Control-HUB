import { state, saveDeviceName, clearToken } from '../core.js';
import { get, set } from '../store.js';
import { emit } from '../bus.js';

export function initSettings(root) {
  if (!root) return;
  root.innerHTML = `
    <div class="view-title">Ajustes</div>
    <div class="card">
      <h3>Conexión</h3>
      <div class="field">
        <label>Nombre de este dispositivo</label>
        <input id="setName" class="input" value="" />
      </div>
      <button id="setSaveName" class="btn">Guardar nombre</button>
      <div style="height:10px"></div>
      <div class="centered-line" id="setServerInfo"></div>
    </div>
    <div class="card">
      <h3>Touchpad</h3>
      <div class="field">
        <label>Sensibilidad: <span id="sensLabel"></span></label>
        <input id="setSens" type="range" min="1" max="6" step="0.1" style="width:100%" />
      </div>
      <label><input id="setInvert" type="checkbox" /> Invertir scroll</label>
    </div>
    <div class="card">
      <h3>Privacidad</h3>
      <p class="centered-line" style="text-align:left;font-size:13px">
        Si eliminás el emparejamiento, esta app deberá volver a aprobarse desde la PC.
      </p>
      <button id="setUnpair" class="btn danger">Eliminar emparejamiento</button>
    </div>`;

  const nameEl = root.querySelector('#setName');
  nameEl.value = state.deviceName;
  root.querySelector('#setSaveName').addEventListener('click', () => {
    const v = nameEl.value.trim();
    if (v) {
      saveDeviceName(v);
      nameEl.value = v;
      emit('deviceNameChanged', v);
    }
  });

  const sensEl = root.querySelector('#setSens');
  const sensLabel = root.querySelector('#sensLabel');
  const syncSens = () => {
    sensEl.value = get('touchSensitivity', 2.0);
    sensLabel.textContent = sensEl.value;
  };
  syncSens();
  sensEl.addEventListener('input', () => {
    set('touchSensitivity', Number(sensEl.value));
    sensLabel.textContent = sensEl.value;
  });

  const invertEl = root.querySelector('#setInvert');
  invertEl.checked = get('invertScroll', false);
  invertEl.addEventListener('change', () => set('invertScroll', invertEl.checked));

  root.querySelector('#setUnpair').addEventListener('click', async () => {
    clearToken();
    emit('unpaired');
  });

  const infoEl = root.querySelector('#setServerInfo');
  infoEl.textContent = 'Servidor: ' + state.host + (state.connected ? ' · conectado' : ' · sin conexión');

  onRefresh(infoEl);
}

let refreshing = null;
function onRefresh(infoEl) {
  if (refreshing) return;
  refreshing = setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      const st = await res.json();
      infoEl.textContent =
        'Servidor: ' + st.host +
        ' · modo input: ' + st.mode.input +
        ' · audio: ' + st.mode.audio;
    } catch {}
  }, 4000);
}