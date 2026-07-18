/* =============================================================
   poema-aleatorio.js — card "Poema do Momento" na home (index.html)
   Sorteia uma poesia ALEATÓRIA a cada visita (dados: poetry_pool.json,
   365 poemas curados das coletânias, com deep-link ?poem=<id> válido no
   leitor do Caminho). Botão 🔀 troca por outra sem recarregar.
   ============================================================= */
'use strict';

(function () {
  const sec = document.getElementById('poemaMomento');
  if (!sec) return;

  let poems = [];
  let ultimo = -1;

  function pick() {
    if (!poems.length) return null;
    if (poems.length === 1) return poems[0];
    let i;
    do { i = Math.floor(Math.random() * poems.length); } while (i === ultimo);
    ultimo = i;
    return poems[i];
  }

  function render(p) {
    if (!p) return;
    document.getElementById('pmJp').textContent = p.jp || '';
    const rj = document.getElementById('pmRj');
    rj.textContent = p.rj || '';
    rj.style.display = p.rj ? '' : 'none';
    document.getElementById('pmPt').textContent = p.pt || '';
    document.getElementById('pmCol').textContent = (p.t ? p.t + ' · ' : '') + (p.col || '');
    document.getElementById('pmLink').href = p.u + '?poem=' + encodeURIComponent(p.id);
  }

  async function init() {
    try {
      const res = await fetch('data/poetry/poetry_pool.json');
      poems = (await res.json()).poems || [];
    } catch (e) {
      return; // sem dados, o card simplesmente não aparece
    }
    if (!poems.length) return;
    render(pick());
    sec.hidden = false;
    const btn = document.getElementById('poemaMomentoShuffle');
    if (btn) btn.addEventListener('click', () => render(pick()));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
