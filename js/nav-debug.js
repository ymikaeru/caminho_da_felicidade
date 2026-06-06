// ============================================================
// nav-debug.js — Instrumentação de navegação (gated por ?navdebug=1)
// ============================================================
// Diagnostica por que, no iPad/iOS 17, o 2º clique num resultado de busca não
// carrega o conteúdo (precisa reload). Persiste o log em sessionStorage pra
// SOBREVIVER a navegações e a restaurações de bfcache — sem isso, cada page
// load começaria com overlay vazio e perderíamos a história entre os cliques.
//
// Arbitra 3 buckets:
//   A — navegação não aconteceu: vê 'click a -> ...' mas NÃO vê 'pagehide' nem
//       novo 'DOMContentLoaded'/'initReader' → link foi interceptado/same-doc.
//   B — bfcache: vê 'pageshow persisted=...' SEM 'DOMContentLoaded'/'initReader'
//       pra aquela URL → página restaurada do cache, init nunca re-rodou.
//       (event.persisted é NÃO-confiável no iOS — cruzar com "initReader logou?".)
//   C — carregou mas conteúdo falha: vê 'DOMContentLoaded' + 'initReader' mas
//       depois 'ERROR'/'REJECT'/'initReader CATCH' ou nenhum 'renderReader DONE'.
//
// Inerte sem ?navdebug=1. Uma vez ativado, persiste na sessão (não precisa do
// param em toda URL). ?navdebug=0 desliga e limpa. Carregar PRIMEIRO entre os
// scripts defer pra window._navlog existir antes de reader.js/search.js.
// REMOVER quando o bug fechar.
(function () {
  try {
    const sp = new URLSearchParams(location.search);
    if (sp.get('navdebug') === '1') sessionStorage.setItem('navdebug', '1');
    if (sp.get('navdebug') === '0') { sessionStorage.removeItem('navdebug'); sessionStorage.removeItem('navdebug_lines'); }
  } catch (_) { /* sessionStorage indisponível */ }

  let ON = false;
  try { ON = sessionStorage.getItem('navdebug') === '1'; } catch (_) {}
  if (!ON) { window._navlog = function () {}; return; }

  const KEY = 'navdebug_lines';
  const readLines = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const writeLines = (a) => { try { sessionStorage.setItem(KEY, JSON.stringify(a.slice(-90))); } catch (_) {} };

  let _el = null, _body = null;
  function ensureOverlay() {
    if (!document.body) return;
    if (_el && document.body.contains(_el)) return;
    _el = document.createElement('div');
    _el.id = 'navDebugOverlay';
    _el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:48vh;overflow:auto;background:rgba(0,0,0,.9);color:#7FE3FF;font:11px/1.3 monospace;padding:0 8px 8px;white-space:pre-wrap;border-top:2px solid #7FE3FF;-webkit-overflow-scrolling:touch;';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;display:flex;gap:8px;background:#000;padding:4px 0;';
    const mk = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'font:11px monospace;color:#000;background:#7FE3FF;border:0;padding:3px 10px;border-radius:3px;'; b.addEventListener('click', fn); return b; };
    bar.appendChild(mk('limpar', () => { writeLines([]); repaint(); }));
    bar.appendChild(mk('desligar', () => { try { sessionStorage.removeItem('navdebug'); sessionStorage.removeItem(KEY); } catch (_) {} if (_el) _el.remove(); _el = null; window._navlog = function () {}; }));
    _body = document.createElement('div');
    _el.appendChild(bar);
    _el.appendChild(_body);
    document.body.appendChild(_el);
    repaint();
  }
  function repaint() {
    if (!_body) return;
    _body.textContent = readLines().slice().reverse().join('\n');
  }
  function stamp() {
    const t = new Date();
    return t.toLocaleTimeString('pt-BR', { hour12: false }) + '.' + String(t.getMilliseconds()).padStart(3, '0');
  }

  window._navlog = function (msg) {
    const a = readLines();
    a.push(`${stamp()} ${msg}  {${location.search || '?'}}`);
    writeLines(a);
    if (document.body) { ensureOverlay(); repaint(); }
  };

  // Bucket C: erros e rejeições NÃO tratados (o catch do initReader é tratado e
  // logado à parte via _navlog direto no reader.js).
  window.addEventListener('error', (e) => window._navlog('ERROR: ' + (e.message || (e.error && e.error.message) || e.error) + ' @' + ((e.filename || '').split('/').pop()) + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => window._navlog('REJECT: ' + ((e.reason && e.reason.message) || e.reason)));

  // Ciclo de vida — distingue os buckets A/B/C.
  window.addEventListener('pageshow', (e) => { window._navlog('pageshow persisted=' + !!e.persisted); ensureOverlay(); });
  window.addEventListener('pagehide', (e) => window._navlog('pagehide persisted=' + !!e.persisted));
  document.addEventListener('DOMContentLoaded', () => { window._navlog('DOMContentLoaded'); ensureOverlay(); });
  document.addEventListener('visibilitychange', () => window._navlog('visibility=' + document.visibilityState));

  // Captura o clique em qualquer link p/ reader.html (cobre os resultados de
  // busca sem tocar no search.js). Capture phase: registra antes de qualquer
  // preventDefault, então se o bucket A acontecer (link interceptado) ainda
  // veremos o clique aqui e a AUSÊNCIA de pagehide depois conta a história.
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href*="reader.html"]');
    if (a) window._navlog('click a -> ' + (a.getAttribute('href') || '').slice(0, 90) + ' (defaultPrevented=' + e.defaultPrevented + ')');
  }, true);

  window._navlog('=== script load (readyState=' + document.readyState + ') ===');
  if (document.readyState !== 'loading') ensureOverlay();
})();
