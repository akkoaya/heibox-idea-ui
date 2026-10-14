// 小黑盒帖子流、详情与评论抓取层
// ① 被动监听站点自身的 XHR / fetch 响应（/bbs/app/feeds、/bbs/app/link/tree 等），
//    官方接口自带签名，我们只读不伪造，零风控；
// ② 接口没覆盖时退化到原生卡片 / 详情 DOM 抓取（详情页会自动滚到底触发评论区渲染）。

import {
  countIn, unwrap, pageWindow, extractTweet, findTweetArticle, findVueRouter,
  fmtStateTime, kickDetailScroller, linkIdFromPath, isImNode, navigateX, nativeUserId,
} from "./x-dom.js";
import { DEBUG_KEY } from "../config/constants.js";

/** 排查用日志：localStorage 里把 xhh-im-debug 设为 1 才输出 */
export function dbg(...args) {
  try {
    if (localStorage.getItem(DEBUG_KEY) !== "1") return;
    const text = args
      .map((a) => {
        if (a == null) return String(a);
        if (typeof a === "object") {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      })
      .join(" ");
    console.info(`[xhh-im:debug] ${text}`);
  } catch { /* ignore */ }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* —— 内存缓存：接口原始数据 —— */
const feedCache = new Map();   // linkid -> 标准化 pin
const treeCache = new Map();   // linkid -> { comments, total, t }
let capturedSearch = { q: "", items: [], t: 0 };

/* —— 详情 DOM 归属判定 ——
 * 点开新帖子时，原生详情容器里还是上一篇的内容（Vue 路由先切、数据后到），
 * 直接抓 DOM 会把上一篇的正文/评论挂到新帖上。这里在切帖瞬间记下「旧评论 id 基线」，
 * 只要 DOM 里还残留这些 id，就把它们从抓取结果里剔除；旧评论消失后自动解除。 */
const staleCommentIds = new Map(); // linkId -> Set(上一篇的评论 id)
const commentIdOwner = new Map();  // 评论 id -> 所属 linkId（接口数据里认得出来的那些）

function nativeCommentIdSet() {
  const ids = new Set();
  document
    .querySelectorAll(".link-comment__list [data-comment-id], .comment-children-item[data-comment-id]")
    .forEach((el) => {
      const id = el.getAttribute("data-comment-id");
      if (id) ids.add(id);
    });
  return ids;
}

function nativeDetailTitle() {
  return (document.querySelector(".link-section-title .section-title__content")?.textContent || "").trim();
}

function markStaleDetailDom(linkId) {
  const ids = nativeCommentIdSet();
  const title = nativeDetailTitle();
  if (ids.size) staleCommentIds.set(String(linkId), ids);
  return { ids, title };
}

function staleIdsFor(linkId) {
  const key = String(linkId);
  const set = staleCommentIds.get(key);
  if (!set) return null;
  const now = nativeCommentIdSet();
  let overlapped = false;
  for (const id of set) {
    if (now.has(id)) { overlapped = true; break; }
  }
  if (!overlapped) {
    staleCommentIds.delete(key); // 旧评论已被新帖内容替换
    return null;
  }
  return set;
}

/** 当前原生详情 DOM 里的评论到底属于哪个帖子（按已缓存的评论 id 反查） */
function domOwnerLinks() {
  const owners = new Set();
  for (const id of nativeCommentIdSet()) {
    const owner = commentIdOwner.get(String(id));
    if (owner) owners.add(owner);
  }
  return owners;
}

/** DOM 是否明确属于别的帖子：只认「已缓存评论 id」给出的铁证，避免时序误判 */
function domOwnedByOther(linkId) {
  const key = String(linkId);
  const owners = domOwnerLinks();
  if (!owners.size) return false;
  return !owners.has(key);
}

function stripTags(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 帖子正文：官方 link tree 的 text 是 JSON 富文本块（含 HTML），这里解成纯文本 */
function richTextOf(raw) {
  const t = unwrap(raw?.text);
  if (!t) return "";
  const fromBlocks = (arr) => (Array.isArray(arr) ? arr : [arr])
    .map((b) => stripTags(unwrap(b?.text) || ""))
    .filter(Boolean)
    .join("\n\n");
  if (typeof t === "string") {
    const s = t.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        return fromBlocks(JSON.parse(s));
      } catch { /* 非 JSON，按普通 HTML 处理 */ }
    }
    return stripTags(s);
  }
  if (Array.isArray(t)) return fromBlocks(t);
  if (typeof t === "object") return stripTags(unwrap(t.text) || "");
  return "";
}

/** 富文本块内嵌的图片（文章型帖子 link.imgs 常为空，图片藏在 HTML 里） */
function richImagesOf(raw) {
  const t = unwrap(raw?.text);
  const source = typeof t === "string" ? t : JSON.stringify(t || "");
  const out = [];
  const re = /(?:data-original|src)="(https?:[^"]+)"/g;
  let m;
  while ((m = re.exec(source))) {
    const url = m[1].replace(/\\\//g, "/");
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function isoOf(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" && ts < 1e11 ? ts * 1000 : ts);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function imgsOf(raw) {
  const list = raw?.imgs || raw?.thumbs || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((it) => (typeof it === "string" ? it : (it?.url || it?.thumb || it?.src || "")))
    .filter(Boolean);
}

function userOf(raw) {
  const u = unwrap(raw?.user) || {};
  return {
    id: String(unwrap(u.userid) || unwrap(raw?.userid) || ""),
    name: unwrap(u.username) || "盒友",
    avatar: unwrap(u.avatar) || unwrap(u.avartar) || "",
    level: unwrap(u.level_info?.level) || "",
  };
}

/** 官方接口的帖子对象 → IM 气泡对象 */
export function pinFromRawLink(raw, fallbackId = "") {
  if (!raw || typeof raw !== "object") return null;
  const id = String(unwrap(raw.linkid) || unwrap(raw.link_id) || unwrap(raw.id) || fallbackId || "");
  if (!id) return null;
  const user = userOf(raw);
  const title = stripTags(unwrap(raw.title));
  const body = richTextOf(raw) || stripTags(unwrap(raw.description));
  const photos = imgsOf(raw);
  for (const src of richImagesOf(raw)) {
    if (!photos.includes(src)) photos.push(src);
  }
  const ts = unwrap(raw.create_at) || unwrap(raw.modify_at);
  const topics = unwrap(raw.topics) || [];
  const topicLabel = Array.isArray(topics) && topics[0]
    ? (unwrap(topics[0].name) || unwrap(topics[0].topic_name) || "")
    : "";
  const topicList = (Array.isArray(topics) ? topics : [])
    .map((t) => ({
      id: String(unwrap(t.topic_id) || unwrap(t.id) || ""),
      name: String(unwrap(t.name) || unwrap(t.topic_name) || ""),
      icon: unwrap(t.pic_url) || "",
    }))
    .filter((t) => t.id && t.name);
  const hasVideo = !!(unwrap(raw.has_video) || /\.mp4|video/i.test(unwrap(raw.content_type) || ""));
  return {
    id,
    href: `/app/bbs/link/${id}`,
    name: user.name,
    handle: user.name,
    userId: user.id,
    profileHref: user.id ? `/app/user/profile/${user.id}` : "",
    avatar: user.avatar,
    level: user.level ? `Lv.${user.level}` : "",
    text: [title, body].filter(Boolean).join("\n\n") || "分享了一个帖子",
    photos,
    images: photos,
    video: hasVideo ? { poster: photos[0] || "", src: "" } : null,
    topicLabel,
    topics: topicList,
    likeCount: String(unwrap(raw.link_award_num) ?? unwrap(raw.up) ?? ""),
    replyCount: String(unwrap(raw.comment_num) ?? ""),
    rtCount: String(unwrap(raw.favour_count) ?? ""),
    liked: unwrap(raw.is_award_link) === 1,
    bookmarked: unwrap(raw.is_favour) === 1,
    retweeted: unwrap(raw.is_favour) === 1,
    following: unwrap(raw.follow_status) === 1,
    mine: !!nativeUserId() && String(nativeUserId()) === user.id,
    author: { name: user.name, handle: user.name, avatar: user.avatar, userId: user.id, verified: false },
    datetime: isoOf(ts),
    time: fmtStateTime(ts) || "",
    timeIso: isoOf(ts),
    stats: {
      reply: String(unwrap(raw.comment_num) ?? ""),
      rt: String(unwrap(raw.favour_count) ?? ""),
      like: String(unwrap(raw.link_award_num) ?? unwrap(raw.up) ?? ""),
      liked: unwrap(raw.is_award_link) === 1,
      bookmarked: unwrap(raw.is_favour) === 1,
    },
    source: "api",
  };
}

function rememberLinks(list) {
  if (!Array.isArray(list)) return;
  for (const item of list) {
    const raw = unwrap(item);
    if (!raw || typeof raw !== "object") continue;
    const pin = pinFromRawLink(raw);
    if (pin) feedCache.set(pin.id, pin);
  }
}

function rootCommentId(group) {
  const list = unwrap(group?.comment) || [];
  return String(unwrap(Array.isArray(list) ? list[0]?.commentid : "") || "");
}

/** 登记评论 id → 所属帖子，供 DOM 归属校验（切帖时 DOM 还挂着上一篇的评论就看这里） */
function registerCommentOwners(linkId, groups) {
  for (const group of Array.isArray(groups) ? groups : []) {
    const list = unwrap(group?.comment) || [];
    for (const c of Array.isArray(list) ? list : []) {
      const cid = String(unwrap(c?.commentid) || "");
      if (cid) commentIdOwner.set(cid, String(linkId));
    }
  }
}

/** 合并分页评论：同一楼的多页数据按根评论 id 归并，避免后一页把前一页覆盖掉 */
function mergeCommentGroups(prev, next) {
  const out = Array.isArray(prev) ? prev.slice() : [];
  const index = new Map(out.map((g, i) => [rootCommentId(g), i]));
  for (const group of Array.isArray(next) ? next : []) {
    const key = rootCommentId(group);
    if (key && index.has(key)) out[index.get(key)] = group;
    else out.push(group);
  }
  return out;
}

function rememberTree(payload, hintId, url = "") {
  const result = unwrap(payload?.result) || unwrap(payload);
  const link = unwrap(result?.link) || unwrap(result?.link_info);
  const pin = pinFromRawLink(link, hintId);
  const id = pin?.id || String(hintId || "");
  if (!id) return;
  if (pin) feedCache.set(id, pin);
  const prev = treeCache.get(id);
  const groups = unwrap(result?.comments);
  const merged = mergeCommentGroups(prev?.comments, groups);
  registerCommentOwners(id, merged);
  treeCache.set(id, {
    comments: merged,
    total: unwrap(result?.total_floor_num) ?? null,
    // has_more_floors > 0 表示后面还有分页评论
    hasMore: Number(unwrap(result?.has_more_floors) || 0) > 0,
    page: Number((String(url).match(/[?&]page=(\d+)/) || [])[1] || 0) || (prev?.page || 1),
    t: Date.now(),
  });
}

/** 评论树元信息：是否还有更多分页 / 已载入到第几页（供「到底了」判定） */
export function treeMeta(linkId) {
  const entry = treeCache.get(String(linkId));
  if (!entry) return null;
  return {
    total: entry.total ?? null,
    hasMore: !!entry.hasMore,
    page: entry.page || 1,
    loaded: entry.comments?.length || 0,
  };
}

/** 从任意搜索结果载荷里挑出帖子对象（字段随版本变化，做宽松兜底） */
function linksFromSearchPayload(data) {
  const out = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    const raw = unwrap(node);
    if (raw && typeof raw === "object") {
      if (raw.linkid || raw.link_id) out.push(raw);
      else if (raw.link_info && (raw.link_info.linkid || raw.link_info.link_id)) out.push(unwrap(raw.link_info));
      else if (raw.link && (raw.link.linkid || raw.link.link_id)) out.push(unwrap(raw.link));
    }
    for (const v of Object.values(raw || {})) {
      if (v && typeof v === "object") visit(v, depth + 1);
    }
  };
  visit(data, 0);
  return out;
}

/* —— 被动捕获官方接口响应 —— */
export function installApiCapture() {
  try {
    const win = pageWindow();
    if (win.__xhhImHooked) return;
    win.__xhhImHooked = true;

    const isFeedUrl = (url) => /\/bbs\/app\/(feeds|topic\/feeds)/.test(url);
    const isTreeUrl = (url) => /\/bbs\/app\/link\/tree/.test(url);
    const isSearchUrl = (url) => /\/bbs\/app\/api\/(general\/search|search\/)/.test(url);

    const handleBody = (url, text) => {
      let data;
      try { data = typeof text === "string" ? JSON.parse(text) : text; } catch { return; }
      const result = data?.result ?? data;
      if (isFeedUrl(url)) {
        rememberLinks(unwrap(result?.links) || unwrap(result?.link_infos) || unwrap(result?.feeds) || []);
        rememberLinks(unwrap(result?.related_links?.link_infos) || []);
      } else if (isTreeUrl(url)) {
        const m = String(url).match(/[?&]link_id=(\d+)/);
        rememberTree(data, m ? m[1] : "", url);
      } else if (isSearchUrl(url)) {
        const items = linksFromSearchPayload(result).map((raw) => pinFromRawLink(raw)).filter(Boolean);
        if (items.length) {
          rememberLinks(items);
          capturedSearch = { q: capturedSearch.q || "", items, t: Date.now() };
        }
      }
      // 相关推荐接口也顺带缓存，供抽屉里点“相似内容”直接开帖
      if (result?.related_links?.link_infos) rememberLinks(result.related_links.link_infos);
    };

    const proto = win.XMLHttpRequest?.prototype;
    if (proto) {
      const origOpen = proto.open;
      const origSend = proto.send;
      proto.open = function (method, url, ...rest) {
        this.__xhhUrl = String(url || "");
        return origOpen.call(this, method, url, ...rest);
      };
      proto.send = function (body, ...rest) {
        const url = this.__xhhUrl || "";
        if (isFeedUrl(url) || isTreeUrl(url) || isSearchUrl(url)) {
          this.addEventListener("load", () => {
            try {
              const text = this.responseType === "" || this.responseType === "text" ? this.responseText : JSON.stringify(this.response);
              handleBody(url, text);
            } catch { /* ignore */ }
          });
          if (isSearchUrl(url)) {
            try {
              const parsed = JSON.parse(body || "{}");
              capturedSearch.q = String(parsed.q || parsed.query || parsed.keyword || capturedSearch.q || "");
            } catch { /* ignore */ }
          }
        }
        return origSend.call(this, body, ...rest);
      };
    }

    const origFetch = win.fetch;
    if (typeof origFetch === "function") {
      win.fetch = function (input, _init) {
        const url = typeof input === "string" ? input : (input?.url || "");
        const p = origFetch.apply(this, arguments);
        if (isFeedUrl(url) || isTreeUrl(url) || isSearchUrl(url)) {
          p.then((res) => {
            try {
              res.clone().text().then((text) => handleBody(url, text)).catch(() => {});
            } catch { /* ignore */ }
          }).catch(() => {});
        }
        return p;
      };
    }
  } catch { /* ignore */ }
}

export function feedPinById(linkId) {
  return feedCache.get(String(linkId)) || null;
}

/** 已缓存的帖子（信息流 / 搜索 / 详情接口顺带存下来的），供搜索弹层即时检索 */
export function cachedFeedPins() {
  return Array.from(feedCache.values());
}

/** 已缓存帖子关联的话题（去重，带 topic_id 便于直达话题流） */
export function cachedTopics() {
  const map = new Map();
  for (const pin of feedCache.values()) {
    for (const t of pin.topics || []) {
      if (!map.has(t.id)) map.set(t.id, t);
    }
  }
  return Array.from(map.values());
}

export function getCapturedSearch(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  if (capturedSearch.q && !capturedSearch.q.includes(q) && !q.includes(capturedSearch.q)) return [];
  return capturedSearch.items;
}

/* —— 评论 —— */
function commentFromRaw(raw, repliedTo) {
  const c = unwrap(raw);
  if (!c || typeof c !== "object") return null;
  const user = unwrap(c.user) || {};
  const text = stripTags(unwrap(c.text) || unwrap(c.content) || "");
  const pictures = unwrap(c.pictures) || unwrap(c.imgs) || [];
  const photos = (Array.isArray(pictures) ? pictures : [])
    .map((p) => (typeof p === "string" ? p : (p?.url || "")))
    .filter(Boolean);
  if (!text && !photos.length) return null;
  const uid = String(unwrap(user.userid) || unwrap(c.userid) || "");
  const name = unwrap(user.username) || "盒友";
  const ts = unwrap(c.create_at) || unwrap(c.create_time);
  const timeText = fmtStateTime(ts) || "";
  const ip = unwrap(c.ip_location) || "";
  const target = repliedTo || "";
  return {
    id: String(unwrap(c.commentid) || unwrap(c.comment_id) || Math.random()),
    name,
    handle: name,
    userId: uid,
    profileHref: uid ? `/app/user/profile/${uid}` : "",
    avatar: unwrap(user.avatar) || unwrap(user.avartar) || "",
    text,
    photos,
    time: [timeText, ip ? `IP:${ip}` : ""].filter(Boolean).join(" · ") || "",
    likeCount: unwrap(c.up) ? String(unwrap(c.up)) : "",
    liked: unwrap(c.is_support) === 1,
    repliedTo: target,
    replyTo: target,
    replyRef: target ? { handle: target, href: "", snippet: "" } : null,
    isSub: !!target,
    href: "",
  };
}

/** 接口评论树 → 扁平 IM 气泡（主评 + 楼中楼） */
export function commentsFromTree(linkId) {
  const entry = treeCache.get(String(linkId));
  if (!entry?.comments?.length) return [];
  const out = [];
  for (const group of entry.comments) {
    const list = unwrap(group?.comment) || unwrap(group) || [];
    if (!Array.isArray(list) || !list.length) continue;
    const root = commentFromRaw(list[0], "");
    if (root) out.push(root);
    for (let i = 1; i < list.length; i++) {
      const child = commentFromRaw(list[i], root?.name || "");
      if (child) out.push(child);
    }
  }
  return out;
}

/** 详情 DOM 评论树 → 扁平 IM 气泡（接口没抓到时的兜底） */
export function harvestCommentsFromDom(container = document, excludeIds = null) {
  const skip = excludeIds instanceof Set ? excludeIds : null;
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    // 切换帖子时原生 DOM 还是上一篇的评论：按 id 基线与新帖评论的 id 天然不重叠，这里直接剔除
    if (skip && item.id && skip.has(String(item.id))) return;
    const key = item.id && !item.id.startsWith("0.") ? item.id : `${item.name}|${item.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  container.querySelectorAll(".link-comment__list .link-comment__comment-item").forEach((root) => {
    const id = root.getAttribute("data-comment-id") || "";
    const nameEl = root.querySelector(".info-box__username");
    const name = (nameEl?.textContent || "").trim() || "盒友";
    const href = nameEl?.getAttribute("href") || "";
    const uid = (href.match(/\/app\/user\/profile\/(\d+)/) || [])[1] || "";
    const avatarImg = root.querySelector(".comment-item-header__avatar img.hb-avatar__image, .comment-item-header__avatar img");
    const likeBtn = root.querySelector(".comment-item-header__operation-box .like-box");
    const rootItem = {
      id,
      name,
      handle: name,
      userId: uid,
      profileHref: href,
      avatar: avatarImg?.currentSrc || avatarImg?.src || "",
      text: (root.querySelector(".comment-item__content")?.textContent || "").trim(),
      photos: Array.from(root.querySelectorAll(".comment-item__image-box img, .comment-item__image img")).map((i) => i.src).filter(Boolean),
      time: [(root.querySelector(".info-box__create-time")?.textContent || "").trim(), (root.querySelector(".info-box__ip")?.textContent || "").trim()].filter(Boolean).join(" "),
      likeCount: countIn(likeBtn?.querySelector(".like-box__cnt")?.textContent || ""),
      liked: likeBtn?.classList.contains("active") || false,
      repliedTo: "",
      isSub: false,
      href: "",
    };
    push(rootItem);
    root.querySelectorAll(".comment-children-item").forEach((child) => {
      const cNameEl = child.querySelector(".children-item__comment-creator");
      const cHref = cNameEl?.getAttribute("href") || "";
      const cUid = (cHref.match(/\/app\/user\/profile\/(\d+)/) || [])[1] || "";
      const cName = (cNameEl?.textContent || "").trim() || "盒友";
      push({
        id: child.getAttribute("data-comment-id") || "",
        name: cName,
        handle: cName,
        userId: cUid,
        profileHref: cHref,
        avatar: "",
        text: (child.querySelector(".children-item__comment-content")?.textContent || "").trim(),
        photos: [],
        time: [(child.querySelector(".children-item__create-time")?.textContent || "").trim(), (child.querySelector(".children-item__ip")?.textContent || "").trim()].filter(Boolean).join(" "),
        likeCount: "",
        liked: false,
        repliedTo: rootItem.name,
        isSub: true,
        href: "",
      });
    });
  });
  return out;
}

export function collectNoteComments(linkId, container = document) {
  const map = new Map();
  const treeList = commentsFromTree(linkId);
  let domCount = 0;
  for (const c of treeList) {
    const k = c.id || `${c.name}|${c.text}`;
    map.set(k, c);
  }
  // DOM 归属校验：当原生容器里明确是「别的帖子」的评论（评论 id 在缓存里归属其它帖子）时整段丢弃
  const domIsForeign = domOwnedByOther(linkId);
  if (!domIsForeign) {
    for (const c of harvestCommentsFromDom(container, staleIdsFor(linkId))) {
      const owner = c.id ? commentIdOwner.get(String(c.id)) : "";
      if (owner && owner !== String(linkId)) continue; // 逐条兜底：单条评论也能认出是别人家的
      domCount++;
      const k = c.id || `${c.name}|${c.text}`;
      const prev = map.get(k);
      map.set(k, prev ? { ...prev, ...c, avatar: c.avatar || prev.avatar } : c);
    }
  }
  const out = Array.from(map.values()).filter((c) => (c.text && c.text.trim()) || (c.photos && c.photos.length));
  dbg("collect", {
    linkId: String(linkId),
    tree: treeList.length,
    dom: domCount,
    domForeign: domIsForeign,
    domOwners: [...domOwnerLinks()],
    total: out.length,
  });
  return out;
}

/* —— 详情 DOM 兜底提取 —— */
function pinFromDetailDom(linkId) {
  const root = document.querySelector(".hb-bbs-link__content, .hb-bbs-link");
  if (!root) return null;
  const title = (root.querySelector(".link-section-title .section-title__content")?.textContent || "").trim();
  const userLink = root.querySelector('a.link-user__user-wrapper[href*="/app/user/profile/"]');
  const uid = (userLink?.getAttribute("href")?.match(/\/app\/user\/profile\/(\d+)/) || [])[1] || "";
  const name = (root.querySelector(".link-user__username")?.textContent || "").trim();
  const avatarImg = root.querySelector(".link-user__user-wrapper img.hb-avatar__image");
  const bodyEl = root.querySelector(".post__content .hb-article, .post__content");
  const body = (bodyEl?.innerText || "").trim().slice(0, 4000);
  const photos = [];
  root.querySelectorAll(".img-media img.img-item, .header-image__item-image").forEach((img) => {
    const src = img.currentSrc || img.src;
    if (src && !photos.includes(src)) photos.push(src);
  });
  const bar = root.closest(".hb-bbs-link")?.querySelector(".link-reply__operation-box")
    || document.querySelector(".link-reply__operation-box");
  const likeBtn = bar?.querySelector('button.link-reply__operation-item:not(.hb-cpt__favour-btn)');
  const favourBtn = bar?.querySelector("button.hb-cpt__favour-btn");
  const commentBtn = bar?.querySelector(".link-reply__comment-tooltip button");
  const timeText = (root.querySelector(".link-data__time")?.textContent || "").trim();
  const ip = (root.querySelector(".link-data__ip")?.textContent || "").trim();
  return {
    id: String(linkId || ""),
    href: `/app/bbs/link/${linkId}`,
    name: name || "盒友",
    handle: name || "盒友",
    userId: uid,
    profileHref: userLink?.getAttribute("href") || "",
    avatar: avatarImg?.currentSrc || avatarImg?.src || "",
    level: (root.querySelector(".link-user__level-tag .hb-level-tag__inner__text")?.textContent || "").trim(),
    text: [title, body].filter(Boolean).join("\n\n") || "分享了一个帖子",
    photos,
    images: photos,
    video: root.querySelector("video") ? { poster: photos[0] || "", src: "" } : null,
    topicLabel: (root.querySelector(".link-tags__tag-item .content-tag-text")?.textContent || "").trim(),
    likeCount: countIn(likeBtn?.querySelector(".link-reply__operation-desc")?.textContent || ""),
    replyCount: countIn(commentBtn?.querySelector(".link-reply__operation-desc")?.textContent || ""),
    rtCount: countIn(favourBtn?.querySelector(".link-reply__operation-desc")?.textContent || ""),
    liked: likeBtn?.classList.contains("active") || false,
    bookmarked: favourBtn?.classList.contains("active") || false,
    retweeted: favourBtn?.classList.contains("active") || false,
    following: (document.querySelector(".link-user__follow-btn, .page-header__follow-btn")?.textContent || "").includes("已关注"),
    mine: !!nativeUserId() && nativeUserId() === uid,
    author: { name, handle: name, avatar: avatarImg?.src || "", userId: uid, verified: false },
    datetime: "",
    time: [timeText, ip].filter(Boolean).join(" "),
    timeIso: "",
    stats: { reply: "", rt: "", like: "" },
    source: "detail-dom",
  };
}

function openNativeDetail(linkId) {
  const current = linkIdFromPath();
  if (current === String(linkId)) {
    kickDetailScroller();
    return;
  }
  const card = findTweetArticle(linkId);
  if (card) {
    card.click();
    return;
  }
  const router = findVueRouter();
  const dest = `/app/bbs/link/${linkId}`;
  if (router && typeof router.push === "function") {
    try { router.push(dest); return; } catch { /* fall through */ }
  }
  navigateX(dest);
}

/** 打开帖子详情：先给内存/卡片里的即时数据，再驱动原生详情页补全正文与评论 */
export async function fetchTweetDetail(linkId) {
  if (!linkId) return null;
  const switching = linkIdFromPath() !== String(linkId);
  // 切帖：先记下原生 DOM 里上一篇的评论/标题基线，避免把上一篇内容当成本帖数据
  const prev = switching ? markStaleDetailDom(linkId) : { ids: new Set(), title: "" };
  const prevTitle = prev.title;
  dbg("fetch-detail:start", {
    linkId: String(linkId),
    switching,
    route: location.pathname,
    baselineComments: prev.ids.size,
    prevTitle: prevTitle.slice(0, 20),
    domOwners: [...domOwnerLinks()],
  });
  let pin = feedPinById(linkId) || (findTweetArticle(linkId) ? extractTweet(findTweetArticle(linkId)) : null);
  let replies = collectNoteComments(linkId);

  const alreadyOpen = linkIdFromPath() === String(linkId);
  const hasTree = treeCache.has(String(linkId));
  if (!alreadyOpen) openNativeDetail(linkId);

  const maxRounds = hasTree && pin ? 4 : 20;
  for (let i = 0; i < maxRounds; i++) {
    await sleep(i < 4 ? 120 : 220);
    if (i % 4 === 2) kickDetailScroller();
    const apiPin = feedPinById(linkId);
    if (apiPin) pin = apiPin;
    // 正文同理：只有原生详情的标题已经不是上一篇的了，才认 DOM 抓出来的正文
    const titleNow = nativeDetailTitle();
    if ((!prevTitle || (titleNow && titleNow !== prevTitle)) && !domOwnedByOther(linkId)) {
      const domPin = pinFromDetailDom(linkId);
      if (domPin && (!pin || (pin.text || "").length < (domPin.text || "").length)) pin = domPin;
    }
    replies = collectNoteComments(linkId);
    if (pin && replies.length && treeCache.has(String(linkId))) break;
    if (pin && replies.length && i >= 6) break;
    if (pin && !replies.length && i >= 12 && treeCache.has(String(linkId))) break;
  }

  if (!pin) {
    const card = findTweetArticle(linkId);
    if (card) pin = extractTweet(card);
  }
  if (!pin) return null;
  dbg("fetch-detail:done", {
    linkId: String(linkId),
    pinId: pin.id,
    pinSource: pin.source,
    replies: replies.length,
    firstReply: replies[0]?.text?.slice(0, 20) || "",
  });
  return { pin, replies, commentsPending: !replies.length };
}

/** 搜索流：接口被动捕获优先，其次当前原生搜索页 DOM */
export async function fetchSearchTimeline(query) {
  const captured = getCapturedSearch(query);
  if (captured.length) return captured;
  const out = [];
  for (const a of document.querySelectorAll('.search-result__list a.hb-cpt__bbs-content[href^="/app/bbs/link/"]')) {
    if (isImNode(a)) continue;
    const t = extractTweet(a);
    if (t) out.push(t);
  }
  return out;
}

/* —— 评论展开 / 分页 —— */
function commentMoreButtons() {
  const out = [];
  document.querySelectorAll(".comment-children__load-all, .link-comment__load-more, .link-comment [class*='load-more'], .link-comment [class*='show-more']").forEach((el) => {
    if (isImNode(el)) return;
    out.push(el);
  });
  return out;
}

export function expandCommentRound() {
  kickDetailScroller();
  let n = 0;
  for (const b of commentMoreButtons()) {
    try { b.click(); n++; } catch { /* ignore */ }
  }
  return n;
}

export async function expandAllComments() {
  let clicked = 0;
  let idle = 0;
  for (let round = 0; round < 16; round++) {
    const n = expandCommentRound();
    clicked += n;
    if (!n) {
      idle++;
      if (idle >= 3) break;
    } else idle = 0;
    await sleep(420);
  }
  return clicked;
}

export async function loadMoreComments(linkId) {
  expandCommentRound();
  await sleep(360);
  expandCommentRound();
  return collectNoteComments(linkId);
}

/* —— 导出 —— */
export function downloadNoteCommentsAsTxt(pin, replies) {
  if (!pin) return;
  const postUrl = `${location.origin}${pin.href || `/app/bbs/link/${pin.id}`}`;
  const title = (pin.text || "").split("\n")[0] || pin.name || "无标题";
  let exportText = `帖子链接: ${postUrl}\n\n`;
  exportText += `帖子标题: ${title}\n`;
  exportText += `作者: ${pin.name || pin.author?.name || "未知作者"}\n`;
  exportText += `发布时间: ${pin.time || "未知"}\n\n`;
  exportText += `帖子内容:\n${pin.text || "无"}\n\n`;
  exportText += "==================== 评论区 ====================\n\n";
  if (!replies || !replies.length) {
    exportText += "当前帖子没有评论。\n";
  } else {
    replies.forEach((comment, index) => {
      const tag = comment.repliedTo ? `  -> [回复 @${comment.repliedTo}]` : `【${index + 1}楼】`;
      exportText += `${tag} ${comment.name} (点赞: ${comment.likeCount || 0})\n`;
      exportText += `时间: ${comment.time || ""}\n`;
      exportText += `内容: ${comment.text}\n`;
      exportText += "----------------------------------------\n\n";
    });
  }
  const filename = `${(pin.name || "小黑盒帖子").replace(/[\\/:*?"<>|]/g, "_")}_评论区.txt`;
  const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/* 旧接口保留：视频直链 / 翻译在小黑盒场景不需要 */
export function posterVideoSrc() { return ""; }
export async function requestXTranslation(text) { return text; }
