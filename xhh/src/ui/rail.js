import { ICONS, getSkinIcon } from "../config/icons.js";
import { currentSkinId, SKINS, getOrgName, setOrgName } from "../config/skins.js";
import { ORG_ICON_KEY, RAIL_COLLAPSE_KEY } from "../config/constants.js";
import { nativeAvatarSrc, nativeProfilePath, nativeDisplayName, navigateX, navigateSearch } from "../bridge/x-dom.js";
import { routeKind } from "../bridge/router.js";
import { isDarkEffective, toggleColorTheme } from "../theme/color-mode.js";
import { setChatId } from "../state/prefs.js";
import { escapeHtml } from "../utils/html.js";
import { toast } from "./toast.js";
import { personAvatarHtml } from "./avatars.js";
import { resetChatMessages } from "./chat-panel.js";
import { bindSearchTrigger, openSearchPopup } from "./search-popup.js";

/* —— 团队图标 / 侧栏收起（对齐 linux.do IM 版） —— */
export function getOrgIcon() {
  try { return localStorage.getItem(ORG_ICON_KEY) || ""; } catch { return ""; }
}

export function setOrgIcon(v) {
  try { localStorage.setItem(ORG_ICON_KEY, v || ""); } catch { /* ignore */ }
}

function orgLogoHtml(skin) {
  const icon = getOrgIcon();
  if (/^(https?:\/\/|data:image)/i.test(icon)) return `<img src="${escapeHtml(icon)}" alt="">`;
  const text = [...(icon || skin.letter)].slice(0, 2).join("");
  return escapeHtml(text || skin.letter);
}

export function isRailCollapsed() {
  const dflt = !!SKINS[currentSkinId()].compact; // 钉钉默认窄条，飞书/企微默认宽条
  try {
    const v = localStorage.getItem(RAIL_COLLAPSE_KEY);
    return v === null ? dflt : v === "1";
  } catch { return dflt; }
}

export function setRailCollapsed(collapsed) {
  try { localStorage.setItem(RAIL_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  applyRailCollapseState();
}

/** 按当前皮肤把「窄条/宽条」落实到 rail 与 CSS 变量上（复刻 linux.do IM 的收起逻辑） */
export function applyRailCollapseState() {
  const html = document.documentElement;
  const rail = document.querySelector(".im-rail");
  const skin = SKINS[currentSkinId()];
  const collapsed = isRailCollapsed();

  if (skin.compact) {
    // 钉钉：窄条 = 56px 纯图标；展开 = 宽条 图标 + 文字
    rail?.classList.toggle("im-rail-compact", collapsed);
    html.classList.remove("im-rail-collapsed");
    html.style.setProperty("--im-nav", `${collapsed ? skin.railWidth : Math.max(168, skin.railWidth)}px`);
  } else {
    // 飞书 / 企微：收起成 68px 大图标 + 小字（core-extra 的 .im-rail-collapsed）
    rail?.classList.remove("im-rail-compact");
    html.classList.toggle("im-rail-collapsed", collapsed);
    html.style.removeProperty("--im-nav");
  }

  const btn = document.querySelector(".im-rail-collapse");
  if (btn) {
    const label = btn.querySelector("span");
    if (label) label.textContent = collapsed ? "展开" : "收起";
    btn.title = collapsed ? "展开侧栏" : "收起侧栏";
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

/** 侧栏收起/展开按钮（复刻 linux.do IM 的 .im-rail-collapse） */
export function ensureRailFold(bottom) {
  if (!bottom || bottom.querySelector(".im-rail-collapse")) return;
  const collapse = isRailCollapsed();
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "im-rail-item im-rail-collapse";
  fold.innerHTML = `${ICONS.chevronsLeft}<span>${collapse ? "展开" : "收起"}</span>`;
  fold.title = collapse ? "展开侧栏" : "收起侧栏";
  fold.setAttribute("aria-expanded", collapse ? "false" : "true");
  fold.addEventListener("click", () => setRailCollapsed(!isRailCollapsed()));
  bottom.appendChild(fold);
}

function railIcon(key) {
  return getSkinIcon(key);
}

function itemHtml(it, active) {
  const icon = railIcon(it.icon);
  return `<div class="im-rail-item${active ? " active" : ""}" data-key="${it.key}" data-path="${it.path || ""}"${it.dynamic ? ` data-dynamic="${it.dynamic}"` : ""} role="button" tabindex="0">
    ${icon}<span>${it.label}</span>
    ${it.dot ? '<i class="im-rail-dot"></i>' : ""}
    <span class="im-rail-badge" hidden></span>
  </div>`;
}

function activeKey() {
  const kind = routeKind();
  if (kind === "search") return "search";
  if (kind === "bookmark") return "favour";
  if (kind === "history") return "history";
  if (kind === "profile") return "profile";
  return "home";
}

export function ensureRail() {
  const skin = SKINS[currentSkinId()];
  let rail = document.querySelector(".im-rail");
  if (!rail) {
    rail = document.createElement("nav");
    rail.className = "im-rail";
    rail.setAttribute("aria-label", "IM 导航");
    (document.body || document.documentElement).appendChild(rail);
  }
  rail.classList.toggle("im-rail-compact", !!skin.compact);
  const src = nativeAvatarSrc();
  const uname = nativeDisplayName();
  const org = getOrgName();
  const on = activeKey();

  const meHeadAva = personAvatarHtml("im-rail-me-ava", uname, src, "me", true);
  const head = skin.groups
    ? `<div class="im-rail-head">
        <span class="im-rail-me">${meHeadAva}<span class="im-rail-avatar-badge" hidden></span></span>
        <span class="im-rail-user-name">${escapeHtml(uname)}</span>
      </div>`
    : currentSkinId() === "feishu"
    ? `<div class="im-rail-head">
        <div class="im-rail-avatar-wrap">
          <div class="im-rail-avatar">${meHeadAva}</div>
          <span class="im-rail-avatar-badge" hidden></span>
        </div>
      </div>`
    : `<div class="im-rail-head">
        <div class="im-rail-org-chip">
          <span class="im-rail-org-logo" title="点击更换图标（1~2 个字 / emoji / 图片 URL）">${orgLogoHtml(skin)}</span>
          <span class="im-rail-org-name" title="点击修改团队名称">${escapeHtml(org)}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </div>
      </div>`;

  const real = skin.real.map((it) => itemHtml(it, it.key === on)).join("");
  const deco = skin.deco.map((it) => itemHtml(it, false)).join("");
  // 宽 rail（飞书/企微）：搜索框放在「发现」上方；窄 rail（钉钉 56px）放不下，留在列表头部
  const kw = routeKind() === "search"
    ? (new URLSearchParams(location.search).get("q") || new URLSearchParams(location.search).get("keyword") || "")
    : "";
  const search = skin.compact
    ? ""
    : `<div class="im-rail-search">${ICONS.search}<input class="im-rail-search-input" type="text" placeholder="搜索帖子" value="${escapeHtml(kw)}" /></div>`;
  const groups = skin.groups
    ? `<div class="im-rail-groups"><div class="im-rail-group-title"><span>分组</span></div>
        ${[["unread","未读","mail"],["at","@我","at"],["single","单聊","user"],["group","群聊","msg"],["marked","标记","bookmark"]].map(([k,l,i]) =>
          `<div class="im-rail-item" data-group="${k}" role="button">${ICONS[i] || ICONS.msg}<span>${l}</span></div>`
        ).join("")}
      </div>`
    : "";

  const bottomActions = skin.actions === "rail-bottom"
    ? `<div class="im-rail-item im-dark-toggle" role="button">${isDarkEffective() ? ICONS.sun : ICONS.moon}<span>${isDarkEffective() ? "浅色" : "深色"}</span></div>
       <div class="im-rail-item xim-skin-btn" role="button">${ICONS.swap}<span>切换外观</span></div>`
    : "";

  rail.innerHTML = `${head}${search}<div class="im-rail-items">${real}${deco}${groups}</div>
    <div class="im-rail-bottom">${bottomActions}<div class="im-rail-item" data-key="more" role="button">${ICONS.more}<span>更多</span></div></div>`;

  ensureRailFold(rail.querySelector(".im-rail-bottom"));
  bindSearchTrigger(rail.querySelector(".im-rail-search"), { placeholder: "搜索帖子" });
  applyRailCollapseState();
  // 团队图标 / 名称分别可编辑（复刻 linux.do IM 的 org chip）
  rail.querySelector(".im-rail-org-logo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const v = window.prompt("团队图标：1~2 个字、emoji 或图片 URL", getOrgIcon() || skin.letter);
    if (v == null) return;
    setOrgIcon(v.trim());
    ensureRail();
  });
  rail.querySelector(".im-rail-org-name")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const v = window.prompt("团队名称", getOrgName());
    if (v == null) return;
    setOrgName(v.trim() || skin.orgName);
    ensureRail();
  });
  // 头部位当前用户头像（飞书/企微）点击进自己主页
  rail.querySelector(".im-rail-me")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const p = nativeProfilePath();
    if (p) navigateX(p);
  });
  rail.querySelector(".im-rail-avatar")?.addEventListener("click", () => {
    const p = nativeProfilePath();
    if (p) navigateX(p);
  });
  rail.querySelector(".im-dark-toggle")?.addEventListener("click", () => toggleColorTheme());
  if (rail.dataset.bound !== "1") {
    rail.dataset.bound = "1";
    rail.addEventListener("keydown", (e) => {
      const input = e.target.closest(".im-rail-search-input");
      if (!input || e.key !== "Enter") return;
      const v = input.value.trim();
      if (!v) return;
      e.preventDefault();
      input.blur();
      setChatId("search");
      navigateSearch(v);
      resetChatMessages();
    });
    rail.addEventListener("click", (e) => {
      const btn = e.target.closest(".im-rail-item");
      if (!btn || !rail.contains(btn)) return;
      if (btn.classList.contains("im-dark-toggle") || btn.classList.contains("xim-skin-btn")) return;
      const path = btn.dataset.path;
      if (path) {
        navigateX(path);
        return;
      }
      if (btn.dataset.key === "more") {
        openSearchPopup();
        return;
      }
      if (btn.dataset.dynamic === "profile") {
        navigateX(nativeProfilePath());
        return;
      }
      toast("装饰按钮");
    });
  }

  refreshMe(rail);
  return rail;
}

export function highlightRail() {
  const on = activeKey();
  document.querySelectorAll(".im-rail-item[data-key]").forEach((b) => {
    b.classList.toggle("active", b.dataset.key === on);
  });
}

/** 轻量刷新 rail 上的头像：DOM 变化节流里反复调用，只在头像真变了才重写（针对宿主容器更新，避免内部无限递归嵌套） */
export function refreshMe(rail) {
  rail = rail || document.querySelector(".im-rail");
  if (!rail) return;
  const uname = nativeDisplayName();
  const src = nativeAvatarSrc();

  // 头顶部位当前头像容器（飞书 avatar-wrap / 钉钉 me-ava）
  const headWrap = rail.querySelector(".im-rail-avatar, .im-rail-me");
  if (headWrap) {
    const next = personAvatarHtml("im-rail-me-ava", uname, src, "me", true);
    if (headWrap.dataset.ximMeSig !== next) {
      headWrap.dataset.ximMeSig = next;
      const old = headWrap.querySelector(".im-rail-me-ava");
      if (old) {
        const temp = document.createElement("div");
        temp.innerHTML = next;
        if (temp.firstElementChild) old.replaceWith(temp.firstElementChild);
      } else {
        headWrap.insertAdjacentHTML("afterbegin", next);
      }
    }
  }
}
