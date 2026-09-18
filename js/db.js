// IndexedDB の薄いラッパ。window.DB で公開。
// ストア: residents(利用者) / stays(滞在=持参品リスト) / photos(写真本体) / meta(設定)
// スキーマを変える時は既存ストアに触らず、version を上げて新ストアを足す。
(function () {
  'use strict';
  const DB = { name: 'mochimono_db', version: 1 };
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('このブラウザは保存機能(IndexedDB)に対応していません'));
      const req = indexedDB.open(DB.name, DB.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('residents')) db.createObjectStore('residents', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('stays')) {
          db.createObjectStore('stays', { keyPath: 'id' }).createIndex('residentId', 'residentId');
        }
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('データベースを開けません'));
    });
    return dbp;
  }

  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let result;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('保存に失敗しました'));
    }));
  }

  DB.getAll = (store) => run(store, 'readonly', (s) => s.getAll());
  DB.get = (store, id) => run(store, 'readonly', (s) => s.get(id));
  DB.put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
  DB.del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
  DB.clear = (store) => run(store, 'readwrite', (s) => s.clear());
  DB.staysByResident = (rid) => run('stays', 'readonly', (s) => s.index('residentId').getAll(rid));

  DB.getMeta = async function (key, dflt) {
    const rec = await DB.get('meta', key);
    return rec ? rec.value : dflt;
  };
  DB.setMeta = (key, value) => DB.put('meta', { key: key, value: value });

  // どの滞在からも参照されなくなった写真本体を消す
  DB.dropPhotosIfUnused = async function (ids) {
    if (!ids || !ids.length) return;
    const used = new Set();
    (await DB.getAll('stays')).forEach((st) => {
      (st.photos || []).forEach((p) => used.add(p.id));
      (st.items || []).forEach((it) => (it.photos || []).forEach((p) => used.add(p.id)));
    });
    for (const id of ids) if (!used.has(id)) await DB.del('photos', id);
  };

  DB.reset = function () { // 名前を差し替えた後に開き直す用（devtools）
    if (dbp) dbp.then((db) => db.close());
    dbp = null;
  };

  window.DB = DB;
})();
