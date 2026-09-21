'use strict';
importScripts('store.js');

const edits = new Map();
const store = new GridStore();
let persistTimer = null;
let dirtyBuffer = new Map();

function keyOf(r, c) {
  return r + ',' + c;
}

function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersist();
  }, 300);
}

function flushPersist() {
  if (dirtyBuffer.size === 0) return;
  const batch = Array.from(dirtyBuffer.entries());
  dirtyBuffer = new Map();
  store.saveBatch(batch).then((persisted) => {
    self.postMessage({ type: 'persisted', count: batch.length, degraded: store.degraded, persisted });
  });
}

function applyEdits(list) {
  const previous = [];
  for (const [r, c, v] of list) {
    const key = keyOf(r, c);
    previous.push([r, c, edits.has(key) ? edits.get(key) : null]);
    if (v === null) edits.delete(key);
    else edits.set(key, v);
    dirtyBuffer.set(key, v);
  }
  schedulePersist();
  return previous;
}

self.onmessage = (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        store.open().then(() => store.loadAll()).then((entries) => {
          for (const [key, value] of entries) edits.set(key, value);
          self.postMessage({ type: 'ready', count: edits.size, degraded: store.degraded });
        });
        break;
      }
      case 'getRange': {
        const cells = [];
        for (const [key, value] of edits) {
          const comma = key.indexOf(',');
          const r = +key.slice(0, comma);
          const c = +key.slice(comma + 1);
          if (r >= msg.r0 && r <= msg.r1 && c >= msg.c0 && c <= msg.c1) {
            cells.push([r, c, value]);
          }
        }
        self.postMessage({ type: 'range', reqId: msg.reqId, cells });
        break;
      }
      case 'applyEdits': {
        const previous = applyEdits(msg.edits);
        self.postMessage({
          type: 'applied',
          reqId: msg.reqId,
          count: msg.edits.length,
          previous,
          editCount: edits.size,
        });
        break;
      }
      case 'clear': {
        edits.clear();
        dirtyBuffer = new Map();
        store.clear().then(() => {
          self.postMessage({ type: 'cleared', reqId: msg.reqId, degraded: store.degraded });
        });
        break;
      }
      case 'flush': {
        flushPersist();
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
