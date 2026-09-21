# Mega Grid — 百万单元格表格

Canvas + Web Worker + IndexedDB 实现的 1000 x 1000（1,000,000 单元格）表格，
支持增量渲染、单元格编辑、撤销/重做、持久化与异常降级。

## 运行

```bash
cd A
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

注意：需要通过 HTTP 访问（Web Worker 在 `file://` 下会被浏览器拦截；
若 Worker 确实不可用，应用会自动降级为主线程后端，功能不受影响）。

## 操作

- 滚动：原生滚动条 / 滚轮 / PageUp / PageDown
- 选中：单击；方向键移动
- 编辑：双击 / Enter / F2 / 直接输入；Enter 提交、Tab 提交并右移、Esc 取消
- 清除：Delete / Backspace（可撤销）
- 撤销/重做：Ctrl+Z / Ctrl+Shift+Z（或 Ctrl+Y），或工具栏按钮
- 压力测试：一键写入 10,000 条随机编辑（作为单次可撤销事务）
- 刷新页面后编辑数据从 IndexedDB 恢复

## 架构

| 模块 | 职责 |
| --- | --- |
| `js/renderer.js` | Canvas 渲染。滚动时位图平移（drawImage 自拷贝）+ 只补绘暴露条带；选中框在独立 overlay 层 |
| `js/worker.js` | Web Worker 内的数据后端：稀疏编辑表、范围查询、批量写入 IndexedDB（300ms 防抖） |
| `js/provider.js` | 主线程数据客户端。Worker 启动失败/崩溃时自动切换到主线程 `LocalBackend`，接口不变 |
| `js/store.js` | IndexedDB 封装。打开/读写失败时降级为内存存储并标记 `degraded` |
| `js/undo.js` | 命令模式撤销栈（容量 200），每条命令携带正/逆操作 |
| `js/editor.js` | 单元格编辑覆盖层（绝对定位 input） |
| `js/main.js` | 编排：虚拟滚动、可视区数据预取、选择/键盘、状态栏、压力测试 |

## 关键设计

- **百万单元格不崩**：默认值按需计算（`r * cols + c`），不落内存；只有用户编辑过的
  单元格进入稀疏 Map 与 IndexedDB。内存占用与"编辑数"成正比，与总单元格数无关。
- **增量渲染**：滚动仅平移已有位图并补绘新暴露的行/列条带；编辑只触发一次可视区重绘
  （可视区约几百个单元格，单次渲染 < 5ms）；渲染在 `requestAnimationFrame` 中合帧。
- **撤销正确性**：`applyEdits` 由数据层返回每个单元格的**修改前的值**（含"原本无覆盖"的
  null），撤销命令据此恢复，多次编辑/撤销/重做交错也能精确还原。
- **异常降级**：Worker 不可用 → 主线程后端；IndexedDB 不可用/超限 → 内存存储；
  全局 `error` / `unhandledrejection` 兜底，状态栏实时显示后端与持久化状态。
