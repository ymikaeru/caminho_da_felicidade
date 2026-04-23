// Rastreia tempo REAL de leitura no reader, estilo YouTube.
// - Só conta quando aba visível, janela focada e houve atividade recente.
// - Envia heartbeat a cada 15 s via RPC increment_read_time (soma delta no banco).
// - Descarta deltas > 300 s (usuário voltou de longe) para evitar inflação.

import { supabase } from './supabase-config.js';

const HEARTBEAT_MS = 15000;     // intervalo de envio
const IDLE_TIMEOUT_MS = 45000;  // inativo após 45 s sem scroll/click/keydown/mouse
const MAX_DELTA_SECS = 300;     // cap por chamada (seguro contra clock jumps)

let _currentKey = null;         // `${volume}|${file}`
let _currentVolume = null;
let _currentFile = null;
let _accumulatedMs = 0;         // tempo não enviado ainda (ms)
let _lastTickAt = 0;            // timestamp do último tick
let _lastActivityAt = 0;        // timestamp da última atividade do usuário
let _intervalId = null;
let _started = false;

function _now() { return Date.now(); }

function _isActive() {
  if (document.visibilityState !== 'visible') return false;
  if (!document.hasFocus()) return false;
  if (_now() - _lastActivityAt > IDLE_TIMEOUT_MS) return false;
  return true;
}

function _tick() {
  const now = _now();
  if (_lastTickAt && _isActive()) {
    _accumulatedMs += now - _lastTickAt;
  }
  _lastTickAt = now;
}

async function _flush() {
  if (!_currentVolume || !_currentFile) return;
  const secs = Math.floor(_accumulatedMs / 1000);
  if (secs <= 0) return;
  const delta = Math.min(secs, MAX_DELTA_SECS);
  _accumulatedMs -= delta * 1000;
  try {
    const { error } = await supabase.rpc('increment_read_time', {
      p_volume: _currentVolume,
      p_file: _currentFile,
      p_delta: delta
    });
    if (error) {
      console.warn('[read-time-tracker] RPC failed:', error.message);
      _accumulatedMs += delta * 1000; // devolve para tentar de novo depois
    }
  } catch (e) {
    console.warn('[read-time-tracker] flush failed:', e);
    _accumulatedMs += delta * 1000;
  }
}

function _onActivity() {
  _lastActivityAt = _now();
}

function _onVisibility() {
  if (document.visibilityState === 'hidden') {
    _tick();
    _flush();
  } else {
    _lastTickAt = _now();
    _lastActivityAt = _now();
  }
}

function _attachListeners() {
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']
    .forEach(ev => window.addEventListener(ev, _onActivity, { passive: true }));
  document.addEventListener('visibilitychange', _onVisibility);
  window.addEventListener('focus', _onVisibility);
  window.addEventListener('blur', _onVisibility);
  window.addEventListener('pagehide', _flush);
  window.addEventListener('beforeunload', _flush);
}

/**
 * Inicia o tracking para um novo ensinamento. Se já houver sessão ativa em
 * outro arquivo, faz flush primeiro.
 */
export async function startTracking(volume, file) {
  if (!volume || !file) return;
  const key = `${volume}|${file}`;
  if (_currentKey === key && _started) return; // mesmo artigo, já rastreando

  // Muda de artigo — envia acumulado do anterior antes
  if (_currentKey && _currentKey !== key) {
    _tick();
    await _flush();
  }

  _currentKey = key;
  _currentVolume = volume;
  _currentFile = file;
  _accumulatedMs = 0;
  _lastTickAt = _now();
  _lastActivityAt = _now();

  if (!_started) {
    _attachListeners();
    _intervalId = setInterval(async () => {
      _tick();
      // Envia a cada HEARTBEAT_MS se tiver ≥ 10 s acumulados
      if (_accumulatedMs >= 10000) await _flush();
    }, HEARTBEAT_MS);
    _started = true;
  }
}

/**
 * Para o tracking do artigo atual e envia o acumulado.
 */
export async function stopTracking() {
  if (!_started) return;
  _tick();
  await _flush();
  _currentKey = null;
  _currentVolume = null;
  _currentFile = null;
  _accumulatedMs = 0;
}
