/**
 * FileSystemFileHandle storage.
 *
 * Handles are structured-cloneable but not JSON-serialisable, so they can't live
 * in chrome.storage — IndexedDB is the only place that can keep them across
 * sessions. Keyed by project id.
 */

const DB_NAME = 'timit-fs';
const STORE = 'handles';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const getHandle = (key) => withStore('readonly', (s) => s.get(key));
export const setHandle = (key, handle) => withStore('readwrite', (s) => s.put(handle, key));
export const deleteHandle = (key) => withStore('readwrite', (s) => s.delete(key));
export const listHandleKeys = () => withStore('readonly', (s) => s.getAllKeys());

/** True when this page can use the File System Access API at all. */
export const fsSupported = () =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/**
 * Why file picking isn't available here — the two causes need different fixes.
 * @returns null when it works, otherwise 'disabled' | 'embedded'
 */
export function fsUnavailableReason() {
  if (fsSupported()) return null;
  // Brave hides the whole API behind brave://flags/#file-system-access-api;
  // an embedded options page has it but isn't allowed to open a dialog.
  if (typeof window !== 'undefined' && window.top !== window.self) return 'embedded';
  return 'disabled';
}

export const FLAG_URL = 'brave://flags/#file-system-access-api';

/**
 * @param {'granted'|'prompt'} required
 * @returns 'granted' | 'prompt' | 'denied'
 */
export async function handlePermission(handle, { request = false } = {}) {
  const opts = { mode: 'readwrite' };
  const state = await handle.queryPermission(opts);
  if (state === 'granted' || !request) return state;
  // Only ever call this from a click handler — Chrome requires user activation.
  return handle.requestPermission(opts);
}
