'use strict';

const CONFIG = {
  rows: 1000,
  cols: 1000,
  rowHeight: 28,
  colWidth: 100,
  headerWidth: 56,
  headerHeight: 28,
};

const viewport = document.getElementById('viewport');
const scroller = document.getElementById('scroller');
const sizer = document.getElementById('sizer');
const canvas = document.getElementById('grid');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnStress = document.getElementById('btn-stress');
const btnClear = document.getElementById('btn-clear');

const client = new DataClient();
const undoStack = new UndoStack(200);
const editor = new CellEditor(viewport);

const cellCache = new Map();
let selection = { r: 0, c: 0 };
let editCount = 0;
let lastRangeKey = '';
let scrollRaf = 0;
let statusMessage = '';

function defaultValue(r, c) {
  return r * CONFIG.cols + c;
}

function cacheKey(r, c) {
  return r + ',' + c;
}

function getValue(r, c) {
  const key = cacheKey(r, c);
  return cellCache.has(key) ? cellCache.get(key) : defaultValue(r, c);
}

const renderer = new GridRenderer(canvas, overlay, {
  rows: CONFIG.rows,
  cols: CONFIG.cols,
  rowHeight: CONFIG.rowHeight,
  colWidth: CONFIG.colWidth,
  headerWidth: CONFIG.headerWidth,
  headerHeight: CONFIG.headerHeight,
  getValue,
});

function totalWidth() {
  return CONFIG.headerWidth + CONFIG.cols * CONFIG.colWidth;
}

function totalHeight() {
  return CONFIG.headerHeight + CONFIG.rows * CONFIG.rowHeight;
}

function setStatus(extra) {
  const backend = client.backendKind === 'worker' ? 'Worker' : '主线程(降级)';
  const persist = client.isPersistenceDegraded() ? '内存(降级)' : 'IndexedDB';
  const parts = [
    `后端: ${backend}`,
    `持久化: ${persist}`,
    `编辑数: ${editCount}`,
    `渲染: ${renderer.lastRenderMs.toFixed(1)}ms`,
    `选中: ${renderer.colLabel(selection.c)}${selection.r + 1}`,
  ];
  if (extra) parts.push(extra);
  statusEl.textContent = parts.join(' | ');
}

function visibleRange(margin) {
  const m = margin || 5;
  const r0 = Math.max(0, Math.floor(scroller.scrollTop / CONFIG.rowHeight) - m);
  const c0 = Math.max(0, Math.floor(scroller.scrollLeft / CONFIG.colWidth) - m);
  const r1 = Math.min(CONFIG.rows - 1,
    Math.floor((scroller.scrollTop + viewport.clientHeight) / CONFIG.rowHeight) + m);
  const c1 = Math.min(CONFIG.cols - 1,
    Math.floor((scroller.scrollLeft + viewport.clientWidth) / CONFIG.colWidth) + m);
  return { r0, c0, r1, c1 };
}

function prefetch() {
  const { r0, c0, r1, c1 } = visibleRange(5);
  const key = `${r0}:${c0}:${r1}:${c1}`;
  if (key === lastRangeKey) return;
  lastRangeKey = key;
  const reqKey = key;
  client.getRange(r0, c0, r1, c1).then((cells) => {
    if (reqKey !== lastRangeKey) return;
    let changed = false;
    for (const [r, c, v] of cells) {
      const k = cacheKey(r, c);
      if (cellCache.get(k) !== v) {
        cellCache.set(k, v);
        changed = true;
      }
    }
    if (changed) renderer.renderFull();
    setStatus();
  }).catch(() => setStatus('数据拉取失败(已忽略)'));
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    renderer.setViewport(scroller.scrollLeft, scroller.scrollTop);
    prefetch();
    setStatus();
  });
}

function scrollCellIntoView(r, c) {
  const x = c * CONFIG.colWidth;
  const y = r * CONFIG.rowHeight;
  const viewW = viewport.clientWidth - CONFIG.headerWidth;
  const viewH = viewport.clientHeight - CONFIG.headerHeight;
  if (x < scroller.scrollLeft) scroller.scrollLeft = x;
  else if (x + CONFIG.colWidth > scroller.scrollLeft + viewW) {
    scroller.scrollLeft = x + CONFIG.colWidth - viewW;
  }
  if (y < scroller.scrollTop) scroller.scrollTop = y;
  else if (y + CONFIG.rowHeight > scroller.scrollTop + viewH) {
    scroller.scrollTop = y + CONFIG.rowHeight - viewH;
  }
}

function moveSelection(dr, dc) {
  selection = {
    r: Math.max(0, Math.min(CONFIG.rows - 1, selection.r + dr)),
    c: Math.max(0, Math.min(CONFIG.cols - 1, selection.c + dc)),
  };
  scrollCellIntoView(selection.r, selection.c);
  renderer.setSelection(selection);
  setStatus();
}

function applyRaw(edits) {
  return client.applyEdits(edits).then((res) => {
    for (const [r, c, v] of edits) {
      const key = cacheKey(r, c);
      if (v === null) cellCache.delete(key);
      else cellCache.set(key, v);
    }
    if (typeof res.editCount === 'number') editCount = res.editCount;
    renderer.renderFull();
    setStatus();
  });
}

function applyBatch(edits, label) {
  return client.applyEdits(edits).then((res) => {
    const inverse = res.previous && res.previous.length === edits.length
      ? res.previous
      : edits.map(([r, c]) => [r, c, null]);
    for (const [r, c, v] of edits) {
      const key = cacheKey(r, c);
      if (v === null) cellCache.delete(key);
      else cellCache.set(key, v);
    }
    if (typeof res.editCount === 'number') editCount = res.editCount;
    undoStack.push({
      label,
      undo: () => applyRaw(inverse),
      redo: () => applyRaw(edits),
    });
    renderer.renderFull();
    setStatus();
  }).catch((err) => setStatus('编辑失败: ' + err.message));
}

function commitEdit(r, c, value) {
  const trimmed = value.trim();
  const current = getValue(r, c);
  const newValue = trimmed === '' ? null : trimmed;
  if (newValue === null && !cellCache.has(cacheKey(r, c))) return;
  if (newValue !== null && String(current) === newValue) return;
  applyBatch([[r, c, newValue]], '编辑 ' + renderer.colLabel(c) + (r + 1));
}

function openEditor(initialChar) {
  const { r, c } = selection;
  const pos = renderer.cellToPixel(r, c);
  const current = cellCache.has(cacheKey(r, c)) ? cellCache.get(cacheKey(r, c)) : '';
  editor.open(r, c, {
    x: pos.x,
    y: pos.y,
    w: CONFIG.colWidth,
    h: CONFIG.rowHeight,
  }, initialChar !== undefined ? initialChar : current);
}

editor.onCommit = (r, c, value, reason) => {
  commitEdit(r, c, value);
  if (reason === 'tab') moveSelection(0, 1);
  else moveSelection(1, 0);
  canvas.focus();
};

function handleKeydown(event) {
  if (editor.isEditing()) return;
  const key = event.key;
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) undoStack.redo();
    else undoStack.undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') {
    event.preventDefault();
    undoStack.redo();
    return;
  }
  switch (key) {
    case 'ArrowUp': event.preventDefault(); moveSelection(-1, 0); return;
    case 'ArrowDown': event.preventDefault(); moveSelection(1, 0); return;
    case 'ArrowLeft': event.preventDefault(); moveSelection(0, -1); return;
    case 'ArrowRight': event.preventDefault(); moveSelection(0, 1); return;
    case 'PageDown':
      event.preventDefault();
      scroller.scrollTop += viewport.clientHeight - CONFIG.headerHeight;
      return;
    case 'PageUp':
      event.preventDefault();
      scroller.scrollTop -= viewport.clientHeight - CONFIG.headerHeight;
      return;
    case 'Enter':
    case 'F2':
      event.preventDefault();
      openEditor();
      return;
    case 'Delete':
    case 'Backspace': {
      event.preventDefault();
      const { r, c } = selection;
      if (cellCache.has(cacheKey(r, c))) applyBatch([[r, c, null]], '清除');
      return;
    }
    default:
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openEditor(key);
      }
  }
}

function cellFromEvent(event) {
  const rect = viewport.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  if (px < CONFIG.headerWidth || py < CONFIG.headerHeight) return null;
  return renderer.pixelToCell(px, py);
}

scroller.addEventListener('scroll', onScroll, { passive: true });

scroller.addEventListener('mousedown', (event) => {
  const cell = cellFromEvent(event);
  if (!cell) return;
  selection = cell;
  renderer.setSelection(selection);
  setStatus();
});

scroller.addEventListener('dblclick', (event) => {
  const cell = cellFromEvent(event);
  if (!cell) return;
  selection = cell;
  renderer.setSelection(selection);
  openEditor();
});

window.addEventListener('keydown', handleKeydown);

window.addEventListener('error', (event) => {
  setStatus('异常: ' + (event.message || '未知错误'));
});

window.addEventListener('unhandledrejection', (event) => {
  setStatus('异步异常: ' + (event.reason && event.reason.message ? event.reason.message : '未知'));
});

undoStack.onChange = () => {
  btnUndo.disabled = !undoStack.canUndo();
  btnRedo.disabled = !undoStack.canRedo();
};

btnUndo.addEventListener('click', () => undoStack.undo());
btnRedo.addEventListener('click', () => undoStack.redo());

btnStress.addEventListener('click', () => {
  const n = 10000;
  const edits = [];
  const seen = new Set();
  while (edits.length < n) {
    const r = Math.floor(Math.random() * CONFIG.rows);
    const c = Math.floor(Math.random() * CONFIG.cols);
    const key = cacheKey(r, c);
    if (seen.has(key)) continue;
    seen.add(key);
    edits.push([r, c, 'T' + Math.floor(Math.random() * 1e6)]);
  }
  const start = performance.now();
  applyBatch(edits, `压力测试 ${n} 条`).then(() => {
    setStatus(`压力测试: ${n} 条编辑(单次撤销) 耗时 ${(performance.now() - start).toFixed(0)}ms`);
  });
});

btnClear.addEventListener('click', () => {
  if (!window.confirm('清空全部编辑数据?')) return;
  client.clear().then(() => {
    cellCache.clear();
    editCount = 0;
    undoStack.clear();
    renderer.renderFull();
    setStatus('已清空');
  });
});

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.resize(w, h);
  prefetch();
  setStatus();
}

new ResizeObserver(resize).observe(viewport);

function boot() {
  sizer.style.width = totalWidth() + 'px';
  sizer.style.height = totalHeight() + 'px';
  setStatus('初始化中...');
  client.init().then((info) => {
    editCount = info.count || 0;
    if (client.backendKind === 'local') {
      statusMessage = 'Worker 不可用，已降级';
    }
    resize();
    renderer.setSelection(selection);
    prefetch();
    setStatus(statusMessage || undefined);
  }).catch((err) => {
    setStatus('初始化失败: ' + err.message);
    resize();
  });
}

boot();
