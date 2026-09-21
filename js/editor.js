'use strict';

class CellEditor {
  constructor(container) {
    this.container = container;
    this.input = document.createElement('input');
    this.input.className = 'cell-editor';
    this.input.style.display = 'none';
    container.appendChild(this.input);
    this.active = null;
    this.onCommit = null;
    this.onCancel = null;

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancel();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        this.commit('tab');
      }
    });
    this.input.addEventListener('blur', () => {
      if (this.active) this.commit();
    });
  }

  open(r, c, rect, initialValue) {
    this.active = { r, c };
    const input = this.input;
    input.style.display = 'block';
    input.style.left = rect.x + 'px';
    input.style.top = rect.y + 'px';
    input.style.width = rect.w + 'px';
    input.style.height = rect.h + 'px';
    input.value = initialValue === null || initialValue === undefined ? '' : String(initialValue);
    input.focus();
    input.select();
  }

  commit(reason) {
    if (!this.active) return;
    const cell = this.active;
    const value = this.input.value;
    this.close();
    if (this.onCommit) this.onCommit(cell.r, cell.c, value, reason);
  }

  cancel() {
    if (!this.active) return;
    this.close();
    if (this.onCancel) this.onCancel();
  }

  close() {
    this.active = null;
    this.input.style.display = 'none';
    this.input.value = '';
  }

  isEditing() {
    return this.active !== null;
  }
}
