import crypto from 'node:crypto';
import { config } from './config.js';
import JsonStore from './store.js';
import { randomToken, sha256Hex } from './crypto.js';

// Loopback: los tokens de sesion se guardan hasheados (sha256) para que una
// fuga del archivo de datos no exponga credenciales reutilizables.

export class DeviceManager {
  constructor() {
    this.store = new JsonStore('devices.json', { devices: [] });
    this.devices = this.store.state.devices;
    this.byId = new Map(this.devices.map((d) => [d.id, d]));
  }

  issueToken(deviceId, deviceName) {
    const token = randomToken();
    let device = this.byId.get(deviceId);
    if (!device) {
      device = {
        id: deviceId,
        name: deviceName,
        createdAt: Date.now(),
        perms: { mouse: true, keyboard: true, audio: true },
      };
      this.devices.push(device);
      this.byId.set(deviceId, device);
    }
    device.name = deviceName || device.name;
    device.tokenHash = sha256Hex(token);
    this.persist();
    return { token, device };
  }

  resolveToken(token) {
    if (typeof token !== 'string' || token.length < 16) return null;
    const hash = sha256Hex(token);
    return this.devices.find((d) => d.tokenHash === hash) || null;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  list() {
    return this.devices.map(({ id, name, createdAt, perms }) => ({
      id,
      name,
      createdAt,
      perms: { ...perms },
    }));
  }

  revoke(id) {
    const idx = this.devices.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.devices.splice(idx, 1);
    this.byId.delete(id);
    this.persist();
    return true;
  }

  // Antes de mutar registros de sesion caducados por dispositivo.
  markSeen(deviceId) {
    const d = this.byId.get(deviceId);
    if (!d) return;
    d.lastSeen = Date.now();
    this.persist();
  }

  setPerm(deviceId, perm, enabled) {
    const d = this.byId.get(deviceId);
    if (!d || !(perm in d.perms)) return false;
    d.perms[perm] = !!enabled;
    this.persist();
    return true;
  }

  // Poda sesiones sin token (revocadas) o viejas.
  cleanup() {
    const ttl = config.sessionTtlDays * 86400_000;
    const now = Date.now();
    const before = this.devices.length;
    this.devices = this.devices.filter(
      (d) => d.tokenHash && d.lastSeen && now - d.lastSeen <= ttl,
    );
    if (this.devices.length !== before) {
      this.byId = new Map(this.devices.map((d) => [d.id, d]));
      this.persist();
    }
  }

  persist() {
    this.store.save();
  }
}

// Gestor de emparejamientos pendientes. Un codigo de 6 digitos (mostrado en la
// UI de la PC) + aprobacion explicita del usuario de la PC habilitan la sesion.
export class PairingManager {
  constructor(devices) {
    this.devices = devices;
    this.pending = new Map(); // pairingId -> { code, deviceId, name, createdAt, approved }
  }

  request(deviceId, name) {
    if (this.pending.size >= config.maxDevices) {
      const oldest = [...this.pending.entries()].sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      )[0];
      this.pending.delete(oldest[0]);
    }
    const pairingId = randomToken(9);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.pending.set(pairingId, {
      code,
      deviceId,
      name: name || 'Dispositivo',
      createdAt: Date.now(),
      approved: false,
    });
    return { pairingId, code };
  }

  list() {
    const now = Date.now();
    const out = [];
    for (const [id, p] of this.pending) {
      if (now - p.createdAt > config.pairingCodeTtlMs) continue;
      // El codigo se incluye para que la UI de la PC lo muestre al usuario.
      // Proteger la zona de admin con RCH_ADMIN_TOKEN evita que se lea por red.
      out.push({ id, deviceId: p.deviceId, name: p.name, code: p.code, createdAt: p.createdAt });
    }
    return out;
  }

  approve(pairingId) {
    const p = this.pending.get(pairingId);
    if (!p || this.#expired(p)) return false;
    p.approved = true;
    return true;
  }

  reject(pairingId) {
    return this.pending.delete(pairingId);
  }

  confirm(pairingId, code) {
    const p = this.pending.get(pairingId);
    if (!p || this.#expired(p)) return { ok: false, reason: 'expirado o inexistente' };
    if (p.code !== String(code)) return { ok: false, reason: 'codigo incorrecto' };
    if (!p.approved) return { ok: false, reason: 'pendiente de aprobacion en la PC' };
    this.pending.delete(pairingId);
    return { ok: true, pairing: p };
  }

  #expired(p) {
    return Date.now() - p.createdAt > config.pairingCodeTtlMs;
  }
}