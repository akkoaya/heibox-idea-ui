import { PINNED } from "../config/constants.js";
import { getChatId } from "../state/prefs.js";

export function routeKind(pathname = location.pathname) {
  const p = pathname.replace(/\/$/, "") || "/";
  // 帖子详情：/app/bbs/link/{linkId}
  if (/^\/app\/bbs\/link\/\d+/.test(p)) return "note";
  // 社区首页与话题流都算信息流列表
  if (p === "/app/bbs/home" || p === "/app/bbs" || p === "/app" || p === "/") return "explore";
  if (/^\/app\/topic\/(link|game)(\/|$)/.test(p)) return "topic";
  if (/^\/app\/user\/profile(\/|$)/.test(p)) return "profile";
  if (/^\/app\/search(\/list)?$/.test(p)) return "search";
  if (/^\/app\/user\/favour(\/|$)/.test(p)) return "bookmark";
  if (/^\/app\/user\/history$/.test(p)) return "history";
  // 发布/创作者中心/开放平台等站点页面：只保留 rail，不套 IM 三栏
  if (/^\/(creator|open|mall|game|account|pubg|web_share|web_with_native|message)/.test(p)) return "other";
  return "explore";
}

export function chatIdFromRoute() {
  const kind = routeKind();
  if (kind === "explore") return "home";
  if (kind === "topic") return "topic";
  if (kind === "search") return "search";
  if (kind === "profile") return "profile";
  if (kind === "bookmark") return "favour";
  if (kind === "history") return "history";
  // 帖子详情走右侧抽屉，中栏 chatId 保持原场景不变
  return getChatId() || "home";
}

export function pinnedById(id) {
  return PINNED.find((c) => c.id === id) || PINNED[0];
}

export function patchHistory(onChange) {
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const ret = original.apply(this, args);
      onChange();
      return ret;
    };
  }
  window.addEventListener("popstate", onChange);
}
