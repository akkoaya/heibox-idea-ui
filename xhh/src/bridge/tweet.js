// 小黑盒互动代理：点赞 / 收藏 / 关注 / 评论全部点击原生控件，
// 接口签名与风控交给站点自身的 runtime，脚本只做“按一下”的替身。

import { findTweetArticle, countIn, isImNode } from "./x-dom.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function visible(el) {
  if (!el || isImNode(el)) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  return el.getClientRects().length > 0;
}

/** 详情页底部操作栏（点赞 / 收藏 / 评论计数） */
function nativeActionBar() {
  const bars = Array.from(document.querySelectorAll(".link-reply__operation-box, .link-reply__main-box"));
  return bars.find((b) => !isImNode(b) && b.querySelector("button")) || null;
}

function nativeLikeButton() {
  const bar = nativeActionBar();
  if (!bar) return null;
  return bar.querySelector('button.link-reply__operation-item:not(.hb-cpt__favour-btn)');
}

function nativeFavourButton() {
  return document.querySelector("button.hb-cpt__favour-btn.link-reply__operation-item")
    || nativeActionBar()?.querySelector("button.hb-cpt__favour-btn");
}

function buttonCount(btn) {
  return countIn(btn?.querySelector(".link-reply__operation-desc, .like-box__cnt")?.textContent || "");
}

/** 点赞 / 取消点赞：代理原生详情页点赞按钮 */
export async function toggleLike(linkId, _wasLiked = false, article = null) {
  let btn = nativeLikeButton();
  if (!btn) {
    // 详情还没起来时，退化为打开原生卡片再试一次
    const card = article || findTweetArticle(linkId);
    card?.click?.();
    await sleep(600);
    btn = nativeLikeButton();
  }
  if (!btn) return { ok: false };
  const before = btn.classList.contains("active");
  btn.click();
  await sleep(420);
  const after = btn.classList.contains("active");
  return {
    ok: true,
    liked: after !== before ? after : !before,
    count: buttonCount(btn) || (before ? "" : ""),
  };
}

/** 收藏 / 取消收藏（同一按钮，文本变为「已收藏」） */
export async function toggleRetweet(linkId, _wasBookmarked = false) {
  const btn = nativeFavourButton();
  if (!btn) return { ok: false };
  const before = btn.classList.contains("active");
  btn.click();
  await sleep(420);
  const after = btn.classList.contains("active");
  return {
    ok: true,
    retweeted: after !== before ? after : !before,
    bookmarked: after !== before ? after : !before,
    count: buttonCount(btn),
  };
}

export async function toggleBookmark(linkId, wasBookmarked = false) {
  return toggleRetweet(linkId, wasBookmarked);
}

/* —— 关注 —— */
function followButton() {
  return document.querySelector(".page-header__follow-btn, .link-user__follow-btn");
}

function followText(btn) {
  return (btn?.textContent || "").replace(/\s+/g, "");
}

export function getProfileFollowState() {
  const btn = followButton();
  if (!btn) return { visible: false, following: false, btn: null };
  const txt = followText(btn);
  return { visible: true, following: txt.includes("已关注") || txt.includes("互相关注"), btn };
}

/** 取关时站点会弹自定义确认框：找到可见的「确定」按钮点掉 */
async function confirmNativeDialog() {
  for (let i = 0; i < 8; i++) {
    await sleep(160);
    const candidates = Array.from(document.querySelectorAll("button, .hb-cpt__dialog-btn, [role='button']"));
    const confirm = candidates.find((el) => {
      if (!visible(el)) return false;
      const t = (el.textContent || "").replace(/\s+/g, "");
      if (t !== "确定" && t !== "确认") return false;
      return !!el.closest("[class*='dialog'], [class*='modal'], [class*='popup'], [class*='confirm'], .hb-cpt__mask");
    });
    if (confirm) {
      confirm.click();
      return true;
    }
  }
  return false;
}

export async function toggleFollowOnProfile() {
  const state = getProfileFollowState();
  if (!state.visible || !state.btn) return { ok: false, msg: "未找到关注按钮" };
  state.btn.click();
  if (state.following) await confirmNativeDialog();
  await sleep(420);
  const next = getProfileFollowState();
  return { ok: true, following: next.visible ? next.following : !state.following };
}

export async function toggleFollowViaCaret() {
  return toggleFollowOnProfile();
}

export async function toggleTweetFollow() {
  return toggleFollowOnProfile();
}

/* —— 评论：驱动详情页原生 ProseMirror 输入框 —— */
function nativeReplyEditor() {
  const editors = Array.from(document.querySelectorAll(".link-reply .ProseMirror[contenteditable='true'], .link-reply [contenteditable='true']"));
  return editors.find((el) => !isImNode(el)) || null;
}

function nativeReplyWrapper() {
  return document.querySelector(".link-reply__main-box, .link-reply");
}

function nativeSendButton() {
  const box = document.querySelector(".link-reply__menu-box") || document;
  const btns = Array.from(box.querySelectorAll("button"));
  return btns.find((b) => (b.textContent || "").replace(/\s+/g, "") === "发送") || null;
}

function fillEditable(el, text) {
  el.focus({ preventScroll: true });
  let ok = false;
  try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
  if (ok) return true;
  try { document.execCommand("selectAll"); } catch { /* ignore */ }
  el.textContent = text;
  try {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } catch {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return true;
}

/** 在原生详情页发评论：展开输入框 → 填入 ProseMirror → 点「发送」 */
export async function postCommentViaNative(text) {
  const content = String(text || "").trim();
  if (!content) return false;
  const wrapper = nativeReplyWrapper();
  if (!wrapper) return false;
  wrapper.querySelector(".link-reply__input-wrapper")?.click();
  wrapper.querySelector(".link-reply__editor")?.click();
  await sleep(260);
  const editor = nativeReplyEditor();
  if (!editor) return false;
  fillEditable(editor, content);
  await sleep(360);
  const send = nativeSendButton();
  if (!send) return false;
  send.click();
  return true;
}
