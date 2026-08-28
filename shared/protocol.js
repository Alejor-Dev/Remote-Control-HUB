// Remote Control Hub — Protocolo de mensajes control (canal de texto del WebSocket).
// El canal de audio usa frames binarios del mismo WebSocket: {t:'audio-start', ...} (texto)
// seguido de chunks PCM binarios, y {t:'audio-stop'}.

export const PROTOCOL_VERSION = 1;

// Comandos de control permitidos -> mapa de validadores.
// Nunca se ejecuta un comando arbitrario recibido de la red: solo este allowlist.
export const ALLOWED_COMMANDS = Object.freeze({
  'hello': true,
  'pair.request': true,
  'pair.approve': true,
  'pair.reject': true,
  'audio.start': true,
  'audio.stop': true,
  'heartbeat': true,
  'media.playpause': true,
  'media.next': true,
  'media.previous': true,
  'media.volume.up': true,
  'media.volume.down': true,
  'media.mute': true,
  'media.stop': true,
});

export const ALLOWED_INPUT_MESSAGES = Object.freeze({
  'input.mouse.move': { dx: 'number', dy: 'number' },
  'input.mouse.absolute': { x: 'number', y: 'number' },
  'input.mouse.down': { button: 'string' },
  'input.mouse.up': { button: 'string' },
  'input.mouse.click': { button: 'string', double: 'boolean' },
  'input.mouse.scroll': { dy: 'number' },
  'input.mouse.drag': { dx: 'number', dy: 'number' },
  'input.key.down': { key: 'string' },
  'input.key.up': { key: 'string' },
  'input.key.tap': { key: 'string' },
  'input.key.combo': { keys: 'array' },
  'input.text': { text: 'string' },
});

export const MOUSE_BUTTONS = Object.freeze({ left: 0, right: 2, middle: 1 });

// Duracion maxima permitida de un payload de texto, en bytes.
export const MAX_TEXT_PAYLOAD = 64 * 1024;

// Tamano maximo de un chunk de audio, en bytes.
export const MAX_AUDIO_CHUNK = 64 * 1024;

// Canal maestro de audio PCM esperado del cliente.
export const AUDIO_FORMAT = Object.freeze({ rate: 48000, channels: 1, sampleSize: 16 });

export function throwOnBadFrame(frame) {
  if (!frame || typeof frame !== 'object') throw new Error('frame invalido');
  if (typeof frame.t !== 'string' || frame.t.length === 0 || frame.t.length > 64) {
    throw new Error('tipo de mensaje invalido');
  }
}