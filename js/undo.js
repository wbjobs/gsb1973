'use strict';

class UndoStack {
  constructor(limit) {
    this.limit = limit || 200;
    this.undoList = [];
    this.redoList = [];
    this.onChange = null;
  }

  push(command) {
    this.undoList.push(command);
    if (this.undoList.length > this.limit) this.undoList.shift();
    this.redoList.length = 0;
    this.notify();
  }

  canUndo() {
    return this.undoList.length > 0;
  }

  canRedo() {
    return this.redoList.length > 0;
  }

  undo() {
    const command = this.undoList.pop();
    if (!command) return Promise.resolve(false);
    return Promise.resolve(command.undo()).then(() => {
      this.redoList.push(command);
      this.notify();
      return true;
    });
  }

  redo() {
    const command = this.redoList.pop();
    if (!command) return Promise.resolve(false);
    return Promise.resolve(command.redo()).then(() => {
      this.undoList.push(command);
      this.notify();
      return true;
    });
  }

  clear() {
    this.undoList.length = 0;
    this.redoList.length = 0;
    this.notify();
  }

  notify() {
    if (this.onChange) this.onChange(this);
  }
}
