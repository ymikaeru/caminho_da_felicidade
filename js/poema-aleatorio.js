/* =============================================================
   poema-aleatorio.js — card "Poema do Momento"
   Sorteia uma poesia ALEATÓRIA a cada visita, com deep-link ?poem=<id>
   válido no leitor de cada coletânea. Botão 🔀 troca por outra sem
   recarregar.

   Serve as DUAS homes, mudando só o pool (data-pool na <section>):
     index.html → poetry_pool.json      (só o Akemaro Kin'eishū)
     poesia.html → poetry_pool_all.json (as seis coletâneas da seção)

   BILÍNGUE: no modo japonês some tudo que é apoio pra quem não lê
   japonês — romaji, tradução e título em português —, e o nome da
   coletânea aparece em japonês. O pool só traz o nome romanizado.

   Tudo que depende de idioma é resolvido pelo mecanismo do site (spans
   .lang-pt/.lang-ja + html[lang] no CSS), NÃO aqui: o botão de idioma não
   re-renderiza este card, então qualquer escolha feita no render() ficaria
   presa até o 🔀 seguinte. O render() só respeita o idioma ao definir
   display, pra um 🔀 no modo japonês não trazer o português de volta.
   ============================================================= */
'use strict';

(function () {
  const sec = document.getElementById('poemaMomento');
  if (!sec) return;

  // Mesmos nomes que o salvos.html usa em POEM_COLLECTIONS. Chave = slug da
  // página (p.u sem .html). Nova coletânea de poesia = acrescentar aqui.
  const COL_JA = {
    'akimaro-kineishu': '明麿近詠集',
    'yama-to-mizu': '山と水',
    'warai-no-izumi': '笑の泉',
    'gosanka-shoban': '御讃歌集（初版）',
    'gosanka-kaitei': '御讃歌集（改訂版）',
    'gosanka-shikiten': '各式典における御讃歌'
  };

  let poems = [];
  let ultimo = -1;

  const lang = () => {
    try { return localStorage.getItem('site_lang') === 'ja' ? 'ja' : 'pt'; }
    catch (_) { return 'pt'; }
  };

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
    const ja = lang() === 'ja';

    document.getElementById('pmJp').textContent = p.jp || '';

    const rj = document.getElementById('pmRj');
    rj.textContent = p.rj || '';
    rj.style.display = (ja || !p.rj) ? 'none' : '';

    const pt = document.getElementById('pmPt');
    pt.textContent = p.pt || '';
    pt.style.display = ja ? 'none' : '';

    // Título é só do português (o pool não traz o japonês); a coletânea tem
    // nome nos dois idiomas.
    const t = document.getElementById('pmTitle');
    t.textContent = p.t ? p.t + ' · ' : '';
    t.style.display = ja ? 'none' : '';

    // Os DOIS nomes são escritos sempre; quem escolhe qual mostrar é o
    // setLanguage, pelos .lang-pt/.lang-ja. Antes eu decidia aqui, e o nome
    // só trocava no 🔀 seguinte — o botão de idioma não re-renderiza o card.
    const slug = String(p.u || '').replace(/\.html$/, '');
    document.getElementById('pmColPt').textContent = p.col || '';
    document.getElementById('pmColJa').textContent = COL_JA[slug] || p.col || '';

    document.getElementById('pmLink').href = p.u + '?poem=' + encodeURIComponent(p.id);
  }

  async function init() {
    try {
      const res = await fetch(sec.dataset.pool || 'data/poetry/poetry_pool.json?v=2');
      poems = (await res.json()).poems || [];
    } catch (e) {
      return; // sem dados, o card simplesmente não aparece
    }
    if (!poems.length) return;
    const atual = pick();
    render(atual);
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
