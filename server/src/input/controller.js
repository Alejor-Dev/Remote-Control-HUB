import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyToVk, resolveCombo } from '../../../shared/keys.js';
import { MOUSE_BUTTONS } from '../../../shared/protocol.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mouseIdx(button) {
  const idx = MOUSE_BUTTONS[String(button).toLowerCase()];
  return idx === undefined ? 0 : idx;
}

// Controlador de input. En modo normal envia comandos a un helper PowerShell
// persistente que invoca user32 (SetCursorPos / mouse_event / keybd_event).
// En dry-run registra los eventos internamente y NO toca el sistema real:
// sirve para verificar el flujo sin mover el mouse ni escribir teclas.
export class InputController {
  constructor(log = () => {}) {
    this.log = log;
    this.dryRun = config.inputDryRun;
    this.child = null;
    this.running = false;
    this.dryLog = [];
    this.queue = [];
    this.writing = false;
  }

  start() {
    this.running = true;
    this.dryLog.length = 0;
    if (this.dryRun) return;
    this.#spawnHelper();
  }

  stop() {
    this.running = false;
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {}
      try {
        this.child.kill();
      } catch {}
      this.child = null;
    }
  }

  #spawnHelper() {
    const helper = path.join(__dirname, '..', '..', 'helpers', 'windows-input.ps1');
    this.log('info', `[input] lanzando helper '${helper}'`);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    child.stdout.on('data', (d) => this.log('debug', `[input>] ${d.toString().trim()}`));
    child.stderr.on('data', (d) => this.log('error', `[input!] ${d.toString().trim()}`));
    child.on('exit', (code) => {
      this.child = null;
      this.log('warn', `[input] helper terminado (code=${code})`);
      if (this.running) {
        this.log('info', '[input] reintentando helper en 1s');
        setTimeout(() => this.#spawnHelper(), 1000);
      }
    });
    this.child = child;
  }

  #send(cmd) {
    if (this.dryRun) {
      const entry = { ...cmd, at: Date.now() };
      this.dryLog.push(entry);
      if (this.dryLog.length > 500) this.dryLog.shift();
      this.log('info', `[input.dry] ${JSON.stringify(entry)}`);
      return;
    }
    if (!this.child) return;
    const line = JSON.stringify(cmd) + '\n';
    try {
      this.child.stdin.write(line);
    } catch (err) {
      this.log('error', `[input] fallo al escribir: ${err.message}`);
    }
  }

  // --- API usada por el router de mensajes ---

  mouseMove(dx, dy) {
    this.#send({ cmd: 'move', dx, dy });
  }

  mouseAbsolute(x, y) {
    this.#send({ cmd: 'abs', x, y });
  }

  mouseDown(button) {
    this.#send({ cmd: 'down', button: mouseIdx(button) });
  }

  mouseUp(button) {
    this.#send({ cmd: 'up', button: mouseIdx(button) });
  }

  mouseClick(button, double = false) {
    this.#send({ cmd: 'click', button: mouseIdx(button), double: !!double });
  }

  mouseScroll(dy) {
    const amount = Math.max(-1000, Math.min(1000, Math.round(dy)));
    if (amount !== 0) this.#send({ cmd: 'scroll', amount });
  }

  keyDown(name) {
    const vk = keyToVk(name);
    if (vk === null) return false;
    this.#send({ cmd: 'keydown', vk });
    return true;
  }

  keyUp(name) {
    const vk = keyToVk(name);
    if (vk === null) return false;
    this.#send({ cmd: 'keyup', vk });
    return true;
  }

  keyTap(name) {
    const vk = keyToVk(name);
    if (vk === null) return false;
    this.#send({ cmd: 'keytap', vk });
    return true;
  }

  combo(names) {
    const vks = [];
    for (const n of names) {
      const vk = keyToVk(n);
      if (vk === null) return false;
      vks.push(vk);
    }
    this.#send({ cmd: 'combo', keys: vks });
    return true;
  }

  comboPreset(presetName) {
    const combo = resolveCombo(presetName);
    if (combo === null) return false;
    return this.combo(combo);
  }

  typeText(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    if (text.length > 2000) text = text.slice(0, 2000);
    this.#send({ cmd: 'text', text });
    return true;
  }
}

export { mouseIdx };