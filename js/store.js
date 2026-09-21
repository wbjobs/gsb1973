'use strict';
(function (global) {
  const DB_NAME = 'mega-grid-db';
  const DB_VERSION = 1;
  const STORE = 'cells';

  class GridStore {
    constructor() {
      this.db = null;
      this.degraded = false;
      this.memory = new Map();
    }

    open() {
      return new Promise((resolve) => {
        let req;
        try {
          req = global.indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
          this.degraded = true;
          resolve(false);
          return;
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE);
          }
        };
        req.onsuccess = () => {
          this.db = req.result;
          this.db.onversionchange = () => this.db.close();
          resolve(true);
        };
        req.onerror = () => {
          this.degraded = true;
          resolve(false);
        };
        req.onblocked = () => {
          this.degraded = true;
          resolve(false);
        };
      });
    }

    loadAll() {
      if (this.degraded || !this.db) {
        return Promise.resolve(Array.from(this.memory.entries()));
      }
      return new Promise((resolve) => {
        const out = [];
        let tx;
        try {
          tx = this.db.transaction(STORE, 'readonly');
        } catch (err) {
          this.degraded = true;
          resolve(Array.from(this.memory.entries()));
          return;
        }
        const cursorReq = tx.objectStore(STORE).openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            out.push([cursor.key, cursor.value]);
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => {
          this.degraded = true;
          resolve(out);
        };
        tx.onabort = () => {
          this.degraded = true;
          resolve(out);
        };
      });
    }

    saveBatch(entries) {
      for (const [key, value] of entries) {
        if (value === null) this.memory.delete(key);
        else this.memory.set(key, value);
      }
      if (this.degraded || !this.db) return Promise.resolve(false);
      return new Promise((resolve) => {
        let tx;
        try {
          tx = this.db.transaction(STORE, 'readwrite');
        } catch (err) {
          this.degraded = true;
          resolve(false);
          return;
        }
        const store = tx.objectStore(STORE);
        for (const [key, value] of entries) {
          if (value === null) store.delete(key);
          else store.put(value, key);
        }
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          this.degraded = true;
          resolve(false);
        };
        tx.onabort = () => {
          this.degraded = true;
          resolve(false);
        };
      });
    }

    clear() {
      this.memory.clear();
      if (this.degraded || !this.db) return Promise.resolve(false);
      return new Promise((resolve) => {
        let tx;
        try {
          tx = this.db.transaction(STORE, 'readwrite');
        } catch (err) {
          this.degraded = true;
          resolve(false);
          return;
        }
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => {
          this.degraded = true;
          resolve(false);
        };
      });
    }
  }

  global.GridStore = GridStore;
})(typeof self !== 'undefined' ? self : this);
