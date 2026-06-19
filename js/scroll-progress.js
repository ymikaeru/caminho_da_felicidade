// High-water mark de scroll para páginas que NÃO usam reader.js.
// Hoje: os leitores de poesia (warai, Akemaro, yama-to-mizu, gosanka-*).
//
// Por quê: o read-time-tracker registra TEMPO nessas páginas, mas o cálculo
// de scroll vivia só no reader.js. Resultado: toda leitura de poesia aparecia
// com "Leu = 0%" no admin (mesmo com minutos de leitura), o que disparava
// falso "possível dificuldade". Este módulo fecha esse buraco.
//
// Mede o progresso do DOCUMENTO inteiro (a página de poesia rola a janela,
// não tem #readerContainer), mantém o máximo atingido e persiste via a mesma
// RPC do reader (update_max_scroll_pct → só sobe, ignora <= 0).

let _started = false;
let _volume = null;
let _file = null;
let _maxPct = 0;
let _flushTimer = null;

// % do documento já exposto ao usuário (fundo da viewport / altura total).
// Se tudo cabe na tela, scrolled >= total → 100 (mesma semântica do reader.js).
function _computePct() {
  const doc = document.documentElement;
  const viewport = window.innerHeight || doc.clientHeight || 0;
  const total = Math.max(
    doc.scrollHeight || 0,
    document.body ? document.body.scrollHeight : 0
  );
  if (total <= 0 || viewport <= 0) return 0;
  const scrolled = (window.scrollY || window.pageYOffset || 0) + viewport;
  return Math.max(0, Math.min(100, Math.round((scrolled / total) * 100)));
}

function _track() {
  const cur = _computePct();
  if (cur > _maxPct) _maxPct = cur;
}

function _flush() {
  if (!_volume || !_file || _maxPct <= 0) return;
  try {
    // Mesma RPC do reader; idempotente (GREATEST no banco).
    window._cloudSync?.updateMaxScrollPct?.(_volume, _file, _maxPct);
  } catch (_) { /* silencioso: melhor perder 1 flush que quebrar a leitura */ }
}

/**
 * Inicia o rastreamento de scroll para um (volume, file). Idempotente: chamar
 * de novo com o mesmo arquivo não duplica listeners; com arquivo diferente,
 * faz flush do anterior e zera o máximo.
 */
export function startScrollTracking(volume, file) {
  if (!volume || !file) return;

  if (_started && (_volume !== volume || _file !== file)) {
    _track();
    _flush();
    _maxPct = 0;
  }
  _volume = volume;
  _file = file;

  if (_started) return;
  _started = true;

  // Event-driven: o máximo de scroll só muda quando o usuário rola.
  // (O TEMPO de permanência é problema do read-time-tracker, não daqui.)
  window.addEventListener('scroll', () => {
    _track();
    clearTimeout(_flushTimer);
    _flushTimer = setTimeout(_flush, 2000);
  }, { passive: true });

  // Garante o registro de quem leu sem rolar (poema curto que cabe na tela):
  // ao sair/esconder a aba, o conteúdo já renderizou e _computePct dá o valor real.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { _track(); _flush(); }
  });
  window.addEventListener('pagehide', () => { _track(); _flush(); });
  window.addEventListener('beforeunload', () => { _track(); _flush(); });
}
