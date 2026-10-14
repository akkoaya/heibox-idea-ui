// 飞书同款弹出搜索（小黑盒版）：rail / 列表搜索框点击或 ⌘K 打开居中面板。
// 数据来源：① 已被动捕获的官方搜索接口结果；② 信息流/详情接口缓存下来的帖子与话题。
// 没有本地命中时，回车/「查看全部结果」走站内搜索（中栏渲染原生搜索结果）。
import { SEARCH_RECENT_KEY } from "../config/constants.js";
import { cachedFeedPins, cachedTopics, getCapturedSearch } from "../bridge/feed-api.js";
import { navigateX } from "../bridge/x-dom.js";
import { escapeHtml } from "../utils/html.js";
import { avatarColor, avatarLetter } from "./avatars.js";
import { ICONS } from "../config/icons.js";
import { getViewMode } from "../state/view-state.js";
import { toast } from "./toast.js";

const DEBOUNCE_MS = 160;

let recent = loadRecent();
let root = null;
let inputEl = null;
let bodyEl = null;
let moreEl = null;
let clearEl = null;
let chipsEl = null;
let debounceTimer = 0;

const TYPES = [
  { key: "all", label: "全部" },
  { key: "帖子", label: "帖子" },
  { key: "用户", label: "用户" },
  { key: "话题", label: "话题" },
];

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const LINK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.24 1.24"/><path d="M13.5 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.24-1.24"/></svg>`;

const state = {
  term: "",
  itemsTerm: null,
  type: "all",
  flat: [],
  active: -1,
};

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY) || "[]").slice(0, 8); } catch { return []; }
}

function pushRecent(term) {
  const t = (term || "").trim();
  if (!t) return;
  recent = [t, ...recent.filter((x) => x !== t)].slice(0, 8);
  persistRecent();
}

function persistRecent() {
  try { localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(recent)); } catch { /* ignore */ }
}

/** 删除单条搜索记录 */
function removeRecent(term) {
  const t = String(term || "").trim();
  if (!t) return;
  const before = recent.length;
  recent = recent.filter((x) => x !== t);
  if (recent.length === before) return;
  persistRecent();
  renderBody();
  toast(`已删除这条搜索记录`);
}

/** 一键清空全部搜索记录 */
function clearRecent() {
  if (!recent.length) return;
  recent = [];
  persistRecent();
  renderBody();
  toast("已清空搜索记录");
}

function availableInIM() {
  return getViewMode() !== "native";
}

function hl(text, term) {
  const safe = escapeHtml(String(text || ""));
  if (!term) return safe;
  const esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return safe.replace(new RegExp(`(${escapeHtml(esc)})`, "gi"), '<span class="search-hl">$1</span>');
  } catch { return safe; }
}

function letterAvatar(name) {
  return `<span class="ava is-letter" style="background:${avatarColor(name)}">${escapeHtml(avatarLetter(name))}</span>`;
}

function avatarHtml(src, name, cls = "ava") {
  return src
    ? `<img class="${cls}" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : letterAvatar(name);
}

function matchText(pin, term) {
  const t = term.toLowerCase();
  return String(pin.text || "").toLowerCase().includes(t)
    || String(pin.name || "").toLowerCase().includes(t)
    || String(pin.topicLabel || "").toLowerCase().includes(t);
}

/** 本地检索：官方搜索接口捕获结果 + 信息流缓存帖子 + 话题 / 用户 */
function buildItems(term) {
  const t = term.trim();
  const lower = t.toLowerCase();
  const seenPosts = new Set();
  const posts = [];
  for (const p of getCapturedSearch(t)) {
    if (!p?.id || seenPosts.has(p.id)) continue;
    seenPosts.add(p.id);
    posts.push(p);
  }
  for (const p of cachedFeedPins()) {
    if (!p?.id || seenPosts.has(p.id)) continue;
    if (!matchText(p, lower)) continue;
    seenPosts.add(p.id);
    posts.push(p);
  }

  const items = [];
  const users = new Map();
  const topics = new Map();

  for (const p of posts.slice(0, 40)) {
    const lines = String(p.text || "").split("\n").filter(Boolean);
    const meta = [p.name, p.likeCount ? `♥ ${p.likeCount}` : "", p.replyCount ? `💬 ${p.replyCount}` : "", p.time]
      .filter(Boolean).join(" · ");
    items.push({
      group: "帖子",
      title: lines[0] || "（无标题）",
      sub: lines.slice(1).join(" ").slice(0, 120),
      meta,
      avatar: avatarHtml(p.avatar, p.name),
      href: p.href || `/app/bbs/link/${p.id}`,
    });
    if (p.userId && !users.has(String(p.userId))) {
      users.set(String(p.userId), { id: String(p.userId), name: p.name, avatar: p.avatar });
    }
    for (const topic of p.topics || []) {
      if (!topics.has(topic.id)) topics.set(topic.id, topic);
    }
  }

  for (const u of users.values()) {
    items.push({
      group: "用户",
      title: u.name,
      sub: "",
      meta: `ID: ${u.id}`,
      avatar: avatarHtml(u.avatar, u.name),
      href: `/app/user/profile/${u.id}`,
    });
  }

  const cachedTopicHits = cachedTopics().filter((topic) => topic.name.toLowerCase().includes(lower));
  for (const topic of cachedTopicHits.slice(0, 20)) {
    if (!topics.has(topic.id)) topics.set(topic.id, topic);
  }
  for (const topic of topics.values()) {
    items.push({
      group: "话题",
      title: topic.name,
      sub: "",
      meta: "话题",
      avatar: avatarHtml(topic.icon, topic.name, "ava is-square"),
      href: `/app/topic/link/${topic.id}`,
    });
  }
  return items;
}

function itemHtml(it, idx, term) {
  const copy = it.href ? `<span class="im-search-copy" title="复制链接">${LINK_SVG}</span>` : "";
  const remove = it.recent
    ? `<span class="im-search-remove" role="button" tabindex="-1" title="删除这条记录" aria-label="删除这条记录">×</span>`
    : "";
  return `
    <a class="im-search-item${idx === state.active ? " active" : ""}" role="option" data-idx="${idx}" href="${escapeHtml(it.href || "#")}">
      ${it.avatar || ""}
      <span class="im-search-item-main">
        <span class="tt">${hl(it.title, term)}</span>
        ${it.meta ? `<span class="meta">${escapeHtml(it.meta)}</span>` : ""}
        ${it.sub ? `<span class="sb">${hl(it.sub, term)}</span>` : ""}
      </span>
      ${copy}
      ${remove}
    </a>`;
}

function renderChips() {
  if (!chipsEl) return;
  chipsEl.innerHTML = TYPES.map((t) =>
    `<button type="button" class="im-search-chip${t.key === state.type ? " active" : ""}" data-type="${t.key}">${t.label}</button>`
  ).join("");
}

function renderBody() {
  if (!bodyEl) return;
  const term = state.term.trim();
  let html = "";
  state.flat = [];
  state.active = -1;
  if (clearEl) clearEl.hidden = !state.term;

  if (term) {
    const all = state.itemsTerm === term ? state.items || [] : [];
    const items = state.type === "all" ? all : all.filter((it) => it.group === state.type);
    if (items.length) {
      let lastGroup = null;
      for (const it of items) {
        if (state.type === "all" && it.group !== lastGroup) {
          html += `<div class="im-search-group">${escapeHtml(it.group)}</div>`;
          lastGroup = it.group;
        }
        html += itemHtml(it, state.flat.length, term);
        state.flat.push(it);
      }
      html += `<div class="im-search-status">本地只搜了已加载的内容，回车可搜索全站</div>`;
    } else {
      html += `<div class="im-search-status">本地没有“${escapeHtml(term)}”相关缓存，回车搜索全站</div>`;
      const it = { group: "站内搜索", title: `在站内搜索“${term}”`, href: `/app/search?q=${encodeURIComponent(term)}`, searchAll: true };
      html += itemHtml(it, state.flat.length, "");
      state.flat.push(it);
    }
  } else if (recent.length) {
    html += `<div class="im-search-group im-search-group-recent">
      <span>最近搜索</span>
      <button type="button" class="im-search-clear-recent" data-clear-recent title="清空全部搜索记录">清空</button>
    </div>`;
    for (const t of recent) {
      const it = { group: "最近", title: t, href: null, recent: true };
      html += itemHtml(it, state.flat.length, "");
      state.flat.push(it);
    }
  } else {
    html += `<div class="im-search-status">输入关键词搜索帖子、用户、话题</div>`;
  }
  bodyEl.innerHTML = html;
  if (moreEl) {
    moreEl.hidden = !term;
    moreEl.textContent = `在站内搜索“${term}”的全部结果`;
    moreEl.href = `/app/search?q=${encodeURIComponent(term)}`;
  }
}

function runSearch(term) {
  state.items = buildItems(term);
  state.itemsTerm = term;
  renderBody();
}

function scheduleSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const term = state.term.trim();
    if (term) runSearch(term);
    else { state.items = []; state.itemsTerm = null; renderBody(); }
  }, DEBOUNCE_MS);
}

function setActive(idx) {
  if (!state.flat.length) return;
  state.active = (idx + state.flat.length) % state.flat.length;
  for (const el of bodyEl.querySelectorAll(".im-search-item")) {
    el.classList.toggle("active", Number(el.dataset.idx) === state.active);
  }
  bodyEl.querySelector(`.im-search-item[data-idx="${state.active}"]`)?.scrollIntoView({ block: "nearest" });
}

function searchAll(term) {
  const t = String(term || "").trim();
  if (!t) return;
  pushRecent(t);
  closeSearchPopup();
  navigateX(`/app/search?q=${encodeURIComponent(t)}`);
}

function openItem(it) {
  if (!it) return;
  if (it.recent) {
    inputEl.value = it.title;
    state.term = it.title;
    runSearch(it.title);
    return;
  }
  if (it.searchAll) {
    searchAll(state.term);
    return;
  }
  if (state.term.trim()) pushRecent(state.term.trim());
  closeSearchPopup();
  navigateX(it.href);
}

function ensureRoot() {
  if (root) return root;
  root = document.createElement("div");
  root.className = "im-search-pop-overlay";
  root.innerHTML = `
    <div class="im-search-pop" role="dialog" aria-modal="true" aria-label="搜索">
      <div class="im-search-head">
        <div class="im-search-field">
          ${ICONS.search}
          <input type="search" class="im-search-input" placeholder="搜索帖子、用户、话题" autocomplete="off" aria-label="搜索关键词">
          <button type="button" class="im-search-clear" hidden>清除</button>
        </div>
        <button type="button" class="im-search-close" title="退出搜索 (Esc)" aria-label="关闭">${CLOSE_SVG}</button>
      </div>
      <div class="im-search-chips" role="group" aria-label="结果类型"></div>
      <div class="im-search-body" role="listbox" aria-label="搜索结果"></div>
      <div class="im-search-foot">
        <a class="im-search-more" href="/app/search" hidden></a>
        <span class="im-search-tips">
          <span><kbd>↑</kbd><kbd>↓</kbd> 移动光标</span>
          <span><kbd>↵</kbd> 选择条目</span>
          <span><kbd>esc</kbd> 退出搜索</span>
        </span>
      </div>
    </div>`;
  document.body.appendChild(root);
  inputEl = root.querySelector(".im-search-input");
  bodyEl = root.querySelector(".im-search-body");
  moreEl = root.querySelector(".im-search-more");
  clearEl = root.querySelector(".im-search-clear");
  chipsEl = root.querySelector(".im-search-chips");
  renderChips();

  root.addEventListener("mousedown", (e) => {
    if (e.target === root) closeSearchPopup();
  });
  root.querySelector(".im-search-close").addEventListener("click", closeSearchPopup);
  clearEl.addEventListener("click", () => {
    inputEl.value = "";
    state.term = "";
    state.items = [];
    state.itemsTerm = null;
    renderBody();
    inputEl.focus();
  });
  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".im-search-chip[data-type]");
    if (!chip || chip.dataset.type === state.type) return;
    state.type = chip.dataset.type;
    for (const c of chipsEl.querySelectorAll(".im-search-chip")) {
      c.classList.toggle("active", c.dataset.type === state.type);
    }
    renderBody();
  });

  inputEl.addEventListener("input", () => {
    state.term = inputEl.value;
    scheduleSearch();
  });
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(state.active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(state.active - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const term = state.term.trim();
      if (state.active >= 0 && state.flat[state.active]) openItem(state.flat[state.active]);
      else if (term) searchAll(term);
    }
  });
  bodyEl.addEventListener("click", (e) => {
    const clearAll = e.target.closest("[data-clear-recent]");
    if (clearAll) {
      e.preventDefault();
      e.stopPropagation();
      clearRecent();
      return;
    }
    const removeBtn = e.target.closest(".im-search-remove");
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = removeBtn.closest(".im-search-item");
      const it = state.flat[Number(row?.dataset.idx)];
      if (it?.recent) removeRecent(it.title);
      return;
    }
    const copy = e.target.closest(".im-search-copy");
    if (copy) {
      e.preventDefault();
      e.stopPropagation();
      const href = copy.closest(".im-search-item")?.getAttribute("href");
      if (href && href !== "#") navigator.clipboard?.writeText(location.origin + href).catch(() => {});
      copy.classList.add("done");
      setTimeout(() => copy.classList.remove("done"), 1200);
      return;
    }
    const el = e.target.closest(".im-search-item");
    if (!el) return;
    e.preventDefault();
    openItem(state.flat[Number(el.dataset.idx)]);
  });
  moreEl.addEventListener("click", (e) => {
    e.preventDefault();
    searchAll(state.term);
  });
  return root;
}

export function openSearchPopup(prefill) {
  if (!availableInIM()) return;
  ensureRoot();
  root.classList.add("open");
  if (typeof prefill === "string" && prefill.trim()) inputEl.value = prefill;
  state.term = inputEl.value;
  if (state.term.trim()) runSearch(state.term.trim());
  document.documentElement.classList.add("im-search-open");
  renderBody();
  setTimeout(() => inputEl.focus(), 0);
}

export function closeSearchPopup() {
  if (!root) return;
  root.classList.remove("open");
  document.documentElement.classList.remove("im-search-open");
}

export function toggleSearchPopup() {
  if (root && root.classList.contains("open")) closeSearchPopup();
  else openSearchPopup();
}

/** ⌘K / Ctrl+K 全局快捷键；Esc 关闭（IM 模式下生效） */
export function bindSearchShortcut() {
  document.addEventListener("keydown", (e) => {
    if (!availableInIM()) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && String(e.key).toLowerCase() === "k") {
      e.preventDefault();
      e.stopPropagation();
      toggleSearchPopup();
      return;
    }
    if (e.key === "Escape" && root && root.classList.contains("open")) {
      e.preventDefault();
      closeSearchPopup();
    }
  }, true);
}

/** rail / 列表搜索框接管：只作入口（readonly），点击弹出搜索面板 */
export function bindSearchTrigger(host, { placeholder } = {}) {
  const input = host?.querySelector("input");
  if (!host || !input || host.dataset.searchBound === "1") return;
  host.dataset.searchBound = "1";
  input.readOnly = true;
  if (placeholder) input.placeholder = placeholder;
  host.addEventListener("mousedown", (e) => {
    e.preventDefault();
    openSearchPopup();
  });
}
