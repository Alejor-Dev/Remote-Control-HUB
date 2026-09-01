import { state, can, send } from '../core.js';
import { get, set } from '../store.js';

function sensitivity() {
  return get('touchSensitivity', 2.0);
}
function invertScroll() {
  return get('invertScroll', false);
}

export function initTouchpad() {
  const pad = document.getElementById('touchpad');
  const btnDrag = document.getElementById('btnDrag');
  const btnInvert = document.getElementById('btnScrollInvert');
  if (!pad) return;

  const pointers = new Map();
  let dragMode = false;
  let lastTapAt = 0;
  let pending = { dx: 0, dy: 0 };
  let raf = null;
  let idle = true;

  function flush() {
    raf = null;
    if (idle || !can('mouse')) return;
    if (pending.dx !== 0 || pending.dy !== 0) {
      const dx = Math.round(pending.dx);
      const dy = Math.round(pending.dy);
      pending.dx -= dx;
      pending.dy -= dy;
      if (dx !== 0 || dy !== 0) send({ t: 'input.mouse.move', dx, dy });
    }
  }

  function queueDelta(dx, dy) {
    pending.dx += dx;
    pending.dy += dy;
    if (!raf) raf = requestAnimationFrame(flush);
  }

  function down(e) {
    pad.classList.add('active');
    idle = false;
    const p = { x: e.clientX, y: e.clientY, moved: 0, downAt: Date.now() };
    pointers.set(e.pointerId, p);
    if (pointers.size === 1 && can('mouse')) {
      if (dragMode) send({ t: 'input.mouse.down', button: 'left' });
    }
    e.preventDefault();
  }

  function move(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);

    if (!can('mouse')) return;

    if (pointers.size >= 2) {
      const dir = invertScroll() ? -1 : 1;
      const scrollStep = dy * dir * 0.5;
      if (Math.abs(scrollStep) >= 1) send({ t: 'input.mouse.scroll', dy: Math.round(scrollStep) });
      return;
    }
    const sens = sensitivity();
    queueDelta(dx * sens, dy * sens);
    e.preventDefault();
  }

  function up(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);

    if (can('mouse')) {
      if (dragMode) {
        send({ t: 'input.mouse.up', button: 'left' });
      } else if (pointers.size === 0 && p && p.moved < 12 && Date.now() - p.downAt < 700) {
        const now = Date.now();
        const double = now - lastTapAt < 350;
        lastTapAt = now;
        send({ t: 'input.mouse.click', button: 'left', double });
      }
    }
    if (pointers.size === 0) {
      pad.classList.remove('active');
      idle = true;
    }
    e.preventDefault();
  }

  pad.addEventListener('pointerdown', down);
  pad.addEventListener('pointermove', move);
  pad.addEventListener('pointerup', up);
  pad.addEventListener('pointerleave', () => {
    for (const id of [...pointers.keys()]) up({ pointerId: id, preventDefault() {}, clientX: 0, clientY: 0 });
  });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  btnDrag.addEventListener('click', () => {
    dragMode = !dragMode;
    btnDrag.textContent = dragMode ? 'Arrastrar (activo)' : 'Arrastrar';
    btnDrag.classList.toggle('primary', dragMode);
  });

  btnInvert.addEventListener('click', () => {
    const v = !invertScroll();
    set('invertScroll', v);
    btnInvert.textContent = v ? 'Scroll invertido' : 'Scroll';
    btnInvert.classList.toggle('primary', v);
  });

  function refresh() {
    btnInvert.textContent = invertScroll() ? 'Scroll invertido' : 'Scroll';
    btnInvert.classList.toggle('primary', invertScroll());
    if (dragMode) {
      btnDrag.textContent = 'Arrastrar (activo)';
      btnDrag.classList.add('primary');
    }
  }
  refresh();
}