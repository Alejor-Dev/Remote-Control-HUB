import { can, send } from '../core.js';
import { resolveCombo } from '/shared/keys.js';

const MODS = Object.freeze({ Ctrl: 'ctrl', Alt: 'alt', Shift: 'shift', Win: 'lwin' });

function vkFor(e) {
  const map = {
    Enter: 'enter', Backspace: 'backspace', Delete: 'delete', Tab: 'tab',
    Escape: 'escape', ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right',
    ArrowDown: 'down', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  };
  return map[e.key] || null;
}

export function initKeyboard(root) {
  if (!root) return;
  root.innerHTML = `
    <div class="view-title">Teclado</div>
    <div class="card">
      <input id="kbInput" class="input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Tocá y escribí… el texto se envía a la PC" />
      <div class="kb-keys" id="kbMods">
        <button data-mod="Ctrl" class="mod">Ctrl</button>
        <button data-mod="Alt" class="mod">Alt</button>
        <button data-mod="Shift" class="mod">Shift</button>
        <button data-mod="Win" class="mod">Win</button>
        <button data-key="enter" class="wide">Enter</button>
        <button data-key="tab">Tab</button>
        <button data-key="backspace">⌫</button>
        <button data-key="delete">⌦</button>
        <button data-key="escape">Esc</button>
        <button data-key="left">←</button>
        <button data-key="right">→</button>
        <button data-key="up">↑</button>
        <button data-key="down">↓</button>
      </div>
      <div class="kb-shortcuts" id="kbShortcuts"></div>
    </div>`;

  const input = root.querySelector('#kbInput');
  const heldMods = new Set();
  let lastValue = '';

  const shortcuts = [
    ['copy', 'Ctrl+C'], ['paste', 'Ctrl+V'], ['cut', 'Ctrl+X'], ['selectall', 'Ctrl+A'],
    ['undo', 'Ctrl+Z'], ['redo', 'Ctrl+Y'], ['save', 'Ctrl+S'], ['switchapp', 'Alt+Tab'],
    ['taskmanager', 'Ctrl+Shift+Esc'], ['lock', 'Win+L'], ['browser', 'Win+E'], ['close', 'Alt+F4'],
  ];
  const sc = root.querySelector('#kbShortcuts');
  for (const [preset, label] of shortcuts) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      if (!can('keyboard')) return;
      const combo = resolveCombo(preset);
      if (combo) send({ t: 'input.key.combo', keys: combo });
    });
    sc.appendChild(b);
  }

  for (const btn of root.querySelectorAll('#kbMods [data-mod]')) {
    btn.addEventListener('click', () => {
      const mod = MODS[btn.dataset.mod];
      if (heldMods.has(mod)) {
        heldMods.delete(mod);
        btn.style.background = '';
      } else {
        heldMods.add(mod);
        btn.style.background = '#1990ff';
      }
    });
  }

  for (const btn of root.querySelectorAll('#kbMods [data-key]')) {
    btn.addEventListener('click', () => {
      if (!can('keyboard')) return;
      send({ t: 'input.key.tap', key: btn.dataset.key });
    });
  }

  function refocus() {
    if (document.activeElement !== input) {
      try {
        input.focus();
      } catch {}
    }
  }

  function sendTextDelta(value) {
    if (!can('keyboard')) return;
    let i = 0;
    while (i < lastValue.length && i < value.length && lastValue[i] === value[i]) i++;
    const added = value.slice(i);
    if (added.length >= 0) {
      const chars = lastValue.length - value.length > 0 ? value.slice(i) : added;
      for (const ch of chars) send({ t: 'input.text', text: ch });
    }
    lastValue = value;
  }

  input.addEventListener('keydown', (e) => {
    refocus();
    if (!can('keyboard')) return;

    const vk = vkFor(e);
    const mem = [...heldMods];
    const pressedMod = MODS[e.key];
    if (pressedMod) return; // los mods se gestionan con botones

    if (vk) {
      if (mem.length) {
        send({ t: 'input.key.combo', keys: [...mem, vk] });
      } else {
        send({ t: 'input.key.tap', key: vk });
      }
      e.preventDefault();
      return;
    }

    if (mem.length && e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key)) {
      const key = e.key.toLowerCase();
      send({ t: 'input.key.combo', keys: [...mem, key] });
      e.preventDefault();
      return;
    }

    // Combinaciones con Ctrl/Alt/Shift reales del teclado del celular
    const real = [];
    if (e.ctrlKey) real.push('ctrl');
    if (e.altKey) real.push('alt');
    if (e.shiftKey) real.push('shift');
    if (e.metaKey) real.push('lwin');
    if (real.length && e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
      send({ t: 'input.key.combo', keys: [...real, e.key.toLowerCase()] });
      e.preventDefault();
    }
  });

  input.addEventListener('input', () => {
    refocus();
    sendTextDelta(input.value);
  });

  input.addEventListener('blur', () => setTimeout(refocus, 120));
  root.addEventListener('pointerup', refocus);
}