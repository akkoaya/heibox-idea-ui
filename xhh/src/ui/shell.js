import { currentSkinId, SKINS } from "../config/skins.js";
import { isMaskAvatar, isHideMedia } from "../state/prefs.js";
import { ROOT_CLASS, LOCK_CLASS } from "../config/constants.js";
import { ensureTitlebar } from "./titlebar.js";
import { ensureRail, highlightRail, isRailCollapsed, applyRailCollapseState } from "./rail.js";
import { ensureListPanel } from "./list-panel.js";
import { ensureChatPanel, resetChatMessages } from "./chat-panel.js";
import { ensureStrip } from "./strip.js";
import { bindSkinButtons } from "./skin-menu.js";
import { makeFavicon } from "../theme/favicon.js";
import { applyColorMode } from "../theme/color-mode.js";
import { pinnedById, chatIdFromRoute } from "../bridge/router.js";
import { displayTitle } from "./avatars.js";
import { getChatId } from "../state/prefs.js";

export function applyRootAttrs() {
  const html = document.documentElement;
  const skin = currentSkinId();
  html.classList.add(ROOT_CLASS, LOCK_CLASS);
  html.setAttribute("data-xim-skin", skin);
  html.setAttribute("data-xim-mask", isMaskAvatar() ? "1" : "0");
  html.classList.toggle("im-hide-media", isHideMedia());
  applyColorMode();
  const s = SKINS[skin];
  // 钉钉宽条模式：rail 展开时用宽条宽度，窄条（默认）用皮肤宽度
  const railW = s.compact && !isRailCollapsed() ? Math.max(168, s.railWidth) : s.railWidth;
  html.style.setProperty("--im-nav", railW + "px");
  html.style.setProperty("--im-list", s.listWidth + "px");
  html.style.setProperty("--im-header-h", s.titlebarHeight + "px");
  html.style.setProperty("--im-strip", (s.stripWidth || 0) + "px");
  html.style.setProperty("--im-nav2w", "0px");
}

export function clearRootAttrs() {
  const html = document.documentElement;
  html.classList.remove(ROOT_CLASS, LOCK_CLASS, "im-hide-media");
  html.removeAttribute("data-xim-skin");
  html.removeAttribute("data-xim-dark");
  html.removeAttribute("data-xim-mask");
}

export function ensureShell() {
  applyRootAttrs();
  ensureTitlebar();
  ensureRail();
  applyRailCollapseState();
  ensureStrip();
  highlightRail();
  ensureListPanel();
  ensureChatPanel();
  bindSkinButtons();
  makeFavicon();
  syncTitle();
}

export function removeShell() {
  document.querySelector(".im-titlebar")?.remove();
  document.querySelector(".im-rail")?.remove();
  document.querySelector(".im-strip")?.remove();
  document.querySelector(".im-list-panel")?.remove();
  document.querySelector(".im-chat-panel")?.remove();
  document.querySelector(".xim-skin-menu")?.remove();
  clearRootAttrs();
}

export function syncTitle() {
  if (!document.documentElement.classList.contains(ROOT_CLASS)) return;
  const skin = SKINS[currentSkinId()];
  const id = getChatId() || chatIdFromRoute();
  if (String(id).startsWith("user:")) {
    document.title = `${id.slice(5)} - ${skin.label}`;
    return;
  }
  if (id === "search") {
    const q = new URLSearchParams(location.search).get("q") || new URLSearchParams(location.search).get("keyword") || "";
    document.title = `${q ? `搜索: ${q}` : "搜索"} - ${skin.label}`;
    return;
  }
  if (id === "favour") { document.title = `我的收藏 - ${skin.label}`; return; }
  if (id === "history") { document.title = `浏览历史 - ${skin.label}`; return; }
  if (id === "topic") { document.title = `社区话题 - ${skin.label}`; return; }
  const pin = pinnedById(id.startsWith("note:") ? "home" : id);
  const name = displayTitle("pin:" + pin.id, pin.name);
  document.title = `${name} - ${skin.label}`;
}

export { resetChatMessages };
