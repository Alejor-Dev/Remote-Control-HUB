import os from 'node:os';

// Devuelve las IPs locales de una familia concreta, excluyendo loopback.
export function getLocalIPv4s() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        out.push({ name, address: net.address });
      }
    }
  }
  return out;
}