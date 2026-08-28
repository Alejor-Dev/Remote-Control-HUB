import { get, set, uid } from './store.js';

const state = {
  host: get('host', location.origin),
  deviceName: get('deviceName', 'Mi celular'),
  deviceId: get('deviceId', null),
  token: get('token', null),
  paired: !!get('token', null),
  perms: { mouse: false, keyboard: false, audio: false },
  audioFormat: { rate: 48000, channels: 1 },
  connected: false,
};

if (!state.deviceId) {
  state.deviceId = uid();
  set('deviceId', state.deviceId);
}

export function saveHost(h) {
  state.host = h;
  set('host', h);
}

export function saveDeviceName(name) {
  state.deviceName = name;
  set('deviceName', name);
}

export function saveToken(token) {
  state.token = token;
  state.paired = true;
  set('token', token);
}

export function clearToken() {
  state.token = null;
  state.paired = false;
  set('token', null);
}

export { state };

let transport = null;

export function setTransport(t) {
  transport = t;
}

export function send(obj) {
  if (!transport || !state.connected) return false;
  transport.send(obj);
  return true;
}

export function sendAudio(buffer) {
  if (!transport || !state.connected) return;
  transport.sendAudio(buffer);
}

export function can(perm) {
  return state.connected && state.perms[perm] === true;
}