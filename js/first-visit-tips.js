// ============================================================
// Dica de primeira visita — descobribilidade de recursos do leitor
// ============================================================
// Os recursos que mais ajudam leitores com visão reduzida (tamanho de
// letra, negrito, espaçamento) e os modos grifar/bilíngue ficam atrás
// de ícones no header — ninguém descobre sozinho. Este card aparece
// UMA vez (flag em localStorage), some ao tocar "Entendi" e nunca mais
// incomoda. Sem dependências; estilos inline seguindo o padrão do site.
// ============================================================
(function () {
  'use strict';

  const FLAG = 'cdf_tips_v1_seen';

  // Só no leitor normal (não no modo Discípulos, que tem outro layout)
  if (new URLSearchParams(location.search).get('pub') === 'disciples') return;

  try { if (localStorage.getItem(FLAG)) return; } catch (_) { return; }

  const lang = (function () {
    try { return localStorage.getItem('site_lang') === 'ja' ? 'ja' : 'pt'; } catch (_) { return 'pt'; }
  })();

  const T = {
    pt: {
      title: 'Você sabia?',
      tips: [
        'Em <strong>Aparência</strong> (menu) você pode aumentar a letra, ativar <strong>negrito</strong> e ajustar o espaçamento.',
        'O ícone de <strong>marcador</strong> no topo ativa o modo grifar: toque numa frase para destacá-la.',
        'Em Aparência também há o modo <strong>bilíngue 日本語／PT</strong>, com o original ao lado da tradução.'
      ],
      dismiss: 'Entendi'
    },
    ja: {
      title: 'ご存知でしたか？',
      tips: [
        '<strong>外観</strong>メニューで文字の大きさ・<strong>太字</strong>・行間を調整できます。',
        '上部の<strong>マーカー</strong>アイコンで、文に触れるだけでハイライトできます。',
        '外観メニューには<strong>日本語／PT対訳</strong>モードもあります。'
      ],
      dismiss: 'わかりました'
    }
  }[lang];

  function show() {
    // Só quando o ensinamento renderizou (logado, conteúdo na tela).
    // Sem flag: se hoje não mostrou, tenta de novo na próxima visita.
    if (!document.querySelector('.topic-content')) return;
    const card = document.createElement('div');
    card.id = 'firstVisitTips';
    card.setAttribute('role', 'status');
    card.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:6000;' +
      'max-width:380px;width:calc(100% - 32px);background:var(--surface);color:var(--text-main);' +
      'border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-premium);' +
      'padding:18px 20px;font-size:0.95rem;line-height:1.55;';
    card.innerHTML =
      '<div style="font-weight:600;color:var(--accent);margin-bottom:10px;">' + T.title + '</div>' +
      '<ul style="margin:0 0 14px;padding-left:18px;display:flex;flex-direction:column;gap:8px;">' +
        T.tips.map(function (t) { return '<li>' + t + '</li>'; }).join('') +
      '</ul>' +
      '<button type="button" id="firstVisitTipsOk" class="btn-zen" ' +
        'style="min-height:44px;padding:10px 22px;cursor:pointer;display:block;margin-left:auto;">' +
        T.dismiss + '</button>';
    document.body.appendChild(card);
    document.getElementById('firstVisitTipsOk').addEventListener('click', function () {
      try { localStorage.setItem(FLAG, '1'); } catch (_) {}
      card.remove();
    });
  }

  // Espera o conteúdo assentar pra não competir com o carregamento
  function schedule() { setTimeout(show, 3000); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
