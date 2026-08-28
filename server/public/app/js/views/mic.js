import { state, can, send, sendAudio } from '../core.js';
import { on, emit } from '../bus.js';

const RATE = 48000;
const CHANNELS = 1;

// Resampleador lineal simple: Float32 mono -> 48000 Hz.
function resample(input, inRate) {
  if (inRate === RATE || input.length < 2) return input;
  const ratio = inRate / RATE;
  const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function toInt16(float32) {
  const buf = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i] * 32767;
    s = Math.max(-32768, Math.min(32767, s));
    buf[i] = s | 0;
  }
  return new Uint8Array(buf.buffer);
}

export function initMic(root) {
  if (!root) return;
  root.innerHTML = `
    <div class="view-title">Micrófono inalámbrico</div>
    <div class="card">
      <button id="micToggle" class="btn primary">Usar celular como micrófono</button>
      <div class="mic-status" id="micStatus">Detenido</div>
      <div class="mic-meter"><div id="micMeter"></div></div>
      <div class="field" style="margin-top:12px">
        <label>Volumen en la PC: <span id="micVolLabel">100%</span></label>
        <input id="micVol" type="range" min="0" max="100" value="100" style="width:100%" />
      </div>
      <div class="btn-row">
        <button id="micMute" class="btn">Silenciar</button>
        <button id="micMonitor" class="btn">Monitorear</button>
      </div>
    </div>`;

  const toggle = root.querySelector('#micToggle');
  const statusEl = root.querySelector('#micStatus');
  const meterEl = root.querySelector('#micMeter');
  const volEl = root.querySelector('#micVol');
  const volLabel = root.querySelector('#micVolLabel');
  const muteEl = root.querySelector('#micMute');
  const monEl = root.querySelector('#micMonitor');

  let ctx = null;
  let stream = null;
  let processor = null;
  let monitorGain = null;
  let active = false;
  let muted = false;
  let monitoring = false;
  let awaitingReady = false;

  function setMeter(rms) {
    const pct = Math.min(100, Math.round(Math.sqrt(rms) * 240));
    meterEl.style.width = pct + '%';
  }

  on('wsMessage', (m) => {
    if (m.t === 'audio.ready') {
      awaitingReady = false;
      statusEl.textContent = 'Transmitiendo…';
    }
  });

  function setStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color || '';
  }

  async function start() {
    if (!can('audio')) {
      setStatus('Sin permisos de audio en la PC', '#ffb3b3');
      return;
    }
    if (active) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE });
      // Algunos navegadores ignoran sampleRate: consultamos el real.
      const actualRate = ctx.sampleRate || RATE;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: CHANNELS,
          sampleRate: RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      const source = ctx.createMediaStreamSource(stream);
      monitorGain = ctx.createGain();
      monitorGain.gain.value = monitoring ? 0.8 : 0;
      processor = ctx.createScriptProcessor(4096, CHANNELS, CHANNELS);

      source.connect(processor);
      processor.connect(monitorGain);
      monitorGain.connect(ctx.destination);

      active = true;
      muted = false;
      muteEl.textContent = 'Silenciar';
      muteEl.classList.remove('danger');
      send({ t: 'audio.start', rate: RATE, channels: CHANNELS, volume: volumeValue() });
      awaitingReady = true;
      setStatus('Solicitando transmisión…', '#f1c40f');

      processor.onaudioprocess = (e) => {
        if (!active) return;
        const input = e.inputBuffer.getChannelData(0);
        const resampled = resample(input, actualRate);
        const pcm = toInt16(resampled);
        setMeter(rmsOfFloat32(pcm));
        sendAudio(pcm);
      };

      toggle.textContent = 'Detener micrófono';
      toggle.classList.remove('primary');
    } catch (err) {
      setStatus('Error de micrófono: ' + err.message, '#ffb3b3');
      cleanupStream();
    }
  }

  function rmsOfFloat32(int16pcm) {
    let sum = 0;
    for (let i = 1; i < int16pcm.length; i += 2) {
      const s = (int16pcm[i] << 8) | int16pcm[i - 1];
      sum += s * s;
    }
    return Math.sqrt(sum / Math.max(1, int16pcm.length / 2)) / 32768;
  }

  function cleanupStream() {
    try {
      processor?.disconnect();
      monitorGain?.disconnect();
    } catch {}
    for (const track of stream?.getTracks() || []) track.stop();
    try {
      ctx?.close();
    } catch {}
    processor = null;
    stream = null;
    ctx = null;
    active = false;
  }

  function stop() {
    if (!active) return;
    cleanupStream();
    send({ t: 'audio.stop' });
    setMeter(0);
    setStatus('Detenido');
    toggle.textContent = 'Usar celular como micrófono';
    toggle.classList.add('primary');
  }

  function volumeValue() {
    return Number(volEl.value) / 100;
  }

  volEl.addEventListener('input', () => {
    volLabel.textContent = volEl.value + '%';
    if (active && !muted) send({ t: 'audio.volume', volume: volumeValue() });
  });

  muteEl.addEventListener('click', () => {
    if (!active) return;
    muted = !muted;
    send({ t: 'audio.volume', volume: muted ? 0 : volumeValue() });
    muteEl.textContent = muted ? 'Reanudar' : 'Silenciar';
    muteEl.classList.toggle('danger', muted);
  });

  monEl.addEventListener('click', () => {
    monitoring = !monitoring;
    if (monitorGain) monitorGain.gain.value = monitoring ? 0.8 : 0;
    monEl.classList.toggle('primary', monitoring);
    monEl.textContent = monitoring ? 'Monitoreando…' : 'Monitorear';
  });

  toggle.addEventListener('click', () => (active ? stop() : start()));
}