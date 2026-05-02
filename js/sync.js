// ============================================================
// Cloud Sync — Mioshie College
// Syncs reading positions and favorites between localStorage and Supabase
// ============================================================
import SUPABASE_CONFIG, { supabase } from './supabase-config.js';

// ============================================================
// Reading Positions
// ============================================================

export async function saveReadingPosition(volume, file, topicIndex, totalTopics, paragraphIndex) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const progressPct = totalTopics > 0 ? Math.round((topicIndex / totalTopics) * 10000) / 100 : 0;

  const baseRow = {
    user_id: session.user.id,
    volume,
    file,
    topic_index: topicIndex,
    total_topics: totalTopics,
    progress_pct: progressPct,
    updated_at: new Date().toISOString()
  };

  // Tenta com paragraph_index; se a coluna ainda não existe (migração
  // não rodou), refaz o upsert sem esse campo.
  if (Number.isInteger(paragraphIndex)) {
    const { error } = await supabase
      .from('reading_positions')
      .upsert({ ...baseRow, paragraph_index: paragraphIndex }, { onConflict: 'user_id,volume,file' });
    if (error && /paragraph_index/i.test(error.message || '')) {
      await supabase
        .from('reading_positions')
        .upsert(baseRow, { onConflict: 'user_id,volume,file' });
    }
    return;
  }

  await supabase
    .from('reading_positions')
    .upsert(baseRow, { onConflict: 'user_id,volume,file' });
}

export async function loadReadingPositions() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data } = await supabase
    .from('reading_positions')
    .select('volume, file, topic_index, total_topics, progress_pct, updated_at')
    .eq('user_id', session.user.id)
    .order('updated_at', { ascending: false })
    .limit(100);

  return data || [];
}

export async function getLastPosition(volume, file) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  // Tenta com paragraph_index; se a coluna ainda não existe (migração
  // não rodou), faz fallback pro select original.
  let { data, error } = await supabase
    .from('reading_positions')
    .select('topic_index, total_topics, progress_pct, paragraph_index')
    .eq('user_id', session.user.id)
    .eq('volume', volume)
    .eq('file', file)
    .maybeSingle();

  if (error && /paragraph_index/i.test(error.message || '')) {
    ({ data } = await supabase
      .from('reading_positions')
      .select('topic_index, total_topics, progress_pct')
      .eq('user_id', session.user.id)
      .eq('volume', volume)
      .eq('file', file)
      .maybeSingle());
  }

  return data;
}

// ============================================================
// Favorites
// ============================================================

export async function saveFavorite(volume, file, topicIndex, topicTitle, snippet, totalTopics) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  await supabase
    .from('synced_favorites')
    .upsert({
      user_id: session.user.id,
      volume,
      file,
      topic_index: topicIndex,
      topic_title: topicTitle,
      snippet,
      total_topics: totalTopics,
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id,volume,file,topic_index' });
}

export async function removeFavorite(volume, file, topicIndex) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  await supabase
    .from('synced_favorites')
    .delete()
    .eq('user_id', session.user.id)
    .eq('volume', volume)
    .eq('file', file)
    .eq('topic_index', topicIndex);
}

export async function loadFavorites() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data } = await supabase
    .from('synced_favorites')
    .select('volume, file, topic_index, topic_title, snippet, total_topics, created_at')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(500);

  return data || [];
}

export async function isFavorite(volume, file, topicIndex) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  const { data } = await supabase
    .from('synced_favorites')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('volume', volume)
    .eq('file', file)
    .eq('topic_index', topicIndex)
    .maybeSingle();

  return !!data;
}

// ============================================================
// Pull cloud → local (hydrate localStorage on new devices)
// Favorites: union by (vol, file, topic).
// Reading positions: last-write-wins per (vol, file) by updated_at.
// ============================================================

export async function pullCloudToLocal() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { favorites: 0, positions: 0 };

  let favAdded = 0, posMerged = 0;

  try {
    const cloudFavs = await loadFavorites();
    let localFavs = [];
    try { localFavs = JSON.parse(localStorage.getItem('savedFavorites') || '[]'); } catch (e) {}

    const localKeys = new Set(localFavs.map(f => `${f.vol}:${f.file}:${f.topic || 0}`));
    for (const cf of cloudFavs) {
      const key = `${cf.volume}:${cf.file}:${cf.topic_index}`;
      if (!localKeys.has(key)) {
        localFavs.push({
          title: cf.topic_title || '',
          vol: cf.volume,
          file: cf.file,
          time: new Date(cf.created_at).getTime(),
          topic: cf.topic_index,
          topicTitle: cf.topic_title,
          snippet: cf.snippet,
          totalTopics: cf.total_topics,
        });
        favAdded++;
      }
    }
    if (favAdded > 0) {
      localFavs.sort((a, b) => (b.time || 0) - (a.time || 0));
      localStorage.setItem('savedFavorites', JSON.stringify(localFavs));
    }
  } catch (e) {
    console.warn('pullCloudToLocal favorites failed:', e);
  }

  try {
    const cloudPos = await loadReadingPositions();
    let localHist = [];
    try { localHist = JSON.parse(localStorage.getItem('readHistory') || '[]'); } catch (e) {}

    // Tombstone: se o usuário limpou o histórico, não trazemos de volta
    // entradas do cloud que já existiam antes do clear. Só novas
    // atividades (updated_at > clearedAt) repopulam.
    let clearedAt = 0;
    try { clearedAt = parseInt(localStorage.getItem('readHistoryClearedAt') || '0', 10) || 0; } catch (e) {}

    const localMap = new Map(localHist.map(h => [`${h.vol}:${h.file}`, h]));
    for (const cp of cloudPos) {
      const key = `${cp.volume}:${cp.file}`;
      const cloudTime = new Date(cp.updated_at).getTime();
      if (cloudTime <= clearedAt) continue;
      const local = localMap.get(key);

      if (!local) {
        localHist.push({
          title: cp.file.replace('.html', ''),
          vol: cp.volume,
          file: cp.file,
          time: cloudTime,
          topic: cp.topic_index,
          totalTopics: cp.total_topics,
        });
        posMerged++;
      } else if (cloudTime > (local.time || 0)) {
        local.topic = cp.topic_index;
        local.totalTopics = cp.total_topics;
        local.time = cloudTime;
        posMerged++;
      }
    }
    if (posMerged > 0) {
      localHist.sort((a, b) => (b.time || 0) - (a.time || 0));
      localStorage.setItem('readHistory', JSON.stringify(localHist.slice(0, 50)));
    }
  } catch (e) {
    console.warn('pullCloudToLocal positions failed:', e);
  }

  let highlightsAdded = 0;
  try {
    const cloudHighlights = await loadAllHighlights();
    let localHighlights = [];
    try { localHighlights = JSON.parse(localStorage.getItem('userHighlights') || '[]'); } catch (e) {}

    const localKeys = new Set(localHighlights.map(h => `${h.vol}:${h.file}:${h.topicId}:${h.startChar}:${h.endChar}`));

    // Respect deleted tombstones so cloud doesn't re-add removed highlights
    const deletedKeys = new Set(JSON.parse(localStorage.getItem('highlightDeletedKeys') || '[]'));

    for (const ch of cloudHighlights) {
      const key = `${ch.volume}:${ch.file}:${ch.topic_id}:${ch.start_char}:${ch.end_char}`;
      if (!localKeys.has(key) && !deletedKeys.has(key)) {
        localHighlights.push({
          id: `hl_cloud_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          vol: ch.volume,
          file: ch.file,
          topicId: ch.topic_id,
          topicIndex: ch.topic_index,
          topicTitle: ch.topic_title || '',
          color: ch.color || 'yellow',
          comment: ch.comment || '',
          text: ch.text || '',
          startChar: ch.start_char,
          endChar: ch.end_char,
          createdAt: new Date(ch.updated_at).getTime(),
          updatedAt: new Date(ch.updated_at).getTime(),
        });
        highlightsAdded++;
      }
    }
    if (highlightsAdded > 0) {
      localHighlights.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      localStorage.setItem('userHighlights', JSON.stringify(localHighlights));
    }
  } catch (e) {
    console.warn('pullCloudToLocal highlights failed:', e);
  }

  return { favorites: favAdded, positions: posMerged, highlights: highlightsAdded };
}

// ============================================================
// Initial sync: merge localStorage → cloud (on first login)
// ============================================================

export async function syncLocalStorageToCloud() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  // Sync favorites
  try {
    const localFavs = JSON.parse(localStorage.getItem('savedFavorites') || '[]');
    if (localFavs.length > 0) {
      const cloudFavs = await loadFavorites();
      const cloudKeys = new Set(cloudFavs.map(f => `${f.volume}:${f.file}:${f.topic_index}`));

      for (const f of localFavs) {
        const key = `${f.vol}:${f.file}:${f.topic || 0}`;
        if (!cloudKeys.has(key)) {
          await saveFavorite(f.vol, f.file, f.topic || 0, f.topicTitle || '', f.snippet || '', f.totalTopics || 1);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to sync favorites to cloud:', e);
  }

  // Sync highlights
  try {
    const localHighlights = JSON.parse(localStorage.getItem('userHighlights') || '[]');
    if (localHighlights.length > 0) {
      const cloudHighlights = await loadAllHighlights();
      const cloudKeys = new Set(cloudHighlights.map(h => `${h.volume}:${h.file}:${h.topic_id}:${h.start_char}:${h.end_char}`));
      for (const h of localHighlights) {
        const key = `${h.vol}:${h.file}:${h.topicId}:${h.startChar}:${h.endChar}`;
        if (!cloudKeys.has(key)) {
          await saveHighlight(
            h.vol, h.file, h.topicId, h.topicIndex, h.topicTitle || '',
            h.color || 'yellow', h.comment || '', h.text || '',
            h.startChar, h.endChar
          );
        }
      }
    }
  } catch (e) {
    console.warn('Failed to sync highlights to cloud:', e);
  }

  // Sync reading positions
  try {
    const localHistory = JSON.parse(localStorage.getItem('readHistory') || '[]');
    if (localHistory.length > 0) {
      const cloudPositions = await loadReadingPositions();
      const cloudKeys = new Set(cloudPositions.map(p => `${p.volume}:${p.file}`));

      for (const h of localHistory) {
        const key = `${h.vol}:${h.file}`;
        if (!cloudKeys.has(key)) {
          await saveReadingPosition(h.vol, h.file, h.topic || 0, h.totalTopics || 1);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to sync reading positions to cloud:', e);
  }
}

// ============================================================
// Highlights
// ============================================================

export async function saveHighlight(volume, file, topicId, topicIndex, topicTitle, color, comment, text, startChar, endChar) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (window._syncQueue) {
      await window._syncQueue.queueSaveHighlight({ volume, file, topicId, topicIndex, topicTitle, color, comment, text, startChar, endChar });
    }
    return;
  }

  try {
    const { error } = await supabase
      .from('user_highlights')
      .upsert({
        user_id: session.user.id,
        volume,
        file,
        topic_id: topicId,
        topic_index: topicIndex,
        topic_title: topicTitle,
        color,
        comment,
        text,
        start_char: startChar,
        end_char: endChar,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,volume,file,topic_id,start_char,end_char' });

    if (error && window._syncQueue) {
      await window._syncQueue.queueSaveHighlight({ volume, file, topicId, topicIndex, topicTitle, color, comment, text, startChar, endChar });
    }
  } catch (err) {
    if (window._syncQueue) {
      await window._syncQueue.queueSaveHighlight({ volume, file, topicId, topicIndex, topicTitle, color, comment, text, startChar, endChar });
    }
  }
}

export async function removeHighlight(volume, file, topicId, startChar, endChar) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (window._syncQueue) {
      await window._syncQueue.queueRemoveHighlight({ volume, file, topicId, startChar, endChar });
    }
    return;
  }

  try {
    const { error, count } = await supabase
      .from('user_highlights')
      .delete({ count: 'exact' })
      .eq('user_id', session.user.id)
      .eq('volume', volume)
      .eq('file', file)
      .eq('topic_id', topicId)
      .eq('start_char', Number(startChar))
      .eq('end_char', Number(endChar));

    if (error) {
      console.error('[sync] removeHighlight failed:', error.message, { volume, file, topicId, startChar, endChar });
      if (window._syncQueue) {
        await window._syncQueue.queueRemoveHighlight({ volume, file, topicId, startChar, endChar });
      }
      return;
    }

    if (count === 0) {
      // Row didn't match — either already deleted on another device, or local/cloud
      // schema mismatch on start_char/end_char. Either way, retrying won't help, so
      // just surface a warning instead of enqueueing an infinite retry loop.
      console.warn('[sync] removeHighlight: 0 rows matched', { volume, file, topicId, startChar, endChar });
    }
  } catch (err) {
    console.error('[sync] removeHighlight threw:', err);
    if (window._syncQueue) {
      await window._syncQueue.queueRemoveHighlight({ volume, file, topicId, startChar, endChar });
    }
  }
}

export async function loadAllHighlights() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const { data } = await supabase
    .from('user_highlights')
    .select('volume, file, topic_id, topic_index, topic_title, color, comment, text, start_char, end_char, updated_at')
    .eq('user_id', session.user.id)
    .order('updated_at', { ascending: false })
    .limit(1000);

  return data || [];
}

// ============================================================
// Export supabase instance for direct use
// ============================================================
export { supabase };
