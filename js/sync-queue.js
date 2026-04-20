// ============================================================
// Offline Sync Queue — IndexedDB-based queue for cloud operations
// Stores failed/pending operations and retries when online
// ============================================================

const DB_NAME = 'mioshie_sync_queue';
const DB_VERSION = 1;
const STORE_NAME = 'queue';
const RETRY_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 10;

let _db = null;
let _retryTimer = null;

function _openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('retries', 'retries', { unique: false });
        store.createIndex('operation', 'operation', { unique: false });
      }
    };
    request.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    request.onerror = (e) => reject(e.target.error);
  });
}

async function _enqueue(operation, payload) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = {
      operation,
      payload,
      status: 'pending',
      retries: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const req = store.add(item);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _getPendingItems() {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('status');
    const req = index.getAll('pending');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _updateItem(id, updates) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      if (!item) return resolve(null);
      Object.assign(item, updates, { updatedAt: Date.now() });
      const updateReq = store.put(item);
      updateReq.onsuccess = () => resolve(item);
      updateReq.onerror = () => reject(updateReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function _deleteItem(id) {
  const db = await _openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function _processQueue() {
  const items = await _getPendingItems();
  if (items.length === 0) return;

  const { supabase } = await import('./supabase-config.js');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  for (const item of items) {
    if (item.retries >= MAX_RETRIES) {
      await _updateItem(item.id, { status: 'failed' });
      continue;
    }

    try {
      let success = false;
      const { operation, payload } = item;

      if (operation === 'saveHighlight') {
        const { error } = await supabase
          .from('user_highlights')
          .upsert({
            user_id: session.user.id,
            volume: payload.volume,
            file: payload.file,
            topic_id: payload.topicId,
            topic_index: payload.topicIndex,
            topic_title: payload.topicTitle,
            color: payload.color,
            comment: payload.comment,
            text: payload.text,
            start_char: payload.startChar,
            end_char: payload.endChar,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id,volume,file,topic_id,start_char,end_char' });
        success = !error;
      } else if (operation === 'removeHighlight') {
        const { error } = await supabase
          .from('user_highlights')
          .delete()
          .eq('user_id', session.user.id)
          .eq('volume', payload.volume)
          .eq('file', payload.file)
          .eq('topic_id', payload.topicId)
          .eq('start_char', Number(payload.startChar))
          .eq('end_char', Number(payload.endChar));
        success = !error;
      }

      if (success) {
        await _deleteItem(item.id);
      } else {
        await _updateItem(item.id, { status: 'pending', retries: item.retries + 1 });
      }
    } catch (err) {
      await _updateItem(item.id, { status: 'pending', retries: item.retries + 1 });
    }
  }
}

function _scheduleRetry() {
  if (_retryTimer) clearInterval(_retryTimer);
  _retryTimer = setInterval(() => {
    if (navigator.onLine) _processQueue();
  }, RETRY_INTERVAL);
}

function _setupOnlineListener() {
  window.addEventListener('online', () => _processQueue());
}

export async function initSyncQueue() {
  await _openDB();
  _setupOnlineListener();
  _scheduleRetry();
  if (navigator.onLine) _processQueue();
}

export async function queueSaveHighlight(payload) {
  return _enqueue('saveHighlight', payload);
}

export async function queueRemoveHighlight(payload) {
  return _enqueue('removeHighlight', payload);
}

export async function getQueueStatus() {
  const items = await _getPendingItems();
  return { pending: items.length, online: navigator.onLine };
}
