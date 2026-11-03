// Хранилище на устройстве: IndexedDB (каталоги BSData, ростеры, настройки).
const DB = (() => {
  let dbp;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const rq = indexedDB.open('liber-rosterum', 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        for (const s of ['files', 'rosters', 'kv']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    get: (store, k) => open().then(db => req(db.transaction(store).objectStore(store).get(k))),
    put: (store, k, v) => tx(store, 'readwrite', s => { s.put(v, k); }),
    del: (store, k) => tx(store, 'readwrite', s => { s.delete(k); }),
    keys: store => open().then(db => req(db.transaction(store).objectStore(store).getAllKeys())),
    all: store => open().then(db => req(db.transaction(store).objectStore(store).getAll())),
  };
})();

// Настройки — маленькие, держим в localStorage (с защитой от приватного режима)
const Prefs = {
  get(k, def) { try { const v = localStorage.getItem('lr_' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('lr_' + k, JSON.stringify(v)); } catch (e) { } },
};

// Попросить у браузера «постоянное» хранилище, чтобы iOS не вычищал данные
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
