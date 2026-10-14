// 移植自 linux.do IM 版的功能层样式：低质内容折叠行、配置弹窗、关键词高亮、列表头布局
export const CSS_XHH_FEATURES = `
/* ============ 低质内容（水贴）折叠行 ============ */
.__ROOT_CLASS__ .im-msg-spam-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px auto;
  max-width: 90%;
  padding: 5px 12px;
  border-radius: 16px;
  background: var(--im-hover);
  border: 1px dashed var(--im-border);
  color: var(--im-text-3);
  font-size: 12px;
  line-height: 1.4;
  user-select: none;
  box-sizing: border-box;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.__ROOT_CLASS__ .im-msg-spam-row:hover {
  background: var(--im-bg-2, var(--im-hover));
  border-color: var(--im-border-2, var(--im-border));
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 500;
  color: var(--im-text-3);
  flex-shrink: 0;
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-tag svg {
  width: 14px;
  height: 14px;
  opacity: 0.8;
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-author {
  font-weight: 500;
  color: var(--im-text-2);
  flex-shrink: 0;
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
  opacity: 0.85;
  font-style: italic;
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-expand-btn {
  flex-shrink: 0;
  border: 1px solid var(--im-border);
  background: var(--im-bg);
  color: var(--im-accent);
  border-radius: 10px;
  padding: 1px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: var(--im-font);
  transition: all 0.15s ease;
}
.__ROOT_CLASS__ .im-msg-spam-row .im-spam-expand-btn:hover {
  background: var(--im-accent-soft);
  border-color: var(--im-accent);
}
/* 详情抽屉里的评论折叠行更紧凑 */
.__ROOT_CLASS__ .im-detail-body .im-msg-spam-row { margin-left: 36px; max-width: calc(100% - 48px); }

/* ============ 通用模态弹窗（低质内容过滤 / 关键词高亮） ============ */
.im-modal-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 100000 !important;
  background: rgba(0, 0, 0, 0.45) !important;
  backdrop-filter: blur(2px) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-family: var(--im-font) !important;
}
.im-spam-dialog {
  width: min(620px, 92vw);
  max-height: 86vh;
  background: var(--im-bg);
  color: var(--im-text);
  border: 1px solid var(--im-border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: im-dialog-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes im-dialog-in {
  from { opacity: 0; transform: scale(0.96) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.im-spam-dialog .im-modal-header {
  padding: 16px 20px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--im-border);
  flex-shrink: 0;
}
.im-spam-dialog .im-modal-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.im-spam-dialog .im-modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--im-text-3);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.im-spam-dialog .im-modal-close:hover {
  background: var(--im-hover);
  color: var(--im-text);
}
.im-spam-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.im-spam-sec {
  background: var(--im-hover);
  border-radius: 10px;
  padding: 12px 16px;
  border: 1px solid var(--im-border);
}
.im-spam-main-switch {
  background: var(--im-accent-soft);
  border-color: transparent;
}
.im-spam-sec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--im-text);
  margin-bottom: 12px;
}
.im-spam-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.im-spam-label-group { display: flex; flex-direction: column; gap: 2px; }
.im-spam-label-title { font-size: 14px; font-weight: 600; color: var(--im-text); }
.im-spam-label-desc { font-size: 12px; color: var(--im-text-3); }
.im-spam-label { color: var(--im-text-2); white-space: nowrap; }
.im-spam-unit { color: var(--im-text-3); font-size: 12px; }
.im-spam-dialog-icon { font-size: 16px; }

/* Switch */
.im-switch { position: relative; display: inline-block; width: 38px; height: 20px; flex-shrink: 0; }
.im-switch input { opacity: 0; width: 0; height: 0; }
.im-switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: var(--im-border-strong, #ccc);
  transition: .25s;
  border-radius: 20px;
}
.im-switch-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: #fff;
  transition: .25s;
  border-radius: 50%;
}
.im-switch input:checked + .im-switch-slider { background-color: var(--im-accent); }
.im-switch input:checked + .im-switch-slider:before { transform: translateX(18px); }

/* 输入 */
.im-number-input {
  width: 64px;
  height: 28px;
  border: 1px solid var(--im-border);
  border-radius: 6px;
  padding: 0 6px;
  background: var(--im-bg);
  color: var(--im-text);
  font-size: 13px;
  text-align: center;
  outline: none;
}
.im-number-input:focus { border-color: var(--im-accent); }
.im-radio-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  color: var(--im-text-2);
}
.im-radio-label input { accent-color: var(--im-accent); }

/* 关键词胶囊 */
.im-spam-tags-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--im-text-3);
  margin-bottom: 6px;
}
.im-spam-tags-container {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--im-border);
  border-radius: 8px;
  background: var(--im-bg);
  min-height: 52px;
  max-height: 140px;
  overflow-y: auto;
}
.im-spam-tags-empty { font-size: 12px; color: var(--im-text-3); }
.im-spam-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--im-accent-soft);
  color: var(--im-accent);
  font-size: 12px;
  line-height: 1.4;
}
.im-spam-tag-del {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  margin: 0;
  font-size: 13px;
  opacity: 0.6;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.im-spam-tag-del:hover { opacity: 1; background: rgba(0, 0, 0, 0.1); }
.im-spam-tag-add-row { display: flex; gap: 8px; margin-top: 8px; }
.im-spam-input {
  flex: 1;
  height: 32px;
  border: 1px solid var(--im-border);
  border-radius: 6px;
  padding: 0 10px;
  background: var(--im-bg);
  color: var(--im-text);
  font-size: 13px;
  outline: none;
  font-family: var(--im-font);
}
.im-spam-input:focus { border-color: var(--im-accent); }

/* 弹窗底部 */
.im-spam-dialog .im-modal-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--im-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.im-spam-dialog .im-modal-actions { display: flex; gap: 10px; }
.im-spam-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-family: var(--im-font);
  border: 1px solid var(--im-border);
  background: var(--im-bg);
  color: var(--im-text);
  transition: all 0.15s ease;
}
.im-spam-btn:hover { background: var(--im-hover); }
.im-spam-add-btn,
.im-spam-btn-save {
  background: var(--im-accent);
  color: #fff;
  border-color: var(--im-accent);
}
.im-spam-btn-save { font-weight: 500; }
.im-spam-add-btn:hover,
.im-spam-btn-save:hover { filter: brightness(1.06); }
.im-spam-btn-reset {
  color: var(--im-danger, #e53e3e);
  border-color: transparent;
  background: transparent;
}
.im-spam-btn-reset:hover { background: rgba(229, 62, 62, 0.08); }

/* ============ 关键词常驻高亮 ============ */
/* 搜索历史：单条删除 × / 一键清空 */
.__ROOT_CLASS__ .im-search-group-recent {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.__ROOT_CLASS__ .im-search-clear-recent {
  border: 0;
  background: transparent;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--im-text-3);
  cursor: pointer;
  font-family: var(--im-font);
  transition: background 0.15s ease, color 0.15s ease;
}
.__ROOT_CLASS__ .im-search-clear-recent:hover {
  background: var(--im-hover);
  color: var(--im-danger, #e53e3e);
}
.__ROOT_CLASS__ .im-search-remove {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 1;
  color: var(--im-text-3);
  opacity: 0.45;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.__ROOT_CLASS__ .im-search-item:hover .im-search-remove { opacity: 1; background: var(--im-hover); }
.__ROOT_CLASS__ .im-search-remove:hover {
  background: var(--im-hover);
  color: var(--im-danger, #e53e3e);
}
/* 触屏没有 hover：删除按钮常驻 */
@media (hover: none) {
  .__ROOT_CLASS__ .im-search-remove { opacity: 1; }
}

/* 搜索弹层必须盖在 IM 三栏（z-index 8000+）之上 */
.__ROOT_CLASS__ .im-search-pop-overlay,
.im-search-pop-overlay { z-index: 100000 !important; }
.__ROOT_CLASS__ body .im-search-pop-overlay,
html.im-theme .im-search-pop-overlay { z-index: 100000 !important; }

.__ROOT_CLASS__ .im-list-hl {
  background: rgba(255, 204, 0, 0.42) !important;
  color: inherit !important;
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 600;
  box-shadow: 0 0 0 1px rgba(255, 180, 0, 0.28);
}
.__ROOT_CLASS__.__DARK_CLASS__ .im-list-hl {
  background: rgba(255, 214, 102, 0.22) !important;
  color: #FFE58F !important;
  box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.3);
}

/* ============ 列表头左右布局（对齐 linux.do IM） ============ */
.__ROOT_CLASS__ .im-list-head-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.__ROOT_CLASS__ .im-list-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.__ROOT_CLASS__ .im-list-chip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--im-text-2);
  cursor: pointer;
  flex-shrink: 0;
}
.__ROOT_CLASS__ .im-list-chip-icon:hover { background: var(--im-hover); color: var(--im-text); }
.__ROOT_CLASS__ .im-list-chip-icon svg { width: 18px; height: 18px; }
/* rail 团队图标支持图片/emoji */
.__ROOT_CLASS__ .im-rail-org-logo img { width: 100%; height: 100%; object-fit: cover; border-radius: 4px; }
/* 搜索弹层里的方形话题头像 */
.__ROOT_CLASS__ .im-search-item .ava.is-square { border-radius: 6px; }
`;
