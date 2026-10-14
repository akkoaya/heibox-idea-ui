// 小黑盒（xiaoheihe.cn）DOM 提取与桥接层
// 宿主页面是 Vue3 SPA：帖子卡片 → /app/bbs/link/{linkid}，用户 → /app/user/profile/{userid}

const ME_CACHE_KEY = "xhh-im-me";

/* —— 通用小工具 —— */
export function countIn(label) {
  if (!label) return "";
  const m = String(label).replace(/,/g, "").match(/(\d+(?:\.\d+)?[KkMm万]?)/);
  return m ? m[1] : "";
}

export function flagTrue(v) {
  if (v === true || v === 1 || v === "true" || v === "1") return true;
  return false;
}

export function clickNative(sel) {
  const el = typeof sel === "string" ? document.querySelector(sel) : sel;
  if (!el) return false;
  el.click();
  return true;
}

export function unwrap(value, depth = 0) {
  if (depth > 6 || value == null || typeof value !== "object") return value;
  if (Object.prototype.hasOwnProperty.call(value, "_rawValue")) return unwrap(value._rawValue, depth + 1);
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    const inner = value.value;
    if (inner == null || typeof inner !== "object" || !("deps" in inner)) return unwrap(inner, depth + 1);
  }
  return value;
}

/** 真实页面 Window：沙箱模式下 view/事件派发必须走 unsafeWindow */
export function pageWindow() {
  try { return typeof unsafeWindow !== "undefined" ? unsafeWindow : window; } catch { return window; }
}

function dispatchClick(el) {
  if (!el) return;
  const w = pageWindow();
  const opts = { bubbles: true, cancelable: true, view: w };
  el.dispatchEvent(new w.MouseEvent("mousedown", opts));
  el.dispatchEvent(new w.MouseEvent("mouseup", opts));
  el.dispatchEvent(new w.MouseEvent("click", opts));
}

export function isImNode(el) {
  return !!el?.closest?.(".im-shell, .im-rail, .im-strip, .im-list-panel, .im-chat-panel, .im-titlebar, .im-detail-view, .xim-skin-menu");
}

/* —— Cookie 里的当前用户（网站把昵称/头像/ID 写进了 cookie）—— */
function decodeCookieValue(raw) {
  let s = String(raw || "");
  try {
    s = s.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    s = decodeURIComponent(s);
  } catch { /* ignore */ }
  return s;
}

function readCookie(name) {
  try {
    const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
    return m ? decodeCookieValue(m[1]) : "";
  } catch { return ""; }
}

function readCachedMe() {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function writeCachedMe(info) {
  if (!info) return;
  const prev = readCachedMe() || {};
  const next = { ...prev, ...info, _t: Date.now() };
  try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
}

function findDomMeAvatar() {
  const img = document.querySelector(".nav-user-avatar, .nav-user img, .nav-user-popover-avatar");
  if (!img || isImNode(img)) return "";
  return img.currentSrc || img.src || img.getAttribute("src") || "";
}

function findDomMeName() {
  const el = document.querySelector(".nav-user-popover-name");
  if (el && !isImNode(el)) {
    const t = (el.textContent || "").trim();
    if (t) return t;
  }
  return "";
}

export function nativeUserId() {
  const cached = readCachedMe() || {};
  const fromCookie = readCookie("user_heybox_id") || readCookie("heybox_id") || "";
  if (fromCookie) return String(fromCookie);
  if (cached.userId) return String(cached.userId);
  const domId = document.querySelector(".nav-user-popover-id")?.textContent || "";
  const m = domId.match(/(\d{4,})/);
  return m ? m[1] : "";
}

export function nativeDisplayName() {
  const cached = readCachedMe() || {};
  const name = findDomMeName() || readCookie("nickname") || cached.name || "";
  if (name) {
    writeCachedMe({ name });
    return name;
  }
  return "我";
}

export function nativeAvatarSrc() {
  const cached = readCachedMe() || {};
  const src = findDomMeAvatar() || readCookie("avatar") || cached.avatar || "";
  if (src) writeCachedMe({ avatar: src });
  return src;
}

export function nativeProfilePath() {
  const uid = nativeUserId();
  return uid ? `/app/user/profile/${uid}` : "/app/user/profile";
}

export function isMeUserId(uid) {
  const me = nativeUserId();
  return !!(me && uid && String(uid) === String(me));
}

export function badgeCount() {
  return 0;
}

/* —— 路由与跳转 —— */
export function linkIdFromPath(pathname = location.pathname) {
  const m = String(pathname).match(/\/app\/bbs\/link\/(\d+)/);
  return m ? m[1] : "";
}

export function userIdFromPath(pathname = location.pathname) {
  const m = String(pathname).match(/\/app\/user\/profile\/(\d+)/);
  return m ? m[1] : "";
}

/** 嗅探站点内部 Vue Router 实例（驱动无感单页导航） */
export function findVueRouter() {
  const seeds = [
    document.querySelector("#app"),
    document.querySelector("main"),
    document.querySelector(".hb-cpt__scroll-list"),
  ];
  for (const el of seeds) {
    const fromApp = el?.__vue_app__?.config?.globalProperties?.$router;
    if (fromApp && typeof fromApp.push === "function") return fromApp;
    let comp = el?.__vueParentComponent;
    for (let i = 0; i < 24 && comp; i++) {
      const router = comp.appContext?.config?.globalProperties?.$router || comp.proxy?.$router;
      if (router && typeof router.push === "function") return router;
      comp = comp.parent;
    }
  }
  return null;
}

function navButtonByText(text) {
  for (const btn of document.querySelectorAll("button.nav-link, .nav-links button")) {
    if ((btn.textContent || "").replace(/\s+/g, "") === text) return btn;
  }
  return null;
}

/** 站内跳转：优先点击原生链接/导航按钮，其次驱动 Vue Router，最后 history 兜底 */
export function navigateX(path) {
  const dest = path.startsWith("/") ? path : `/${path}`;
  const current = location.pathname + location.search;
  if (dest === current) return;

  // 社区首页是 nav 上的 button，不是 <a>
  if (dest === "/app/bbs/home") {
    const btn = navButtonByText("社区") || navButtonByText("首页");
    if (btn) { dispatchClick(btn); return; }
  }

  const candidates = [
    `a[href="${dest}"]`,
    `a[href^="${dest}?"]`,
  ];
  for (const sel of candidates) {
    for (const a of document.querySelectorAll(sel)) {
      if (isImNode(a) || a.closest(".related-recommend__container")) continue;
      dispatchClick(a);
      return;
    }
  }

  const router = findVueRouter();
  if (router && typeof router.push === "function") {
    try { router.push(dest); return; } catch { /* fall through */ }
  }
  try {
    history.pushState({}, "", dest);
    pageWindow().dispatchEvent(new PopStateEvent("popstate"));
  } catch { /* ignore */ }
}

/** 搜索：/app/search?q=xxx → 站点自身重定向到 /app/search/list?q=xxx */
export function navigateSearch(keyword) {
  const kw = String(keyword || "").trim();
  if (!kw) return;
  navigateX(`/app/search?q=${encodeURIComponent(kw)}`);
}

export function openUserProfile(href, userId) {
  let id = String(userId || "").trim();
  if (!id) {
    const m = String(href || "").match(/\/app\/user\/profile\/(\d+)/);
    id = m ? m[1] : "";
  }
  if (!id) return false;
  const dest = `/app/user/profile/${id}`;
  if (location.pathname === dest) return true;
  navigateX(dest);
  return true;
}

export function clickHomeTab() {
  navigateX("/app/bbs/home");
}

export function clickNativeLogin() {
  const btn = document.querySelector(".login-btn, .nav-actions button.login-btn");
  if (btn) { dispatchClick(btn); return true; }
  return false;
}

export function clickAnchorByPath(dest) {
  const a = document.querySelector(`a[href="${dest}"], a[href^="${dest}?"]`);
  if (a) { dispatchClick(a); return true; }
  return false;
}

/* —— 时间格式化 —— */
export function fmtStateTime(ts) {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(typeof ts === "number" && ts < 1e11 ? ts * 1000 : ts);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffSec = Math.floor((now - d) / 1000);
  if (diffSec >= 0 && diffSec < 60) return "刚刚";
  if (diffSec >= 60 && diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hh}:${mm}`;
  const qst = new Date(now);
  qst.setDate(now.getDate() - 2);
  if (d.toDateString() === qst.toDateString()) return `前天 ${hh}:${mm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 卡片底部的日期文本（"03-25" / "2025-12-27"） */
export function parseCardTime(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const now = new Date();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (d.getTime() - now.getTime() > 864e5 * 3) d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null;
}

/* —— 卡片数据提取 —— */
const CARD_LINK_SELECTOR = 'a.hb-cpt__bbs-content[href^="/app/bbs/link/"]';
const HISTORY_ITEM_SELECTOR = ".user-history__item";

function cardRoot(el) {
  if (!el) return null;
  if (el.matches?.(HISTORY_ITEM_SELECTOR)) return el;
  if (el.matches?.(CARD_LINK_SELECTOR)) return el;
  if (el.matches?.('a[href^="/app/bbs/link/"]')) return el;
  return el.closest?.(HISTORY_ITEM_SELECTOR) || el.closest?.(CARD_LINK_SELECTOR) || el.closest?.('a[href^="/app/bbs/link/"]') || null;
}

function textOf(el) {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

function attrOf(el, name) {
  return el?.getAttribute?.(name) || "";
}

/** 浏览历史条目：button.user-history__item（无链接、无 id，用标题+封面生成稳定 key） */
function extractHistoryItem(el) {
  const title = textOf(el.querySelector(".user-history__title"));
  const meta = textOf(el.querySelector(".user-history__meta"));
  const kind = textOf(el.querySelector(".user-history__image-corner"));
  const img = el.querySelector(".user-history__image img, .hb-cpt__image-elem");
  const cover = img?.currentSrc || img?.src || attrOf(img, "src");
  let h = 0;
  for (const ch of `${title}|${cover}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const id = `hist-${Math.abs(h).toString(36)}`;
  if (el.dataset) el.dataset.imHistId = id;
  return {
    id,
    href: "",
    name: "浏览历史",
    handle: "history",
    userId: "",
    profileHref: "",
    avatar: "",
    level: "",
    text: [title, meta].filter(Boolean).join("\n\n") || "浏览过的内容",
    photos: cover ? [cover] : [],
    images: cover ? [cover] : [],
    video: null,
    topicLabel: kind,
    likeCount: "",
    replyCount: "",
    rtCount: "",
    liked: false,
    retweeted: false,
    bookmarked: false,
    mine: false,
    author: { name: "浏览历史", handle: "history", avatar: "", userId: "", verified: false },
    datetime: "",
    time: meta || "",
    timeIso: "",
    stats: { reply: "", rt: "", like: "" },
    article: el,
    source: "history",
  };
}

/** 从卡片 DOM 提取标准帖子对象（与 IM 气泡字段对齐） */
export function extractTweet(article) {
  const el = cardRoot(article);
  if (!el) return null;
  if (isImNode(el)) return null;
  if (el.matches?.(HISTORY_ITEM_SELECTOR)) return extractHistoryItem(el);
  const href = attrOf(el, "href");
  const id = (href.match(/\/app\/bbs\/link\/(\d+)/) || [])[1] || "";
  if (!id) return null;

  const authorLink = el.querySelector('a.header__user[href*="/app/user/profile/"], a[href*="/app/user/profile/"]');
  const authorHref = attrOf(authorLink, "href");
  const userId = (authorHref.match(/\/app\/user\/profile\/(\d+)/) || [])[1] || "";
  const avatarImg = el.querySelector(".list-content__avatar img.hb-avatar__image, .hb-cpt-avatar img.hb-avatar__image, img.hb-avatar__image");
  const avatar = avatarImg?.currentSrc || avatarImg?.src || attrOf(avatarImg, "src");
  const name = textOf(el.querySelector(".list-content__username")) || "盒友";
  const level = textOf(el.querySelector(".list-content__level .hb-level-tag__inner__text, .hb-level-tag__inner__text"));
  const title = textOf(el.querySelector(".bbs-content__title"));
  const desc = textOf(el.querySelector(".bbs-content__content"));
  const text = [title, desc].filter(Boolean).join("\n\n");

  const photos = [];
  el.querySelectorAll(".bbs-content__imgs-wrapper img, .hb-cpt__image-elem").forEach((img) => {
    const src = img.currentSrc || img.src || attrOf(img, "src");
    if (src && !photos.includes(src)) photos.push(src);
  });

  const hasVideo = !!el.querySelector("video, [class*='video-play'], [class*='__video'], .bbs-content__video");
  const commentText = textOf(el.querySelector(".bbs-new-style-bottom__comment span:last-child, .content-list__comment-cnt, .content-list__comment span:last-child"));
  const likeText = textOf(el.querySelector(".bbs-new-style-bottom__like span:last-child, .content-list__like-cnt, .content-list__like span:last-child"));
  const topicLabel = textOf(el.querySelector(".bbs-new-style-bottom__rich-node, .content-tag-text"));
  const timeText = textOf(el.querySelector(".content-list__bottom-line--modify, .bbs-new-style-bottom__time"));
  const dateObj = parseCardTime(timeText);

  return {
    id,
    href: href || `/app/bbs/link/${id}`,
    name,
    handle: name,
    userId,
    profileHref: authorHref || (userId ? `/app/user/profile/${userId}` : ""),
    avatar,
    level,
    text: text || "分享了一个帖子",
    photos,
    images: photos,
    video: hasVideo ? { poster: photos[0] || "", src: "" } : null,
    topicLabel,
    likeCount: countIn(likeText),
    replyCount: countIn(commentText),
    rtCount: "",
    liked: false,
    retweeted: false,
    bookmarked: false,
    mine: isMeUserId(userId),
    author: { name, handle: name, avatar, userId, verified: false },
    datetime: dateObj ? dateObj.toISOString() : "",
    time: dateObj ? fmtStateTime(dateObj) : (timeText || ""),
    timeIso: dateObj ? dateObj.toISOString() : "",
    stats: { reply: commentText, rt: "", like: likeText },
    article: el,
    source: "link",
  };
}

export function allTweetArticles() {
  const out = [];
  const seen = new Set();
  const collect = (root) => {
    root.querySelectorAll(CARD_LINK_SELECTOR).forEach((a) => {
      if (isImNode(a)) return;
      if (a.closest(".related-recommend__container")) return;
      const href = attrOf(a, "href");
      if (!href || seen.has(href)) return;
      seen.add(href);
      out.push(a);
    });
  };
  const scopes = [
    ".hb-bbs-home",
    "#page-bbs-community",
    ".search-result__list",
    ".user-favour__list",
    ".user-profile__list",
    ".user-history__list",
    ".hb-cpt__scroll-list",
  ];
  for (const sel of scopes) document.querySelectorAll(sel).forEach(collect);
  if (!out.length) collect(document);
  // 浏览历史是 button.user-history__item（没有 <a>），单独收集
  document.querySelectorAll(HISTORY_ITEM_SELECTOR).forEach((el) => {
    if (isImNode(el)) return;
    if (!out.includes(el)) out.push(el);
  });
  return out;
}

export function findTweetArticle(linkId) {
  if (!linkId) return null;
  for (const a of document.querySelectorAll(`a[href^="/app/bbs/link/${linkId}"]`)) {
    if (!isImNode(a) && !a.closest(".related-recommend__container")) return a;
  }
  for (const el of document.querySelectorAll(HISTORY_ITEM_SELECTOR)) {
    if (el.dataset?.imHistId === String(linkId)) return el;
  }
  return null;
}

export function extractLinkFromRelated(a) {
  if (!a) return null;
  const href = attrOf(a, "href");
  const id = (href.match(/\/app\/bbs\/link\/(\d+)/) || [])[1] || "";
  if (!id) return null;
  const photos = [];
  a.querySelectorAll("img").forEach((img) => {
    const src = img.currentSrc || img.src || attrOf(img, "src");
    if (src && !photos.includes(src)) photos.push(src);
  });
  return {
    id,
    href: href || `/app/bbs/link/${id}`,
    name: textOf(a.querySelector(".list-content__username")) || "盒友",
    text: [textOf(a.querySelector(".link-item__title")), textOf(a.querySelector(".link-item__desc"))].filter(Boolean).join("\n\n"),
    photos,
  };
}

export function kickNativeVideo(article) {
  const v = article?.querySelector("video");
  if (v) {
    v.muted = true;
    v.pause();
  }
}

/* —— 个人主页 —— */
export function extractProfilePage() {
  const head = document.querySelector(".user-profile-user-head, .user-base-info, .user-profile-wrapper");
  if (!head) return null;
  const name = textOf(head.querySelector(".name-box .name, .name")) || "";
  const avatarImg = head.querySelector(".user-avatar img.hb-avatar__image, .hb-cpt-avatar img.hb-avatar__image");
  const avatar = avatarImg?.currentSrc || avatarImg?.src || attrOf(avatarImg, "src");
  const desc = textOf(head.querySelector(".desc"));
  const level = textOf(head.querySelector(".hb-level-tag__inner__text"));

  const stats = { following: "", followers: "", likesAndCollects: "" };
  document.querySelectorAll(".bbs-info .bbs-info-item").forEach((item) => {
    const value = textOf(item.querySelector(".value"));
    const label = textOf(item.querySelector(".label"));
    if (label.includes("关注")) stats.following = value;
    else if (label.includes("粉丝")) stats.followers = value;
    else if (label.includes("获赞") || label.includes("收藏")) stats.likesAndCollects = value;
  });

  const tabs = [];
  document.querySelectorAll(".tab-list--wrapper .tab-item").forEach((el, i) => {
    const label = textOf(el);
    if (label) tabs.push({ label, active: el.classList.contains("active"), index: i });
  });

  return {
    handle: userIdFromPath(),
    name,
    avatar,
    level,
    desc,
    bio: desc,
    following: stats.following,
    followers: stats.followers,
    likesAndCollects: stats.likesAndCollects,
    tabs,
    emptyText: "",
  };
}

/* —— 滚动容器与翻页 —— */
function findScrollableAncestor(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 50) return node;
    node = node.parentElement;
  }
  return null;
}

export function primaryColumn() {
  return document.querySelector(".hb-bbs-home, #page-bbs-community .hb-cpt__scroll-list, .hb-cpt__scroll-list");
}

export function loadMoreFeed() {
  const now = Date.now();
  if (now - (loadMoreFeed._t || 0) < 400) return;
  loadMoreFeed._t = now;
  const html = document.documentElement;
  html.classList.add("xim-feed-loading");

  // 小黑盒的 hb-cpt__scroll-list 有两种形态：
  // ① target=self → 内部容器滚动；② target=documentElement → 页面滚动（首页就是这种）。
  // 站点靠真实 scroll 事件 + 100ms 防抖决定是否 fetchNextPage，所以两条路都要喂到。
  const inner = findScrollableAncestor(document.querySelector(".bbs-home__content-list, .search-result__link, .user-favour__list a, .user-profile__list a, .user-history__item"));
  if (inner && inner.scrollHeight > inner.clientHeight + 10) {
    try {
      inner.scrollTop = inner.scrollHeight;
      inner.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch { /* ignore */ }
  }

  // 页面级滚动：必须真的改变 scrollTop，窗口才会收到 scroll 事件
  const se = document.scrollingElement || document.documentElement;
  try {
    if (se.scrollHeight > se.clientHeight + 10) se.scrollTop = se.scrollHeight;
  } catch { /* ignore */ }

  // 兜底：有些实现直接监听 window / document 的 scroll（派发到 window 才能命中 window 上的监听）
  try { window.dispatchEvent(new Event("scroll")); } catch { /* ignore */ }
  try { document.dispatchEvent(new Event("scroll")); } catch { /* ignore */ }

  window.clearTimeout(loadMoreFeed._unlock);
  loadMoreFeed._unlock = window.setTimeout(() => html.classList.remove("xim-feed-loading"), 500);
}

export function refreshHomeFeed() {
  window.scrollTo(0, 0);
  const btn = navButtonByText("社区");
  if (btn) dispatchClick(btn);
  else navigateX("/app/bbs/home");
}

/** 详情页评论区懒加载：把原生详情容器滚到底触发评论渲染 */
export function kickDetailScroller() {
  const box = document.querySelector(".hb-bbs-link__container");
  if (box && box.scrollHeight > box.clientHeight + 10) {
    try {
      box.scrollTop = box.scrollHeight;
      box.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch { /* ignore */ }
  }
  // 详情页同样是页面级滚动时，滚窗口才有效
  const se = document.scrollingElement || document.documentElement;
  try {
    if (se.scrollHeight > se.clientHeight + 10) se.scrollTop = se.scrollHeight;
  } catch { /* ignore */ }
  try { window.dispatchEvent(new Event("scroll")); } catch { /* ignore */ }
}

export function detailRoot() {
  return document.querySelector(".hb-bbs-link__content, .hb-bbs-link");
}

export function closeNativeDetail() {
  const back = document.querySelector(".hb-bbs-link .page-header__back-btn");
  if (back) dispatchClick(back);
}

export function currentDateLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
