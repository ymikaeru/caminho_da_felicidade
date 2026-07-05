/**
 * poetry-highlights.js — SALVAR poema (favorito).
 *
 * UX: 1 clique pra guardar, 1 clique pra remover. O poema é tratado como uma
 * UNIDADE que se guarda ou não (sem cor, sem comentário, sem grifar frase).
 *
 * ARMAZENAMENTO (mudou 07/2026): passou a usar o MESMO sistema dos
 * Ensinamentos Salvos — favoritos com pastas (savedFavorites / synced_favorites)
 * — em vez da tabela de grifos (user_highlights). Assim um poema e um
 * ensinamento podem ficar na MESMA pasta e tudo aparece junto na Central de
 * Salvos (salvos.html). Antes o "salvar poema" era um grifo disfarçado
 * (start=end=0) e tinha página própria (poemas-salvos.html, aposentada).
 *
 * Registro do favorito:
 *   vol='poetry', file=<coletânea>, topic=<número do poema> (= topic_index),
 *   topicTitle='Seção · № N', snippet=<verso>, folderId=<pasta|null>.
 * A chave (vol,file,topic) é única — o número do poema é único por coletânea.
 * O deep-link de volta (?poem=<id-string>) é remontado em salvos.html a partir
 * de (file, número) — ver o mapa POEM_ID lá.
 */
(function () {
  'use strict';

  function _lang() {
    return localStorage.getItem('site_lang') || 'pt';
  }

  function _loadFavs() {
    try { return JSON.parse(localStorage.getItem('savedFavorites') || '[]'); }
    catch (e) { return []; }
  }

  function _saveFavs(list) {
    try { localStorage.setItem('savedFavorites', JSON.stringify(list)); } catch (e) {}
  }

  const _isPoemFav = (f, file) => f.vol === 'poetry' && f.file === file;

  // Favoritos de poema DESTE arquivo.
  function _findAllForFile(file) {
    return _loadFavs().filter(f => _isPoemFav(f, file));
  }

  // Favorito de um poema específico, pela chave inteira (número = topic_index).
  function _findForIndex(file, topicIndex) {
    return _loadFavs().find(f => _isPoemFav(f, file) && (f.topic || 0) === topicIndex) || null;
  }

  // Leitura CLOUD-FIRST: puxa os favoritos da nuvem e garante que os DESTE
  // arquivo estejam no cache local (savedFavorites), pro pill "Salvo" aparecer
  // num aparelho novo sem precisar relogar (o pull do login também reconcilia,
  // mas isto adianta). Só adiciona o que falta — o remove da nuvem é
  // autoritativo (modelo de favoritos, sem tombstones). Resolve true se mudou.
  async function hydrateFromCloud(file) {
    const cs = window._cloudSync;
    if (!cs || !cs.loadFavorites) return false;
    let cloud;
    try { cloud = await cs.loadFavorites(); }
    catch (_) { return false; }
    if (!Array.isArray(cloud)) return false;

    const favs = _loadFavs();
    const keyOf = (v, f, t) => `${v}:${f}:${t || 0}`;
    const have = new Set(favs.map(f => keyOf(f.vol, f.file, f.topic)));
    let changed = false;
    for (const r of cloud) {
      if (r.volume !== 'poetry' || r.file !== file) continue;
      if (have.has(keyOf('poetry', file, r.topic_index))) continue;
      favs.push({
        title: r.topic_title || '', vol: 'poetry', file: r.file,
        time: new Date(r.created_at).getTime() || Date.now(),
        topic: r.topic_index, topicTitle: r.topic_title,
        snippet: r.snippet, totalTopics: r.total_topics,
        folderId: r.folder_id || null,
      });
      changed = true;
    }
    if (changed) _saveFavs(favs);
    return changed;
  }

  async function _save({ file, topicIndex, topicTitle, text }) {
    const cs = window._cloudSync;
    if (!cs) {
      alert(_lang() === 'ja' ? 'オンラインの必要があります。' : 'Você precisa estar online para salvar.');
      return null;
    }
    // Preserva as QUEBRAS DE LINHA (o salvos.html separa original/tradução por
    // linha) e os espaços fullwidth 　 do original; só normaliza runs de espaço
    // comum e linhas em branco. Cap folgado pra caber poema + tradução inteiros.
    const snippet = String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{2,}/g, '\n')
      .trim()
      .slice(0, 600);
    const now = Date.now();
    const fav = {
      title: topicTitle || '', vol: 'poetry', file, time: now,
      topic: topicIndex, topicTitle: topicTitle || '', snippet,
      totalTopics: 0, folderId: null,
    };
    const favs = _loadFavs();
    if (!favs.some(f => _isPoemFav(f, file) && (f.topic || 0) === topicIndex)) {
      favs.unshift(fav);
      _saveFavs(favs);
    }
    try {
      await cs.saveFavorite('poetry', file, topicIndex, topicTitle || '', snippet, 0, null);
    } catch (e) {
      console.warn('[poetry-highlights] cloud save failed:', e);
    }
    return fav;
  }

  async function _remove({ file, topicIndex }) {
    const cs = window._cloudSync;
    if (!cs) {
      alert(_lang() === 'ja' ? 'オンラインの必要があります。' : 'Você precisa estar online para remover.');
      return;
    }
    const favs = _loadFavs();
    if (!favs.some(f => _isPoemFav(f, file) && (f.topic || 0) === topicIndex)) return;
    _saveFavs(favs.filter(f => !(_isPoemFav(f, file) && (f.topic || 0) === topicIndex)));
    try {
      await cs.removeFavorite('poetry', file, topicIndex);
    } catch (e) {
      console.warn('[poetry-highlights] cloud remove failed:', e);
    }
  }

  // Pinta o estado "Salvo / Guardar" nos cards. Casa por NÚMERO do poema
  // (data-poem-index) contra o topic (= número) do favorito — assim funciona
  // até pros favoritos vindos da nuvem, que não carregam o id-string do card.
  function _applyToCards(file, cardSelector) {
    const saved = new Set(_findAllForFile(file).map(f => String(f.topic)));
    const lang = _lang();

    document.querySelectorAll(cardSelector).forEach(card => {
      const idx = card.dataset.poemIndex;
      const btn = card.querySelector('.poetry-card__bookmark');
      const isSaved = idx != null && saved.has(String(idx));
      const labelPtEl = btn?.querySelector('.poetry-card__bookmark-label.lang-pt');
      const labelJaEl = btn?.querySelector('.poetry-card__bookmark-label.lang-ja');
      if (isSaved) {
        card.dataset.poemSaved = '1';
        if (btn) {
          btn.classList.add('is-saved');
          btn.setAttribute('aria-pressed', 'true');
          btn.title = lang === 'ja' ? '保存済み — クリックで削除' : 'Salvo — clique pra remover';
          if (labelPtEl) labelPtEl.textContent = 'Salvo';
          if (labelJaEl) labelJaEl.textContent = '保存済';
        }
      } else {
        delete card.dataset.poemSaved;
        if (btn) {
          btn.classList.remove('is-saved');
          btn.setAttribute('aria-pressed', 'false');
          btn.title = lang === 'ja' ? '保存' : 'Salvar este poema';
          if (labelPtEl) labelPtEl.textContent = 'Guardar';
          if (labelJaEl) labelJaEl.textContent = '保存';
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

  // Compatibilidade com a 1ª versão (yama/warai usam isso no template do card).
  // Devolve string vazia agora que não há mais comentário.
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
      const topicId = card.dataset.poemTopicId;           // string p/ o getMeta
      const topicIndex = Number(card.dataset.poemIndex);  // chave inteira do favorito
      try {
        if (_findForIndex(file, topicIndex)) {
          await _remove({ file, topicIndex });
        } else {
          const meta = getMeta(topicId, card);
          if (!meta) return;
          await _save({ file, topicIndex: meta.topicIndex, topicTitle: meta.topicTitle, text: meta.text });
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
    // Compat: aceita o id-string do card ('yama_n123'/'waraino_0001') e casa
    // pelo número final contra o topic do favorito.
    findFor: (file, topicId) => {
      const m = String(topicId || '').match(/(\d+)\s*$/);
      return m ? _findForIndex(file, Number(m[1])) : null;
    },
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
