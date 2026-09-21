'use strict';

class GridRenderer {
  constructor(canvas, overlay, config) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.ctx = canvas.getContext('2d');
    this.octx = overlay.getContext('2d');
    this.rows = config.rows;
    this.cols = config.cols;
    this.rowHeight = config.rowHeight;
    this.colWidth = config.colWidth;
    this.headerW = config.headerWidth;
    this.headerH = config.headerHeight;
    this.getValue = config.getValue;
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.width = 0;
    this.height = 0;
    this.selection = null;
    this.lastRenderMs = 0;
  }

  resize(cssWidth, cssHeight) {
    this.width = cssWidth;
    this.height = cssHeight;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(cssWidth * this.dpr);
      c.height = Math.round(cssHeight * this.dpr);
      c.style.width = cssWidth + 'px';
      c.style.height = cssHeight + 'px';
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.octx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderFull();
  }

  colLabel(c) {
    let s = '';
    let n = c + 1;
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  setViewport(left, top) {
    const dx = left - this.scrollLeft;
    const dy = top - this.scrollTop;
    if (dx === 0 && dy === 0) return;
    this.scrollLeft = left;
    this.scrollTop = top;
    const cellW = this.width - this.headerW;
    const cellH = this.height - this.headerH;
    if (Math.abs(dx) >= cellW || Math.abs(dy) >= cellH) {
      this.renderFull();
      return;
    }
    this.blit(dx, dy, cellW, cellH);
    if (dx > 0) this.drawCellRegion(cellW - dx, 0, dx, cellH);
    else if (dx < 0) this.drawCellRegion(0, 0, -dx, cellH);
    if (dy > 0) this.drawCellRegion(0, cellH - dy, cellW, dy);
    else if (dy < 0) this.drawCellRegion(0, 0, cellW, -dy);
    this.drawHeaders();
    this.drawSelection();
  }

  blit(dx, dy, cellW, cellH) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const srcX = Math.round((this.headerW + Math.max(0, dx)) * dpr);
    const srcY = Math.round((this.headerH + Math.max(0, dy)) * dpr);
    const srcW = Math.round((cellW - Math.abs(dx)) * dpr);
    const srcH = Math.round((cellH - Math.abs(dy)) * dpr);
    if (srcW <= 0 || srcH <= 0) return;
    const dstX = this.headerW + Math.max(0, -dx);
    const dstY = this.headerH + Math.max(0, -dy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.headerW, this.headerH, cellW, cellH);
    ctx.clip();
    ctx.drawImage(this.canvas, srcX, srcY, srcW, srcH, dstX, dstY, srcW / dpr, srcH / dpr);
    ctx.restore();
  }

  renderFull() {
    const start = performance.now();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawCellRegion(0, 0, this.width - this.headerW, this.height - this.headerH);
    this.drawHeaders();
    this.drawCorner();
    this.drawSelection();
    this.lastRenderMs = performance.now() - start;
  }

  drawCellRegion(x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    const rh = this.rowHeight;
    const cw = this.colWidth;
    const r0 = Math.max(0, Math.floor((this.scrollTop + y) / rh));
    const r1 = Math.min(this.rows - 1, Math.floor((this.scrollTop + y + h - 1) / rh));
    const c0 = Math.max(0, Math.floor((this.scrollLeft + x) / cw));
    const c1 = Math.min(this.cols - 1, Math.floor((this.scrollLeft + x + w - 1) / cw));
    if (r1 < r0 || c1 < c0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(this.headerW + x, this.headerH + y, w, h);
    ctx.clip();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(this.headerW + x, this.headerH + y, w, h);

    ctx.strokeStyle = '#e2e4e9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = r0; r <= r1 + 1; r++) {
      const yy = Math.round(this.headerH + r * rh - this.scrollTop) + 0.5;
      ctx.moveTo(this.headerW + x, yy);
      ctx.lineTo(this.headerW + x + w, yy);
    }
    for (let c = c0; c <= c1 + 1; c++) {
      const xx = Math.round(this.headerW + c * cw - this.scrollLeft) + 0.5;
      ctx.moveTo(xx, this.headerH + y);
      ctx.lineTo(xx, this.headerH + y + h);
    }
    ctx.stroke();

    ctx.font = '12px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#1f2430';
    ctx.textBaseline = 'middle';
    for (let r = r0; r <= r1; r++) {
      const yy = this.headerH + r * rh - this.scrollTop;
      for (let c = c0; c <= c1; c++) {
        const value = this.getValue(r, c);
        if (value === null || value === undefined || value === '') continue;
        const xx = this.headerW + c * cw - this.scrollLeft;
        ctx.fillText(String(value), xx + 6, yy + rh / 2, cw - 10);
      }
    }
    ctx.restore();
  }

  drawHeaders() {
    const ctx = this.ctx;
    const rh = this.rowHeight;
    const cw = this.colWidth;
    const cellW = this.width - this.headerW;
    const cellH = this.height - this.headerH;

    ctx.save();
    ctx.fillStyle = '#f4f5f8';
    ctx.fillRect(this.headerW, 0, cellW, this.headerH);
    ctx.fillRect(0, this.headerH, this.headerW, cellH);
    ctx.strokeStyle = '#d3d6de';
    ctx.fillStyle = '#5a6070';
    ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';

    const c0 = Math.max(0, Math.floor(this.scrollLeft / cw));
    const c1 = Math.min(this.cols - 1, Math.floor((this.scrollLeft + cellW - 1) / cw));
    ctx.textAlign = 'center';
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      const xx = this.headerW + c * cw - this.scrollLeft;
      ctx.fillText(this.colLabel(c), xx + cw / 2, this.headerH / 2);
      ctx.moveTo(Math.round(xx) + 0.5, 0);
      ctx.lineTo(Math.round(xx) + 0.5, this.headerH);
    }
    ctx.stroke();

    const r0 = Math.max(0, Math.floor(this.scrollTop / rh));
    const r1 = Math.min(this.rows - 1, Math.floor((this.scrollTop + cellH - 1) / rh));
    ctx.textAlign = 'right';
    ctx.beginPath();
    for (let r = r0; r <= r1; r++) {
      const yy = this.headerH + r * rh - this.scrollTop;
      ctx.fillText(String(r + 1), this.headerW - 8, yy + rh / 2);
      ctx.moveTo(0, Math.round(yy) + 0.5);
      ctx.lineTo(this.headerW, Math.round(yy) + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = '#c3c7d1';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(this.headerH) + 0.5);
    ctx.lineTo(this.width, Math.round(this.headerH) + 0.5);
    ctx.moveTo(Math.round(this.headerW) + 0.5, 0);
    ctx.lineTo(Math.round(this.headerW) + 0.5, this.height);
    ctx.stroke();
    ctx.restore();
  }

  drawCorner() {
    const ctx = this.ctx;
    ctx.fillStyle = '#eceef3';
    ctx.fillRect(0, 0, this.headerW, this.headerH);
  }

  setSelection(sel) {
    this.selection = sel;
    this.drawSelection();
  }

  drawSelection() {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.selection) return;
    const { r, c } = this.selection;
    const x = this.headerW + c * this.colWidth - this.scrollLeft;
    const y = this.headerH + r * this.rowHeight - this.scrollTop;
    if (x + this.colWidth < this.headerW || y + this.rowHeight < this.headerH) return;
    if (x > this.width || y > this.height) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.headerW, this.headerH, this.width - this.headerW, this.height - this.headerH);
    ctx.clip();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, this.colWidth - 2, this.rowHeight - 2);
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fillRect(x + 1, y + 1, this.colWidth - 2, this.rowHeight - 2);
    ctx.restore();
  }

  cellToPixel(r, c) {
    return {
      x: this.headerW + c * this.colWidth - this.scrollLeft,
      y: this.headerH + r * this.rowHeight - this.scrollTop,
    };
  }

  pixelToCell(px, py) {
    const c = Math.floor((this.scrollLeft + px - this.headerW) / this.colWidth);
    const r = Math.floor((this.scrollTop + py - this.headerH) / this.rowHeight);
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    return { r, c };
  }
}
