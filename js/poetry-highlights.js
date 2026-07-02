/**
 * poetry-highlights.js — bookmark de poemas (Yama to Mizu / Warai no Izumi).
 *
 * UX: 1 click pra salvar, 1 click pra remover. Sem cores, sem comentário —
 * pra essas duas coletâneas faz mais sentido tratar o poema como uma
 * unidade que se guarda ou não, em vez de aplicar grifo a uma frase.
 *
 * Armazenamento: reaproveita o mesmo schema/tabela user_highlights pra não
 * duplicar infra. Campos:
 *   vol='poetry', file='yama-to-mizu' | 'warai-no-izumi',
 *   topic_id=ID estável do poema, start_char=0, end_char=0, color='yellow'.
 * Como start/end=0 e topic_id é único por poema, o upsert deduplica.
 *
 * A Central de Destaques (destaques.html) filtra esses fora; a lista
 * dedicada aparece em poemas-salvos.html.
 */
(function () {
  'use strict';

  const SAVED_COLOR = 'yellow'; // valor obrigatório no schema; não é mostrado

  function _lang() {
    return localStorage.getItem('site_lang') || 'pt';
  }

  function _loadAll() {
    try { return JSON.parse(localStorage.getItem('userHighlights') || '[]'); }
    catch (e) { return []; }
  }

  function _saveAll(list) {
    try { localStorage.setItem('userHighlights', JSON.stringify(list)); } catch (e) {}
  }

  function _addTombstone(key) {
    try {
      const t = JSON.parse(localStorage.getItem('highlightDeletedKeys') || '[]');
      t.push(key);
      if (t.length > 2000) t.splice(0, t.length - 2000);
      localStorage.setItem('highlightDeletedKeys', JSON.stringify(t));
    } catch (e) {}
  }

  const _HL_KEY = (vol, file, topicId, s, e) => `${vol}:${file}:${topicId}:${s}:${e}`;

  function _getTombstones() {
    try { return JSON.parse(localStorage.getItem('highlightDeletedKeys') || '[]'); }
    catch (_) { return []; }
  }

  // Leitura CLOUD-FIRST dos poemas salvos: puxa os grifos de poesia DESTE
  // arquivo da nuvem e reconcilia com o cache local (userHighlights),
  // respeitando tombstones. Sem isto, num aparelho novo (ou sem relogar) o pill
  // "Salvo" não aparecia — o fluxo antigo lia só o localStorage e os leitores
  // compensavam com chutes de setTimeout esperando o pullCloudToLocal do login.
  // Espelha _reconcileCloudRows do leitor principal. Resolve true se mudou.
  async function hydrateFromCloud(file) {
    if (!window._cloudSync || !window._cloudSync.loadHighlightsForPage) return false;
    let rows;
    try { rows = await window._cloudSync.loadHighlightsForPage('poetry', file); }
    catch (_) { return false; }
    if (!Array.isArray(rows)) return false;   // null = sem sessão → mantém o cache

    const tomb = new Set(_getTombstones());
    const all = _loadAll();
    const inScope = (h) => h.vol === 'poetry' && h.file === file;
    const localScoped = all.filter(inScope);
    const localByKey = new Map(localScoped.map(h => [_HL_KEY(h.vol, h.file, h.topicId, h.startChar, h.endChar), h]));

    const merged = [];
    const seen = new Set();
    rows.forEach(r => {
      const key = _HL_KEY(r.volume, r.file, r.topic_id, r.start_char, r.end_char);
      if (tomb.has(key) || seen.has(key)) return;
      seen.add(key);
      const local = localByKey.get(key);
      if (local) { merged.push(local); return; }
      merged.push({
        id: 'hl_cloud_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        vol: r.volume, file: r.file, topicId: r.topic_id,
        topicIndex: r.topic_index, topicTitle: r.topic_title || '',
        color: r.color || SAVED_COLOR, comment: r.comment || '', text: r.text || '',
        startChar: r.start_char, endChar: r.end_char,
        createdAt: new Date(r.updated_at).getTime() || Date.now(),
        updatedAt: new Date(r.updated_at).getTime() || Date.now(),
      });
    });
    // Grifos só-locais recentes (salvamento em voo) sobrevivem à reconciliação.
    const cutoff = Date.now() - 10 * 60 * 1000;
    localScoped.forEach(h => {
      const key = _HL_KEY(h.vol, h.file, h.topicId, h.startChar, h.endChar);
      if (!seen.has(key) && (h.updatedAt || 0) > cutoff) merged.push(h);
    });

    const sig = (list) => list.map(h => _HL_KEY(h.vol, h.file, h.topicId, h.startChar, h.endChar)).sort().join('\n');
    const changed = sig(merged) !== sig(localScoped);
    if (changed) _saveAll(all.filter(h => !inScope(h)).concat(merged));
    return changed;
  }

  function _findFor(file, topicId) {
    return _loadAll().find(h => h.vol === 'poetry' && h.file === file && h.topicId === topicId) || null;
  }

  function _findAllForFile(file) {
    return _loadAll().filter(h => h.vol === 'poetry' && h.file === file);
  }

  async function _save({ file, topicId, topicIndex, topicTitle, text }) {
    if (!window._cloudSync) {
      alert(_lang() === 'ja' ? 'オンラインの必要があります。' : 'Você precisa estar online para salvar.');
      return null;
    }
    const all = _loadAll();
    const now = Date.now();
    const record = {
      id: 'hl_' + now + '_' + Math.random().toString(36).substr(2, 6),
      vol: 'poetry',
      file,
      topicId,
      topicIndex,
      topicTitle,
      color: SAVED_COLOR,
      comment: '',
      text,
      startChar: 0,
      endChar: 0,
      createdAt: now,
      updatedAt: now
    };
    all.unshift(record);
    _saveAll(all);

    try {
      await window._cloudSync.saveHighlight(
        'poetry', file, topicId, topicIndex, topicTitle,
        SAVED_COLOR, '', text, 0, 0
      );
    } catch (e) {
      console.warn('[poetry-highlights] cloud save failed:', e);
    }
    return record;
  }

  async function _remove({ file, topicId }) {
    if (!window._cloudSync) {
      alert(_lang() === 'ja' ? 'オンラインの必要があります。' : 'Você precisa estar online para remover.');
      return;
    }
    const all = _loadAll();
    if (!all.some(h => h.vol === 'poetry' && h.file === file && h.topicId === topicId)) return;

    _saveAll(all.filter(h => !(h.vol === 'poetry' && h.file === file && h.topicId === topicId)));
    _addTombstone(`poetry:${file}:${topicId}:0:0`);

    try {
      await window._cloudSync.removeHighlight('poetry', file, topicId, 0, 0);
    } catch (e) {
      console.warn('[poetry-highlights] cloud remove failed:', e);
    }
  }

  function _applyToCards(file, cardSelector) {
    const saved = new Set(_findAllForFile(file).map(h => h.topicId));
    const lang = _lang();
    const savedLabelPt = 'Salvo';
    const unsavedLabelPt = 'Guardar';
    const savedLabelJa = '保存済';
    const unsavedLabelJa = '保存';

    document.querySelectorAll(cardSelector).forEach(card => {
      const topicId = card.dataset.poemTopicId;
      const btn = card.querySelector('.poetry-card__bookmark');
      const isSaved = topicId && saved.has(topicId);
      const labelPtEl = btn?.querySelector('.poetry-card__bookmark-label.lang-pt');
      const labelJaEl = btn?.querySelector('.poetry-card__bookmark-label.lang-ja');
      if (isSaved) {
        card.dataset.poemSaved = '1';
        if (btn) {
          btn.classList.add('is-saved');
          btn.setAttribute('aria-pressed', 'true');
          btn.title = lang === 'ja' ? '保存済み — クリックで削除' : 'Salvo — clique pra remover';
          if (labelPtEl) labelPtEl.textContent = savedLabelPt;
          if (labelJaEl) labelJaEl.textContent = savedLabelJa;
        }
      } else {
        delete card.dataset.poemSaved;
        if (btn) {
          btn.classList.remove('is-saved');
          btn.setAttribute('aria-pressed', 'false');
          btn.title = lang === 'ja' ? '保存' : 'Salvar este poema';
          if (labelPtEl) labelPtEl.textContent = unsavedLabelPt;
          if (labelJaEl) labelJaEl.textContent = unsavedLabelJa;
        }
      }
    });
  }

  function _renderCardButton() {
    const lang = _lang();
    const title = lang === 'ja' ? '保存' : 'Salvar este poema';
    // Pill com ícone + label. Visual coerente com .poetry-card__tag (penname).
    return (
      `<button type="button" class="poetry-card__bookmark" title="${title}" aria-label="${title}" aria-pressed="false">` +
        `<svg viewBox="0 0 24 24" aria-hidden="true">` +
          `<path d="M7 4h10a1 1 0 0 1 1 1v16l-6-3.5L6 21V5a1 1 0 0 1 1-1z" ` +
            `fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
        `</svg>` +
        `<span class="poetry-card__bookmark-label lang-pt">Guardar</span>` +
        `<span class="poetry-card__bookmark-label lang-ja" style="display:none">保存</span>` +
      `</button>`
    );
  }

  // Para compatibilidade com a primeira versão (yama/warai usam isso no template
  // do card). Devolve string vazia agora que não há mais comentário.
  function _renderCardCommentSlot() {
    return '';
  }

  function _wireCardButtons({ container, file, getMeta, onChange }) {
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.poetry-card__bookmark');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.busy === '1') return;
      btn.dataset.busy = '1';

      const card = btn.closest('[data-poem-topic-id]');
      if (!card) { delete btn.dataset.busy; return; }
      const topicId = card.dataset.poemTopicId;
      const existing = _findFor(file, topicId);
      try {
        if (existing) {
          await _remove({ file, topicId });
        } else {
          const meta = getMeta(topicId, card);
          if (!meta) return;
          await _save({
            file,
            topicId,
            topicIndex: meta.topicIndex,
            topicTitle: meta.topicTitle,
            text: meta.text
          });
        }
        if (typeof onChange === 'function') onChange();
      } finally {
        delete btn.dataset.busy;
        // Em touch, o foco/active gruda no botão depois do tap e fica
        // visualmente solto — sem hover-out pra limpar. Tira o foco.
        try { btn.blur(); } catch (e) {}
      }
    });
  }

  window._poetryHighlights = {
    renderCardButton: _renderCardButton,
    renderCardCommentSlot: _renderCardCommentSlot,
    applyToCards: _applyToCards,
    wireCardButtons: _wireCardButtons,
    hydrateFromCloud: hydrateFromCloud,
    findFor: _findFor,
    findAllForFile: _findAllForFile,
  };

  // Bottom-sheet modal do sidebar no mobile: fecha quando o usuário toca
  // no backdrop (qualquer área fora do .poetry-sidebar e fora do toggle).
  // O backdrop visual é puro CSS via body:has(.poetry-sidebar.is-open)::before
  // — esse listener só fornece o handler de "tap fora".
  document.addEventListener('click', (e) => {
    const open = document.querySelector('.poetry-sidebar.is-open');
    if (!open) return;
    if (open.contains(e.target)) return;
    if (e.target.closest('.poetry-sidebar-toggle')) return;
    open.classList.remove('is-open');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.poetry-sidebar.is-open');
    if (open) open.classList.remove('is-open');
  });
})();
