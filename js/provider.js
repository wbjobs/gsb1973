'use strict';

class LocalBackend {
  constructor() {
    this.edits = new Map();
    this.store = new GridStore();
    this.persistTimer = null;
    this.dirtyBuffer = new Map();
    this.kind = 'local';
  }

  init() {
    return this.store.open()
      .then(() => this.store.loadAll())
      .then((entries) => {
        for (const [key, value] of entries) this.edits.set(key, value);
        return { count: this.edits.size, degraded: this.store.degraded };
      });
  }

  getRange(r0, c0, r1, c1) {
    const cells = [];
    for (const [key, value] of this.edits) {
      const comma = key.indexOf(',');
      const r = +key.slice(0, comma);
      const c = +key.slice(comma + 1);
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) cells.push([r, c, value]);
    }
    return Promise.resolve(cells);
  }

  applyEdits(list) {
    const previous = [];
    for (const [r, c, v] of list) {
      const key = r + ',' + c;
      previous.push([r, c, this.edits.has(key) ? this.edits.get(key) : null]);
      if (v === null) this.edits.delete(key);
      else this.edits.set(key, v);
      this.dirtyBuffer.set(key, v);
    }
    if (this.persistTimer === null) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        const batch = Array.from(this.dirtyBuffer.entries());
        this.dirtyBuffer = new Map();
        this.store.saveBatch(batch);
      }, 300);
    }
    return Promise.resolve({ count: list.length, previous, editCount: this.edits.size });
  }

  clear() {
    this.edits.clear();
    this.dirtyBuffer = new Map();
    return this.store.clear();
  }

  isDegraded() {
    return this.store.degraded;
  }
}

class DataClient {
  constructor() {
    this.worker = null;
    this.local = null;
    this.reqId = 0;
    this.pending = new Map();
    this.backendKind = 'worker';
    this.persistenceDegraded = false;
    this.onPersisted = null;
    this.onError = null;
  }

  init() {
    return this.tryWorker().catch(() => {
      this.backendKind = 'local';
      this.local = new LocalBackend();
      return this.local.init();
    });
  }

  tryWorker() {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker('js/worker.js');
      } catch (err) {
        reject(err);
        return;
      }
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('worker init timeout'));
      }, 5000);
      worker.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          this.worker = worker;
          resolve({ count: msg.count, degraded: msg.degraded });
          return;
        }
        if (msg.reqId !== undefined && this.pending.has(msg.reqId)) {
          const entry = this.pending.get(msg.reqId);
          this.pending.delete(msg.reqId);
          entry.resolve(msg);
          return;
        }
        if (msg.type === 'persisted') {
          this.persistenceDegraded = msg.degraded;
          if (this.onPersisted) this.onPersisted(msg);
        }
        if (msg.type === 'error' && this.onError) this.onError(msg.message);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        if (this.worker) {
          this.fallbackToLocal();
          if (this.onError) this.onError('Worker 异常，已降级为主线程数据后端');
        } else {
          reject(new Error('worker failed to start'));
        }
      };
      try {
        worker.postMessage({ type: 'init' });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  fallbackToLocal() {
    if (this.local) return;
    if (this.worker) {
      try { this.worker.terminate(); } catch (err) { /* ignore */ }
      this.worker = null;
    }
    this.backendKind = 'local';
    this.local = new LocalBackend();
    this.local.init();
    for (const entry of this.pending.values()) {
      entry.resolve({ cells: [], count: 0, previous: [], editCount: 0 });
    }
    this.pending.clear();
  }

  request(msg) {
    if (this.backendKind === 'local') {
      if (msg.type === 'getRange') {
        return this.local.getRange(msg.r0, msg.c0, msg.r1, msg.c1)
          .then((cells) => ({ type: 'range', cells }));
      }
      if (msg.type === 'applyEdits') {
        return this.local.applyEdits(msg.edits)
          .then((res) => ({ type: 'applied', count: res.count, previous: res.previous, editCount: res.editCount }));
      }
      if (msg.type === 'clear') {
        return this.local.clear().then(() => ({ type: 'cleared' }));
      }
      return Promise.resolve({});
    }
    const reqId = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(reqId, { resolve });
      try {
        this.worker.postMessage(Object.assign({ reqId }, msg));
      } catch (err) {
        this.pending.delete(reqId);
        this.fallbackToLocal();
        this.request(msg).then(resolve);
      }
    });
  }

  getRange(r0, c0, r1, c1) {
    return this.request({ type: 'getRange', r0, c0, r1, c1 })
      .then((msg) => msg.cells || []);
  }

  applyEdits(edits) {
    return this.request({ type: 'applyEdits', edits });
  }

  clear() {
    return this.request({ type: 'clear' });
  }

  isPersistenceDegraded() {
    if (this.backendKind === 'local') return this.local.isDegraded();
    return this.persistenceDegraded;
  }
}
