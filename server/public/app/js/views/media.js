import { can, send } from '../core.js';

export function initMedia(root) {
  if (!root) return;
  root.innerHTML = `
    <div class="view-title">Multimedia</div>
    <div class="card">
      <div class="btn-row">
        <button class="btn" data-cmd="media.previous">⏮ Anterior</button>
        <button class="btn primary" data-cmd="media.playpause">⏯ Play/Pausa</button>
        <button class="btn" data-cmd="media.next">Siguiente ⏭</button>
      </div>
      <div style="height:10px"></div>
      <div class="btn-row">
        <button class="btn" data-cmd="media.volume.down">🔉 Vol−</button>
        <button class="btn primary" data-cmd="media.mute">🔇 Silenciar</button>
        <button class="btn" data-cmd="media.volume.up">🔊 Vol+</button>
      </div>
      <div style="height:10px"></div>
      <button class="btn danger" data-cmd="media.stop">⏹ Detener</button>
      <p class="mic-status" style="margin-top:12px">Los botones multimedia se envían como teclas de medios al sistema.</p>
    </div>`;

  for (const btn of root.querySelectorAll('[data-cmd]')) {
    btn.addEventListener('click', () => {
      if (!can('keyboard')) return;
      send({ t: btn.dataset.cmd });
    });
  }
}