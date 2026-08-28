/**
 * 客户端半边的一次性样式注入：所有 kb- / kkb- 前缀的 class 汇总在单个 <style> 里。
 * 颜色全部走主题变量（--dsw-alias-*，见 harness 的 ui-theme），深浅色自动适配；
 * 本插件自己的设计 token 定义在 :root（--kb-*：圆角/间距/字阶/动效/状态色）。
 * @module dsh-kanban/client/styles
 */

import { NAMESPACE } from './constants.ts'

declare const document: {
  createElement(tag: 'style'): { dataset: Record<string, string>; textContent: string }
  head: { appendChild(node: { dataset: Record<string, string>; textContent: string }): void }
}

let stylesInjected = false

/** 注入 <style data-plugin data-plugin-css>；client-modules 的 claimStyles 据此回收。 */
export function injectStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  stylesInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = NAMESPACE
  tag.dataset.pluginCss = `${NAMESPACE}/ui`
  tag.textContent = `
/* ==================== 设计 token（全部 UI 面共用） ==================== */
/* 注意：--dsw-alias-* 由 harness 定义在 body 上（非 :root），引用它们的 token
 * 必须也在 body 层定义，否则在 :root 上解析为「保证无效值」，导致颜色全失效。 */
:root, body {
  /* 圆角 */
  --kb-radius-sm: 6px; --kb-radius-md: 8px; --kb-radius-lg: 12px;
  --kb-radius-xl: 16px; --kb-radius-pill: 999px;
  /* 间距 */
  --kb-space-1: 4px; --kb-space-2: 8px; --kb-space-3: 12px; --kb-space-4: 16px; --kb-space-5: 24px;
  /* 字阶（正文字号下限 12px） */
  --kb-font-xs: 12px; --kb-font-sm: 13px; --kb-font-md: 14px;
  --kb-font-lg: 16px; --kb-font-xl: 18px; --kb-line: 1.5;
  /* 动效（150-300ms 区间） */
  --kb-ease: cubic-bezier(.2, .8, .2, 1);
  --kb-transition: 180ms var(--kb-ease); --kb-transition-slow: 260ms var(--kb-ease);
  /* 阴影 */
  --kb-shadow-sm: 0 1px 2px rgba(0, 0, 0, .08); --kb-shadow-lg: 0 18px 60px rgba(0, 0, 0, .28);
  /* 语义色 → 宿主主题变量 */
  --kb-bg: var(--dsw-alias-bg-layer-1); --kb-surface: var(--dsw-alias-bg-layer-2);
  --kb-surface-raised: var(--dsw-alias-bg-layer-3); --kb-border: var(--dsw-alias-border-l2);
  --kb-text: var(--dsw-alias-label-primary); --kb-text-sec: var(--dsw-alias-label-secondary);
  --kb-text-ter: var(--dsw-alias-label-tertiary); --kb-text-dim: var(--dsw-alias-label-dimmed);
  --kb-primary: var(--dsw-alias-brand-primary); --kb-danger: var(--dsw-alias-state-error-primary);
  --kb-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
  /* 状态类目色（区分 todo 与 in-progress） */
  --kb-cat-todo: var(--dsw-alias-label-tertiary); --kb-cat-progress: var(--dsw-alias-warning);
  --kb-cat-done: var(--dsw-alias-success); --kb-cat-unknown: var(--dsw-alias-label-tertiary);
  /* 层级 */
  --kb-z-app: 9999; --kb-z-panel: 9001; --kb-z-modal: 10000; --kb-z-toast: 10001; --kb-z-lightbox: 10002;
}

/* ==================== 动画 ==================== */
@keyframes kb-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
@keyframes kb-spin { to { transform: rotate(360deg) } }
@keyframes kb-fade-in { from { opacity: 0 } }
@keyframes kb-modal-in { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes kb-toast-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes kb-panel-in { from { opacity: 0; transform: translateX(12px) } to { opacity: 1; transform: none } }
.kb-spin { animation: kb-spin 1s linear infinite; }

/* ==================== 共享控件（kb-*，看板应用与聊天 toolview 复用） ==================== */
.kb-btn {
  appearance: none; border: 1px solid var(--kb-border); background: var(--kb-surface);
  padding: 6px 12px; border-radius: var(--kb-radius-md); font: inherit; font-size: var(--kb-font-sm);
  cursor: pointer; color: var(--kb-text); display: inline-flex; align-items: center; gap: 6px;
  transition: background var(--kb-transition), border-color var(--kb-transition), color var(--kb-transition),
    box-shadow var(--kb-transition), transform var(--kb-transition);
}
.kb-btn:hover:not(:disabled) { border-color: var(--kb-text-dim); background: var(--kb-surface-raised); box-shadow: var(--kb-shadow-sm); }
.kb-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
.kb-btn:disabled { opacity: .45; cursor: default; }
.kb-btn--ghost { background: none; box-shadow: none; }
.kb-btn--ghost:hover:not(:disabled) { background: var(--kb-surface); box-shadow: none; }
/* 主操作：品牌色渐变 + 品牌投影,悬停上浮,按压回落 */
.kb-btn--primary {
  background: var(--kb-primary);
  background: linear-gradient(180deg, color-mix(in srgb, var(--kb-primary) 90%, #fff) 0%, var(--kb-primary) 100%);
  color: var(--dsw-alias-bg-layer-3); border-color: transparent;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18), 0 2px 8px color-mix(in srgb, var(--kb-primary) 35%, transparent);
}
.kb-btn--primary:hover:not(:disabled) {
  /* 悬停保持常态外观（仅重新声明背景，覆盖基础 hover 的 surface-raised） */
  background: var(--kb-primary);
  background: linear-gradient(180deg, color-mix(in srgb, var(--kb-primary) 90%, #fff) 0%, var(--kb-primary) 100%);
}
.kb-btn--primary:active:not(:disabled) {
  transform: translateY(0);
  background: var(--kb-primary);
  background: linear-gradient(180deg, color-mix(in srgb, var(--kb-primary) 90%, #fff) 0%, var(--kb-primary) 100%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
}
.kb-btn--danger { border-color: var(--kb-danger); color: var(--kb-danger); background: none; }
.kb-btn--danger:hover:not(:disabled) {
  background: var(--kb-danger); color: var(--dsw-alias-bg-layer-3); border-color: var(--kb-danger);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--kb-danger) 35%, transparent);
}
.kb-btn--sm { padding: 3px 9px; font-size: var(--kb-font-xs); border-radius: var(--kb-radius-sm); }

.kb-iconbtn {
  appearance: none; border: 1px solid var(--kb-border); background: none; color: var(--kb-text-sec);
  width: 28px; height: 28px; border-radius: var(--kb-radius-md); padding: 0; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  transition: background var(--kb-transition), border-color var(--kb-transition), color var(--kb-transition), transform var(--kb-transition);
}
.kb-iconbtn:hover:not(:disabled) { background: var(--kb-surface-raised); color: var(--kb-text); border-color: var(--kb-text-dim); }
.kb-iconbtn:active:not(:disabled) { transform: scale(.94); }
.kb-iconbtn:disabled { opacity: .45; cursor: default; }
.kb-iconbtn--ghost { border-color: transparent; }

.kb-select {
  appearance: none; border: 1px solid var(--kb-border); background: var(--kb-surface);
  padding: 5px 26px 5px 10px; border-radius: var(--kb-radius-md); font: inherit; font-size: var(--kb-font-sm);
  color: var(--kb-text); cursor: pointer; max-width: 100%;
  transition: border-color var(--kb-transition);
}
.kb-select:hover { border-color: var(--kb-text-dim); }
.kb-select-wrap { position: relative; display: inline-flex; align-items: center; min-width: 0; }
.kb-select-wrap .kb-select { width: 100%; }
.kb-select-wrap__chevron { position: absolute; right: 8px; pointer-events: none; color: var(--kb-text-ter); display: inline-flex; }

.kb-input {
  box-sizing: border-box; width: 100%; border: 1px solid var(--kb-border); background: var(--kb-surface);
  padding: 7px 10px; border-radius: var(--kb-radius-md); font: inherit; font-size: var(--kb-font-sm); color: var(--kb-text);
  transition: border-color var(--kb-transition), box-shadow var(--kb-transition);
}
.kb-input::placeholder { color: var(--kb-text-ter); }
.kb-input--error { border-color: var(--kb-danger); }
textarea.kb-input { resize: vertical; min-height: 56px; }

.kb-search { position: relative; display: flex; align-items: center; min-width: 0; }
.kb-search__icon { position: absolute; left: 9px; pointer-events: none; color: var(--kb-text-ter); display: inline-flex; }
.kb-search .kb-input { padding-left: 30px; padding-right: 28px; }
.kb-search__clear { position: absolute; right: 4px; }

.kb-seg { display: inline-flex; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); overflow: hidden; background: var(--kb-surface); }
.kb-seg button {
  appearance: none; border: 0; background: none; padding: 5px 12px; font: inherit; font-size: var(--kb-font-sm);
  cursor: pointer; color: var(--kb-text-sec); transition: background var(--kb-transition), color var(--kb-transition);
}
.kb-seg button:hover { color: var(--kb-text); background: var(--kb-surface-raised); }
.kb-seg button.kb-seg__on { background: var(--kb-primary); color: var(--dsw-alias-bg-layer-3); }
.kb-seg button.kb-seg__on:hover { background: var(--kb-primary); }

.kb-tag {
  display: inline-flex; align-items: center; gap: 4px; border-radius: var(--kb-radius-pill);
  padding: 1px 8px; font-size: var(--kb-font-xs); line-height: 18px;
  background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec); white-space: nowrap;
}
.kb-tag__x {
  appearance: none; border: 0; background: none; padding: 0; margin: 0;
  color: var(--kb-text-ter); font: inherit; font-size: var(--kb-font-xs); line-height: 1; cursor: pointer;
  display: inline-flex; align-items: center;
}
.kb-tag__x:hover { color: var(--kb-danger); }
a.kb-tag { text-decoration: none; cursor: pointer; }
a.kb-tag:hover { text-decoration: underline; text-underline-offset: 2px; }

.kb-avatar {
  width: 20px; height: 20px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; line-height: 1;
  background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec);
  background: color-mix(in srgb, var(--kb-primary) 14%, var(--dsw-alias-bg-module-platform));
  overflow: hidden; text-overflow: ellipsis;
}
.kb-avatar--sm { width: 18px; height: 18px; font-size: 10px; }
.kb-avatar--lg { width: 28px; height: 28px; font-size: 12px; }

/* ---- 看板 ---- */
.kb-board { display: flex; gap: var(--kb-space-3); align-items: flex-start; overflow-x: auto; padding-bottom: var(--kb-space-3); }
.kb-board--tool { padding: 0 0 4px; }
.kb-board--tool .kb-column { flex-basis: 208px; min-width: 190px; }
.kb-column {
  flex: 0 0 272px; min-width: 240px; border: 1px solid var(--kb-border); border-top-width: 2px;
  border-radius: var(--kb-radius-lg); background: var(--kb-surface); overflow: hidden;
  border-top-color: var(--kb-accent, var(--kb-border));
  transition: border-color var(--kb-transition), box-shadow var(--kb-transition);
}
.kb-column--to-do { border-top-color: var(--kb-cat-todo); }
.kb-column--in-progress { border-top-color: var(--kb-cat-progress); }
.kb-column--done { border-top-color: var(--kb-cat-done); }
.kb-column--unknown { border-top-color: var(--kb-cat-unknown); }
.kb-column--to-do .kb-column__head { background: var(--kb-surface); background: color-mix(in srgb, var(--kb-cat-todo) 8%, var(--kb-surface)); }
.kb-column--in-progress .kb-column__head { background: var(--kb-surface); background: color-mix(in srgb, var(--kb-cat-progress) 10%, var(--kb-surface)); }
.kb-column--done .kb-column__head { background: var(--kb-surface); background: color-mix(in srgb, var(--kb-cat-done) 10%, var(--kb-surface)); }
.kb-column--unknown .kb-column__head { background: var(--kb-surface); background: color-mix(in srgb, var(--kb-cat-unknown) 8%, var(--kb-surface)); }
.kb-column__head { display: flex; align-items: center; gap: var(--kb-space-2); padding: 10px 12px; border-bottom: 1px solid var(--kb-border); }
.kb-column__name { font-weight: 600; font-size: var(--kb-font-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-column__count {
  margin-left: auto; border-radius: var(--kb-radius-pill); padding: 0 8px; font-size: var(--kb-font-xs); line-height: 18px;
  background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec); flex: none;
}
.kb-column__body { display: flex; flex-direction: column; gap: var(--kb-space-2); padding: 10px; max-height: calc(100vh - 200px); overflow-y: auto; }

.kb-status-dot { display: inline-flex; align-items: center; gap: 6px; font-size: var(--kb-font-xs); font-weight: 600; white-space: nowrap; }
.kb-status-dot::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 999px; flex: none; background: var(--kb-dot, var(--kb-cat-unknown)); }
.kb-status-dot--to-do::before { background: var(--kb-dot, var(--kb-cat-todo)); }
.kb-status-dot--in-progress::before { background: var(--kb-dot, var(--kb-cat-progress)); }
.kb-status-dot--done::before { background: var(--kb-dot, var(--kb-cat-done)); }
.kb-status-dot--unknown::before { background: var(--kb-dot, var(--kb-cat-unknown)); }

.kb-card {
  border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); padding: 9px 10px;
  background: var(--kb-surface-raised); cursor: default; position: relative;
  transition: border-color var(--kb-transition), box-shadow var(--kb-transition), transform var(--kb-transition), opacity var(--kb-transition);
}
.kb-card:hover { border-color: var(--kb-text-dim); box-shadow: var(--kb-shadow-sm); transform: translateY(-1px); }
.kb-card--clickable { cursor: pointer; }
.kb-card--clickable:active { transform: scale(.98); transition-duration: 80ms; box-shadow: none; }
.kb-card--empty { color: var(--kb-text-ter); cursor: default; text-align: center; background: none; }
.kb-card__top { display: flex; align-items: center; gap: 6px; }
.kb-card__key { font-size: var(--kb-font-xs); font-weight: 600; color: var(--kb-text-sec); font-family: var(--kb-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-card__copy { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; flex: none; }
.kb-card__copy .kb-btn { padding: 2px 8px; font-size: var(--kb-font-xs); }
.kb-card__extlink { width: 22px; height: 22px; }
.kb-card__summary { font-size: var(--kb-font-sm); margin-top: 4px; line-height: 1.45; word-break: break-word; }
.kb-card__tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--kb-space-2); }
.kb-card__assignee { margin-top: var(--kb-space-2); display: flex; align-items: center; gap: 6px; font-size: var(--kb-font-xs); color: var(--kb-text-ter); overflow: hidden; }
.kb-card__assignee-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 紧凑卡片：key + 摘要同一行（溢出自然换行），类型/优先级/负责人同一行 */
.kb-card__summaryline { line-height: 1.45; }
.kb-card__summaryline .kb-card__key { display: inline; margin-right: 6px; }
.kb-card__summaryline .kb-card__summary { display: inline; margin-top: 0; }
.kb-card__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: var(--kb-space-2); }
.kb-card__meta .kb-card__assignee { margin-top: 0; margin-left: auto; }

/* ---- 分组列表（应用内的唯一视图：按状态分组、可折叠） ---- */
.kb-groups { display: flex; flex-direction: column; gap: 10px; }
.kb-group {
  border: 1px solid var(--kb-border); border-left-width: 3px; border-radius: var(--kb-radius-lg);
  background: var(--kb-surface); overflow: hidden;
  border-left-color: var(--kb-accent, var(--kb-border));
  transition: border-color var(--kb-transition), box-shadow var(--kb-transition);
}
.kb-group__head {
  width: 100%; appearance: none; border: 0; background: none; font: inherit; color: inherit;
  display: flex; align-items: center; gap: var(--kb-space-2); padding: 9px 12px;
  cursor: pointer; text-align: left; border-bottom: 1px solid var(--kb-border);
  transition: background var(--kb-transition);
  background: var(--kb-surface);
  background: color-mix(in srgb, var(--kb-accent, var(--kb-border)) 8%, var(--kb-surface));
}
.kb-group__head:hover { background: var(--kb-surface-raised); }
.kb-group__head:focus-visible { outline: 2px solid var(--kb-primary); outline-offset: -2px; }
.kb-group__chevron { display: inline-flex; color: var(--kb-text-ter); transition: transform var(--kb-transition); transform: rotate(-90deg); }
.kb-group__chevron--open { transform: rotate(0deg); }
.kb-group__count {
  margin-left: auto; border-radius: var(--kb-radius-pill); padding: 0 8px; font-size: var(--kb-font-xs); line-height: 18px;
  background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec); flex: none;
}
.kb-group__body {
  display: grid; grid-template-rows: 1fr; padding: 0;
  transition: grid-template-rows 200ms var(--kb-ease);
}
.kb-group__body--collapsed { grid-template-rows: 0fr; }
.kb-group__inner {
  box-sizing: border-box; overflow: hidden; min-height: 0;
  display: flex; flex-direction: column; gap: var(--kb-space-2); padding: 10px;
  transition: padding 200ms var(--kb-ease);
}
/* 折叠态把纵向 padding 归零：与 0fr 行高一起保证完全不露边（双保险） */
.kb-group__body--collapsed .kb-group__inner { padding-top: 0; padding-bottom: 0; }
.kb-group__empty { padding: 12px 10px; text-align: center; font-size: var(--kb-font-xs); color: var(--kb-text-ter); }
.kb-group--collapsed .kb-group__head { border-bottom: 0; }

/* ---- 工具行（搜索 + 同步 meta；toolview 的标题行也复用） ---- */
.kb-toolbar { display: flex; align-items: center; gap: var(--kb-space-2); flex-wrap: wrap; margin-bottom: var(--kb-space-3); }
.kb-toolbar__meta { font-size: var(--kb-font-xs); color: var(--kb-text-ter); margin-left: auto; white-space: nowrap; }
.kb-toolbar__title { font-weight: 600; font-size: var(--kb-font-md); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-toolbar .kb-search { width: 240px; flex: none; }

/* ---- 聊天 toolview 修饰 ---- */
.kb-detail--tool { box-sizing: border-box; width: 100%; padding: 10px 12px; }
.kb-column__dot { width: 8px; height: 8px; border-radius: 999px; flex: none; }
.kb-column__empty { padding: var(--kb-space-2); }
.kb-note--tool-meta { margin-top: var(--kb-space-2); }

/* ---- 标签页 ---- */
.kb-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--kb-border); margin-bottom: var(--kb-space-4); }
/* 标签页行内放操作按钮（GitLab 面板） */
.kb-tabs--with-actions { align-items: center; }
.kb-tabs--with-actions .kb-btn { margin-bottom: 6px; }
.kb-tabs__spacer { flex: 1; }
.kb-tab {
  appearance: none; border: 0; background: none; padding: 8px 12px; font: inherit; font-size: var(--kb-font-sm);
  cursor: pointer; color: var(--kb-text-sec); border-bottom: 2px solid transparent; margin-bottom: -1px;
  border-radius: 8px 8px 0 0;
  transition: color var(--kb-transition), border-color var(--kb-transition), background var(--kb-transition);
}
.kb-tab:hover { color: var(--kb-text); background: var(--kb-surface); }
.kb-tab--on { color: var(--kb-primary); border-bottom-color: var(--kb-primary); font-weight: 500; }

/* ---- 表单 ---- */
.kb-form { display: flex; flex-direction: column; gap: 14px; }
.kb-form__footer { display: flex; gap: var(--kb-space-2); justify-content: flex-end; margin-top: 4px; }
.kb-form__grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
.kb-note { font-size: var(--kb-font-xs); color: var(--kb-text-ter); margin: 0; }
.kb-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.kb-field__label { font-size: var(--kb-font-sm); font-weight: 500; color: var(--kb-text-sec); }
.kb-field__req { color: var(--kb-danger); margin-left: 2px; }
.kb-field__error { font-size: var(--kb-font-xs); color: var(--kb-danger); }
.kb-input--lg { padding: 9px 10px; font-size: var(--kb-font-md); }
.kb-check { display: flex; align-items: center; gap: 6px; font-size: var(--kb-font-sm); color: var(--kb-text-sec); cursor: pointer; }
.kb-check input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--kb-primary); flex: none; }
.kb-badge { border-radius: var(--kb-radius-pill); padding: 0 8px; font-size: var(--kb-font-xs); line-height: 18px; background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec); white-space: nowrap; }

/* ---- 项目列表 ---- */
.kb-projects { display: flex; flex-direction: column; gap: 6px; font-size: var(--kb-font-sm); }
.kb-projects__item { display: flex; align-items: center; gap: var(--kb-space-2); min-width: 0; }
.kb-projects__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--kb-primary); flex: none; }
.kb-projects__meta { margin-left: auto; font-size: var(--kb-font-xs); color: var(--kb-text-ter); white-space: nowrap; }
.kb-projects__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kkb-proj {
  display: flex; align-items: center; gap: var(--kb-space-2); padding: 8px 10px;
  border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-surface);
  transition: border-color var(--kb-transition);
}
.kkb-proj span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- 空状态 / 提示条 ---- */
.kb-empty { display: flex; flex-direction: column; align-items: center; gap: var(--kb-space-2); padding: 60px 20px; text-align: center; }
.kb-empty__icon {
  width: 44px; height: 44px; border-radius: 50%; margin-bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  color: var(--kb-primary); background: var(--dsw-alias-bg-module-platform);
  background: color-mix(in srgb, var(--kb-primary) 10%, var(--dsw-alias-bg-module-platform));
}
.kb-empty__title { font-size: 15px; font-weight: 600; }
.kb-empty__hint { font-size: var(--kb-font-sm); color: var(--kb-text-ter); margin-bottom: var(--kb-space-2); }
.kb-banner {
  display: flex; align-items: flex-start; gap: var(--kb-space-2); margin: 12px 16px 0; padding: 10px 12px;
  border-radius: var(--kb-radius-md); border: 1px solid var(--kb-danger); color: var(--kb-danger); font-size: var(--kb-font-sm);
  background: var(--kb-bg); border-color: color-mix(in srgb, var(--kb-danger) 35%, transparent);
  background: color-mix(in srgb, var(--kb-danger) 8%, transparent);
}
.kb-banner__icon { flex: none; margin-top: 1px; }

/* ---- 详情 ---- */
.kb-detail { display: flex; flex-direction: column; gap: var(--kb-space-4); }
.kb-detail__meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.kb-detail__chip {
  display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-pill); padding: 2px 10px; font-size: var(--kb-font-xs);
  color: var(--kb-text-sec); background: var(--kb-surface-raised);
}
.kb-detail__section { display: flex; flex-direction: column; gap: var(--kb-space-2); }
.kb-detail__label { font-size: var(--kb-font-xs); font-weight: 600; color: var(--kb-text-sec); display: flex; align-items: center; gap: 6px; }
.kb-detail__desc { white-space: pre-wrap; font-size: var(--kb-font-sm); line-height: var(--kb-line); }
.kb-detail__transitions { display: flex; flex-wrap: wrap; gap: var(--kb-space-2); }
.kb-detail__transitions .kb-btn { font-weight: 500; }
.kb-detail__comments { display: flex; flex-direction: column; gap: 10px; }
.kb-comment { display: flex; gap: 10px; align-items: flex-start; }
.kb-comment__avatar { margin-top: 2px; }
.kb-comment__wrap { flex: 1; min-width: 0; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); padding: 10px 12px; background: var(--kb-surface-raised); }
.kb-comment__meta { font-size: var(--kb-font-xs); color: var(--kb-text-ter); margin-bottom: 4px; }
.kb-comment__body { font-size: var(--kb-font-sm); white-space: pre-wrap; line-height: var(--kb-line); }
.kb-detail__add { display: flex; flex-direction: column; gap: var(--kb-space-2); }

/* ---- 渲染的 Jira HTML ---- */
.kb-detail__html { font-size: var(--kb-font-sm); line-height: 1.6; word-break: break-word; }
.kb-detail__html.kb-comment__body { white-space: normal; }
.kb-detail__html > *:first-child { margin-top: 0; }
.kb-detail__html > *:last-child { margin-bottom: 0; }
.kb-detail__html p { margin: 0 0 8px; }
.kb-detail__html ul, .kb-detail__html ol { margin: 0 0 8px; padding-left: 20px; }
.kb-detail__html li { margin: 2px 0; }
.kb-detail__html h1, .kb-detail__html h2, .kb-detail__html h3 { margin: 12px 0 6px; font-weight: 600; line-height: 1.3; }
.kb-detail__html h1 { font-size: var(--kb-font-lg); }
.kb-detail__html h2 { font-size: 14.5px; }
.kb-detail__html h3 { font-size: 13.5px; }
.kb-detail__html strong, .kb-detail__html b { font-weight: 600; }
.kb-detail__html pre { background: var(--kb-surface); border: 1px solid var(--kb-border); border-radius: var(--kb-radius-sm); padding: 8px 10px; overflow-x: auto; font-size: var(--kb-font-xs); white-space: pre; margin: 0 0 8px; font-family: var(--kb-mono); }
.kb-detail__html code { background: var(--kb-surface); border: 1px solid var(--kb-border); border-radius: 4px; padding: 0 4px; font-size: 11.5px; font-family: var(--kb-mono); }
.kb-detail__html blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid var(--kb-border); color: var(--kb-text-ter); }
.kb-detail__html a { color: var(--kb-primary); }
.kb-detail__html img { max-width: 100%; height: auto; border-radius: var(--kb-radius-sm); cursor: zoom-in; display: block; margin: 6px 0; }

/* ---- 评论输入区 ---- */
.kb-composer__files { display: flex; flex-wrap: wrap; gap: 6px; }
.kb-composer__file {
  display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-sm); padding: 2px 8px; font-size: var(--kb-font-xs);
  color: var(--kb-text-sec); background: var(--kb-surface-raised);
}
.kb-composer__bar { display: flex; align-items: center; gap: var(--kb-space-2); }
.kb-composer__left { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
.kb-composer__left .kb-note { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- GitLab 面板 ---- */
.kb-gitlab__toolbar { display: flex; align-items: center; gap: var(--kb-space-2); margin-bottom: var(--kb-space-3); flex-wrap: wrap; }
.kb-gitlab__search { flex: 1; min-width: 120px; }
.kb-gitlab__list { display: flex; flex-direction: column; gap: var(--kb-space-2); }
.kb-gitlab__actions { margin-top: 10px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.kb-gitlab__state {
  border-radius: var(--kb-radius-pill); padding: 0 8px; font-size: var(--kb-font-xs); line-height: 18px;
  background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec); white-space: nowrap;
}
.kb-gitlab__state--opened { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-info); background: color-mix(in srgb, var(--dsw-alias-info) 14%, transparent); }
.kb-gitlab__state--merged { background: var(--dsw-alias-bg-module-platform); color: var(--kb-primary); background: color-mix(in srgb, var(--kb-primary) 14%, transparent); }
.kb-gitlab__state--closed { background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-ter); }
.kb-gitlab__branchrow { display: flex; align-items: center; gap: 6px; margin-top: var(--kb-space-2); font-size: var(--kb-font-xs); color: var(--kb-text-ter); font-family: var(--kb-mono); overflow: hidden; }
.kb-gitlab__branchrow span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 创建 MR 弹窗里的分支预览行 */
.kb-gitlab__branchrow--preview { margin-top: -8px; padding: 6px 10px; border: 1px dashed var(--kb-border); border-radius: var(--kb-radius-sm); background: var(--kb-surface); }
.kb-gitlab__select-list { display: flex; flex-direction: column; gap: 6px; }

.kb-dialog__msg { font-size: var(--kb-font-sm); color: var(--kb-text-sec); margin: 0; line-height: var(--kb-line); }

/* ---- 优先级着色 tag ---- */
.kb-tag--high { background: var(--dsw-alias-bg-module-platform); color: var(--kb-danger); background: color-mix(in srgb, var(--kb-danger) 12%, transparent); }
.kb-tag--medium { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-warning); background: color-mix(in srgb, var(--dsw-alias-warning) 14%, transparent); }
.kb-tag--low { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-info); background: color-mix(in srgb, var(--dsw-alias-info) 14%, transparent); }

/* ---- 表单注释状态 ---- */
.kb-note--ok { color: var(--kb-cat-done); }
.kb-note--error { color: var(--kb-danger); }

/* ---- 可点选列表（创建议题/链接 Jira/关联议题） ---- */
.kb-selectlist { display: flex; flex-direction: column; gap: 6px; }
.kb-selectlist__filter { display: flex; align-items: center; gap: var(--kb-space-2); }
.kb-selectlist__filter .kb-search { flex: 1; min-width: 0; }
.kb-selectlist__count { font-size: var(--kb-font-xs); color: var(--kb-text-ter); white-space: nowrap; }
.kb-selectlist__body {
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-surface-raised);
  max-height: 220px; overflow-y: auto;
}
.kb-selectlist__item {
  appearance: none; border: 0; background: none; font: inherit; color: var(--kb-text);
  display: flex; align-items: center; gap: var(--kb-space-2); padding: 7px 8px;
  border-radius: var(--kb-radius-sm); cursor: pointer; text-align: left;
  transition: background var(--kb-transition);
}
.kb-selectlist__item:hover { background: var(--kb-surface); }
.kb-selectlist__item--on { background: var(--dsw-alias-bg-module-platform); background: color-mix(in srgb, var(--kb-primary) 10%, transparent); }
.kb-selectlist__check {
  width: 16px; height: 16px; border: 1px solid var(--kb-border); border-radius: 4px; flex: none;
  display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-bg-layer-3);
  background: var(--kb-surface);
}
.kb-selectlist__item--on .kb-selectlist__check { background: var(--kb-primary); border-color: var(--kb-primary); }
.kb-selectlist__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--kb-font-sm); }
.kb-selectlist__empty { padding: 10px; text-align: center; font-size: var(--kb-font-xs); color: var(--kb-text-ter); }

/* ---- 芯片式多值输入（模块/标签等数组字段） ---- */
.kb-multi { display: flex; flex-direction: column; gap: 6px; }
.kb-multi__chips { display: flex; flex-wrap: wrap; gap: 4px; }

/* ---- 用户下拉（创建 issue 的负责人字段） ---- */
.kb-combo { position: relative; }
.kb-combo__menu {
  position: absolute; z-index: 10; top: calc(100% + 2px); left: 0; right: 0; margin: 0; padding: 4px;
  list-style: none; background: var(--kb-surface); border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius-md); max-height: 180px; overflow: auto; box-shadow: 0 8px 24px rgba(0, 0, 0, .2);
}
.kb-combo__menu li { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: var(--kb-font-sm); display: flex; align-items: center; gap: 6px; }
.kb-combo__menu li:hover { background: var(--dsw-alias-bg-module-platform); }
.kb-combo__menu li:focus-visible { outline: 2px solid var(--kb-primary); outline-offset: -2px; }
.kb-combo__menu small { color: var(--kb-text-ter); margin-left: auto; font-size: var(--kb-font-xs); }

/* ---- 同步确认弹窗 ---- */
.kb-sync-opts { display: flex; gap: 14px; flex-wrap: wrap; }
.kb-sync-preview {
  display: block; font-family: var(--kb-mono); font-size: var(--kb-font-xs); color: var(--kb-text-sec);
  background: var(--kb-surface); border: 1px solid var(--kb-border); border-radius: var(--kb-radius-sm);
  padding: 8px 10px; word-break: break-all; white-space: pre-wrap;
}
.kb-sync-head { display: flex; align-items: center; justify-content: space-between; gap: var(--kb-space-2); }
.kb-sync-list {
  display: flex; flex-direction: column; gap: 4px; padding: 6px;
  border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md); background: var(--kb-surface-raised);
  max-height: 220px; overflow-y: auto;
}
.kb-sync-item { display: flex; gap: var(--kb-space-2); align-items: baseline; font-size: var(--kb-font-sm); }
.kb-sync-item__key { font-family: var(--kb-mono); font-size: var(--kb-font-xs); color: var(--kb-primary); font-weight: 600; flex: none; }
.kb-sync-item__summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---- 同步统计行（toolview） ---- */
.kb-statrow { display: flex; gap: var(--kb-space-2); flex-wrap: wrap; }
.kb-statrow__item {
  flex: 1; min-width: 90px; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-lg);
  padding: 12px; background: var(--kb-surface); display: flex; flex-direction: column; gap: 2px;
}
.kb-statrow__num { font-size: 20px; font-weight: 600; line-height: 1.2; }
.kb-statrow__label { font-size: var(--kb-font-xs); color: var(--kb-text-ter); }

/* ---- 弹窗 ---- */
.kb-modal__overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center; z-index: var(--kb-z-modal);
  animation: kb-fade-in 180ms var(--kb-ease);
}
.kb-modal__overlay--closing { opacity: 0; transition: opacity 160ms var(--kb-ease); }
.kb-modal {
  background: var(--kb-bg); border: 1px solid var(--kb-border); border-radius: var(--kb-radius-xl);
  box-shadow: var(--kb-shadow-lg); display: flex; flex-direction: column; max-height: 88vh; min-width: 0;
  animation: kb-modal-in 180ms var(--kb-ease); outline: none;
}
.kb-modal--closing { opacity: 0; transform: translateY(6px) scale(.99); transition: opacity 160ms var(--kb-ease), transform 160ms var(--kb-ease); }
.kb-modal--md { width: 520px; max-width: 92vw; }
.kb-modal--xl { width: 880px; max-width: 94vw; }
.kb-modal__head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--kb-border); flex: none; }
.kb-modal__head-icon {
  width: 26px; height: 26px; border-radius: var(--kb-radius-md); flex: none;
  display: flex; align-items: center; justify-content: center;
  color: var(--kb-primary); background: var(--dsw-alias-bg-module-platform);
  background: color-mix(in srgb, var(--kb-primary) 12%, var(--dsw-alias-bg-module-platform));
}
.kb-modal__head h3 { margin: 0; font-size: var(--kb-font-md); font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-modal__close { flex: none; width: 32px; height: 32px; color: var(--kb-text); }
.kb-modal__close:hover:not(:disabled) { background: var(--kb-surface-raised); color: var(--kb-danger); border-color: var(--kb-danger); }
.kb-modal__body { padding: 16px 20px; overflow: auto; display: flex; flex-direction: column; }
.kb-modal__body .kb-banner { margin: 0 0 12px; }
/* 弹窗正文被内部区域接管滚动（GitLab 面板：标签页/工具栏固定，只滚列表） */
.kb-gitlab { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.kb-gitlab__list-wrap { flex: 1; min-height: 0; overflow-y: auto; padding-right: 4px; }
.kb-modal__foot { display: flex; align-items: center; gap: var(--kb-space-2); justify-content: flex-end; padding: 12px 20px; border-top: 1px solid var(--kb-border); background: var(--kb-surface); flex: none; }
.kb-modal__foot-spacer { flex: 1; }

/* ---- 图片灯箱 ---- */
.kb-lightbox { position: fixed; inset: 0; z-index: var(--kb-z-lightbox); background: rgba(0, 0, 0, .62); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; }
.kb-lightbox__img { max-width: 90vw; max-height: 90vh; border-radius: var(--kb-radius-md); object-fit: contain; box-shadow: 0 12px 40px rgba(0, 0, 0, .5); }
.kb-lightbox__nav {
  position: absolute; top: 50%; transform: translateY(-50%);
  appearance: none; border: 0; background: rgba(0, 0, 0, .4); color: #fff;
  width: 44px; height: 44px; border-radius: 50%; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--kb-transition);
}
.kb-lightbox__prev { left: 16px; }
.kb-lightbox__next { right: 16px; }
.kb-lightbox__nav:hover { background: rgba(0, 0, 0, .6); }
.kb-lightbox__close {
  position: absolute; top: 16px; right: 16px;
  appearance: none; border: 0; background: rgba(0, 0, 0, .4); color: #fff;
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--kb-transition);
}
.kb-lightbox__close:hover { background: rgba(0, 0, 0, .6); }
.kb-lightbox__count { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); color: rgba(255, 255, 255, .85); font-size: var(--kb-font-sm); background: rgba(0, 0, 0, .4); padding: 3px 12px; border-radius: var(--kb-radius-pill); }

/* ---- Toast ---- */
.kb-toast__viewport {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: var(--kb-z-toast); display: flex; flex-direction: column; align-items: center; gap: var(--kb-space-2);
  pointer-events: none; max-width: calc(100vw - 32px);
}
.kb-toast {
  pointer-events: auto; display: inline-flex; align-items: center; gap: var(--kb-space-2);
  padding: 9px 16px; border-radius: var(--kb-radius-pill); background: var(--kb-surface-raised);
  border: 1px solid var(--kb-border); color: var(--kb-text); font-size: var(--kb-font-sm);
  box-shadow: 0 8px 30px rgba(0, 0, 0, .25); cursor: pointer;
  animation: kb-toast-in 180ms var(--kb-ease); max-width: 100%;
}
.kb-toast > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-toast--exit { opacity: 0; transform: translateY(8px); transition: opacity 160ms var(--kb-ease), transform 160ms var(--kb-ease); }
.kb-toast--error { color: var(--kb-danger); border-color: var(--kb-danger); }
.kb-toast__icon { display: inline-flex; flex: none; }

/* ---- 骨架屏 ---- */
.kb-skeleton {
  background: var(--dsw-alias-bg-layer-2);
  background: linear-gradient(90deg, var(--dsw-alias-bg-layer-2) 25%, var(--dsw-alias-bg-module-platform) 50%, var(--dsw-alias-bg-layer-2) 75%);
  background-size: 200% 100%; animation: kb-shimmer 1.4s linear infinite;
  border-radius: var(--kb-radius-sm);
}
.kb-skeleton-board { display: flex; gap: var(--kb-space-3); }
.kb-skeleton-col {
  flex: 0 0 272px; min-width: 240px; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-lg);
  display: flex; flex-direction: column; gap: var(--kb-space-2); padding: 12px; background: var(--kb-surface);
}
.kb-skeleton-head { height: 16px; width: 45%; }
.kb-skeleton-card { height: 84px; border-radius: var(--kb-radius-md); }
.kb-skeleton-cards { display: flex; flex-direction: column; gap: var(--kb-space-2); }
.kb-skeleton-detail { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; }
.kb-skeleton-line { height: 12px; border-radius: var(--kb-radius-sm); }

/* ==================== 嵌入式看板应用布局（.kkb-app） ==================== */
.kkb-app {
  position: fixed; inset: 0; z-index: var(--kb-z-app); display: flex; flex-direction: column;
  background: var(--kb-bg); color: var(--kb-text); font-size: var(--kb-font-sm); line-height: var(--kb-line);
}
/* 窄浮窗变体：固定在右侧，功能与全屏一致；弹窗是整屏浮层，不受宽度限制。 */
.kkb-app--panel {
  top: 12px; right: 12px; bottom: 12px; left: auto;
  width: min(420px, calc(100vw - 24px));
  z-index: var(--kb-z-panel);
  border: 1px solid var(--kb-border); border-radius: var(--kb-radius-xl);
  box-shadow: var(--kb-shadow-lg);
  animation: kb-panel-in 180ms var(--kb-ease);
}
.kkb-app__bar {
  display: flex; align-items: center; gap: 10px; padding: 10px 16px; flex-wrap: wrap;
  border-bottom: 1px solid var(--kb-border); background: var(--kb-surface); flex: none;
}
/* 浮窗的紧凑三行工具栏：行1 品牌/关闭，行2 项目切换，行3 视图/图标操作。 */
.kkb-app__bar--panel { flex-direction: column; align-items: stretch; gap: var(--kb-space-2); padding: 10px 12px; }
.kkb-app__barrow { display: flex; align-items: center; gap: var(--kb-space-2); min-width: 0; }
.kkb-app__bar--panel .kb-btn { padding: 4px 9px; font-size: var(--kb-font-xs); white-space: nowrap; }
.kkb-app__barrow .kb-seg button { padding: 4px 10px; font-size: var(--kb-font-xs); }
.kkb-app__brand { font-weight: 600; font-size: var(--kb-font-md); display: inline-flex; align-items: center; gap: var(--kb-space-2); }
.kkb-app__brandicon { color: var(--kb-primary); display: inline-flex; }
.kkb-app__meta { font-size: var(--kb-font-xs); color: var(--kb-text-ter); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kkb-app__spacer { flex: 1; }
.kkb-app__main { flex: 1; overflow: auto; padding: var(--kb-space-4); }
.kkb-app__loading { padding: 40px; text-align: center; color: var(--kb-text-ter); }
/* 窄浮窗里搜索占满整行。 */
.kkb-app--panel .kb-toolbar .kb-search { width: auto; flex: 1; }
.kkb-app--panel .kb-toolbar__meta { margin-left: 0; width: 100%; }

/* ==================== 配置卡片（settings.plugin.item） ==================== */
.kkb-config-card {
  list-style: none; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-lg);
  background: var(--kb-surface-raised); transition: border-color var(--kb-transition), background var(--kb-transition);
}
.kkb-card-open { background: var(--kb-surface); border-color: var(--kb-text-dim); }
.kkb-config-head {
  width: 100%; appearance: none; border: 0; background: none; font: inherit; color: inherit;
  text-align: left; cursor: pointer; display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: var(--kb-radius-lg);
}
.kkb-config-head:focus-visible { outline: 2px solid var(--kb-primary); outline-offset: -2px; }
.kkb-config-head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.kkb-config-name { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--kb-text); }
.kkb-config-desc { font-size: var(--kb-font-sm); line-height: 1.5; color: var(--kb-text-ter); }
.kkb-chevron { flex: none; color: var(--kb-text-ter); transition: transform var(--kb-transition); display: inline-flex; }
.kkb-chevron-open { transform: rotate(180deg); }
.kkb-config-body { border-top: 1px solid var(--kb-border); margin: 0 16px; padding-bottom: var(--kb-space-2); display: flex; flex-direction: column; gap: 6px; }
.kkb-config-status { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; }
.kkb-config-status-title { margin: 0; font-size: var(--kb-font-md); font-weight: 600; line-height: 1.4; color: var(--kb-text); }
.kkb-config-status-body { margin: 0; font-size: var(--kb-font-xs); line-height: 1.6; color: var(--kb-text-ter); }
.kkb-read-only { margin: 0; font-size: var(--kb-font-xs); line-height: 1.5; color: var(--kb-text-ter); }
.kkb-pending {
  flex: none; border-radius: var(--kb-radius-pill); padding: 1px 8px; font-size: var(--kb-font-xs); line-height: 17px;
  font-weight: 500; white-space: nowrap; background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec);
}
.kkb-config-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: var(--kb-space-2);
  padding: 12px 0 4px; border-top: 1px solid var(--kb-border);
}
.kkb-failed { flex: 1; min-width: 0; margin: 0; font-size: var(--kb-font-xs); line-height: 1.5; color: var(--kb-danger); }
.kkb-discard, .kkb-save {
  appearance: none; border: 1px solid transparent; border-radius: var(--kb-radius-md); padding: 5px 14px;
  font: inherit; font-size: var(--kb-font-sm); line-height: 1.5; cursor: pointer;
  transition: background var(--kb-transition), color var(--kb-transition), border-color var(--kb-transition);
}
.kkb-discard { border-color: var(--kb-border); background: none; color: var(--kb-text-sec); }
.kkb-discard:hover:not(:disabled) { color: var(--kb-text); border-color: var(--kb-text-dim); background: var(--kb-surface); }
.kkb-save {
  background: var(--kb-primary);
  background: linear-gradient(180deg, color-mix(in srgb, var(--kb-primary) 90%, #fff) 0%, var(--kb-primary) 100%);
  color: var(--dsw-alias-bg-layer-3);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18), 0 2px 8px color-mix(in srgb, var(--kb-primary) 35%, transparent);
}
.kkb-save:hover:not(:disabled) { opacity: 1; transform: translateY(-1px); }
.kkb-discard:disabled, .kkb-save:disabled { opacity: .4; cursor: default; }
.kkb-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.kkb-field + .kkb-field { border-top: 1px solid var(--kb-border); }
.kkb-field-head { display: flex; align-items: center; gap: var(--kb-space-2); }
.kkb-label { flex: 1; min-width: 0; font-size: var(--kb-font-sm); font-weight: 500; line-height: 1.5; color: var(--kb-text); }
.kkb-badges { display: inline-flex; align-items: center; gap: var(--kb-space-2); }
.kkb-badge {
  border-radius: var(--kb-radius-pill); padding: 1px 8px; font-size: var(--kb-font-xs); line-height: 17px;
  white-space: nowrap; font-weight: 500; background: var(--dsw-alias-bg-module-platform); color: var(--kb-text-sec);
}
.kkb-reset { border: none; background: none; padding: 0; font: inherit; font-size: var(--kb-font-xs); line-height: 1.5; color: var(--kb-text-sec); cursor: pointer; border-radius: 4px; }
.kkb-reset:hover:not(:disabled) { color: var(--kb-text); }
.kkb-reset:disabled { cursor: default; }
.kkb-hint { margin: 0; font-size: var(--kb-font-xs); line-height: 1.5; color: var(--kb-text-ter); }
.kkb-config-body input[type='text'], .kkb-config-body input[type='password'] {
  height: 34px; padding: 0 12px; border: 1px solid var(--kb-border); border-radius: var(--kb-radius-md);
  background: var(--kb-surface-raised); font: inherit; font-size: var(--kb-font-sm); line-height: 1.5; color: var(--kb-text);
  transition: border-color var(--kb-transition), box-shadow var(--kb-transition);
}
.kkb-config-body input[type='text']:focus-visible, .kkb-config-body input[type='password']:focus-visible { outline: none; border-color: var(--kb-primary); box-shadow: 0 0 0 2px transparent; box-shadow: 0 0 0 2px color-mix(in srgb, var(--kb-primary) 25%, transparent); }
.kkb-config-body input[type='checkbox'] { width: 16px; height: 16px; accent-color: var(--kb-primary); }

/* ==================== 会话头入口按钮 ==================== */
.kkb-header-btn {
  appearance: none; border: 1px solid var(--kb-border); background: none;
  color: var(--kb-text-sec); width: 30px; height: 30px; border-radius: var(--kb-radius-md);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  font: inherit; padding: 0; transition: background var(--kb-transition), color var(--kb-transition), border-color var(--kb-transition);
}
.kkb-header-btn:hover { background: var(--kb-surface); color: var(--kb-text); border-color: var(--kb-text-dim); }
.kkb-header-btn:focus-visible { outline: 2px solid var(--kb-primary); outline-offset: -2px; }
.kkb-header-icon { display: block; color: currentColor; }
/* 图标 + 文字变体：更宽的点击区域 */
.kkb-header-btn--label { width: auto; padding: 0 10px; gap: 6px; font-size: var(--kb-font-xs); }

/* ==================== 键盘焦点 / 减少动效 ==================== */
.kb-btn:focus-visible, .kb-iconbtn:focus-visible, .kb-tab:focus-visible,
.kb-modal__close:focus-visible, .kb-card:focus-visible, .kb-tag__x:focus-visible,
.kb-search__clear:focus-visible, .kb-lightbox__nav:focus-visible, .kb-lightbox__close:focus-visible,
.kb-card__extlink:focus-visible, .kb-selectlist__item:focus-visible, a.kb-tag:focus-visible,
.kkb-discard:focus-visible, .kkb-save:focus-visible, .kkb-reset:focus-visible {
  outline: 2px solid var(--kb-primary); outline-offset: 2px;
}
.kb-input:focus-visible, .kb-select:focus-visible {
  outline: none; border-color: var(--kb-primary);
  box-shadow: 0 0 0 2px transparent;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--kb-primary) 25%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  [class*='kb-'], [class*='kkb-'] {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`
  document.head.appendChild(tag)
}
