// 帖子 / 评论低信息密度过滤与折叠引擎
// 移植自 linux.do IM 版「水贴过滤」，判据换成小黑盒的帖子与评论对象

import { SPAM_FILTER_KEY } from "../config/constants.js";

export const DEFAULT_SHORT_KEYWORDS = [
  "谢", "mark", "cy", "bd", "dd", "顶", "赞", "支持", "好贴", "学习", "666", "牛", "强", "收藏", "水", "哈哈", "笑死", "前排", "沙发",
];

export const DEFAULT_KEYWORDS = [
  "感谢", "感谢大佬", "感谢分享", "谢谢", "谢谢大佬", "谢谢分享",
  "顶", "插眼", "mark", "Mark", "MARK", "cy", "CY", "bd", "BD",
  "战略性mark", "mark.", "dd", "DD", "支持", "好贴", "666",
  "学习", "学习了", "学到了", "牛逼", "牛蛙", "厉害", "强", "太强了",
  "收藏", "先马", "马住", "前排", "沙发", "前排围观", "路过", "围观", "打卡", "签到",
  "水一贴", "水贴", "每日一水", "水一下", "占位", "占楼", "顶一下", "顶顶", "顶顶顶",
  "火钳刘明", "留名", "看看", "瞅瞅", "哈哈哈", "笑死", "笑死我了", "太草了",
];

export const DEFAULT_SPAM_CONFIG = {
  enabled: true,
  enableShortReply: true,
  shortReplyThreshold: 8,
  requireShortKeyword: true,
  shortKeywords: DEFAULT_SHORT_KEYWORDS,
  enableKeywordBlock: true,
  keywordMatchMode: "exact", // 'exact' | 'contains'
  keywords: DEFAULT_KEYWORDS,
};

/** 验证并规整配置，防止异常数据 */
export function validateSpamConfig(config) {
  if (!config || typeof config !== "object") return { ...DEFAULT_SPAM_CONFIG };
  const valid = { ...DEFAULT_SPAM_CONFIG };

  valid.enabled = typeof config.enabled === "boolean" ? config.enabled : true;
  valid.enableShortReply = typeof config.enableShortReply === "boolean" ? config.enableShortReply : true;
  valid.requireShortKeyword = typeof config.requireShortKeyword === "boolean" ? config.requireShortKeyword : true;
  valid.enableKeywordBlock = typeof config.enableKeywordBlock === "boolean" ? config.enableKeywordBlock : true;

  const threshold = parseInt(config.shortReplyThreshold, 10);
  valid.shortReplyThreshold = isNaN(threshold) || threshold < 1 || threshold > 60 ? 8 : threshold;

  valid.keywordMatchMode = config.keywordMatchMode === "contains" ? "contains" : "exact";

  if (Array.isArray(config.shortKeywords)) {
    valid.shortKeywords = config.shortKeywords
      .filter((k) => typeof k === "string" && k.trim().length > 0)
      .slice(0, 500)
      .map((k) => k.trim().substring(0, 40));
  }
  if (Array.isArray(config.keywords)) {
    valid.keywords = config.keywords
      .filter((k) => typeof k === "string" && k.trim().length > 0)
      .slice(0, 500)
      .map((k) => k.trim().substring(0, 40));
  }
  return valid;
}

let activeConfig = null;

export function loadSpamConfig() {
  if (activeConfig) return activeConfig;
  try {
    const raw = localStorage.getItem(SPAM_FILTER_KEY);
    if (raw) {
      activeConfig = validateSpamConfig(JSON.parse(raw));
      return activeConfig;
    }
  } catch { /* ignore */ }
  activeConfig = { ...DEFAULT_SPAM_CONFIG };
  return activeConfig;
}

const listeners = new Set();
export function onSpamFilterChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function saveSpamConfig(config) {
  activeConfig = validateSpamConfig(config);
  try {
    localStorage.setItem(SPAM_FILTER_KEY, JSON.stringify(activeConfig));
  } catch { /* ignore */ }
  for (const fn of listeners) {
    try { fn(activeConfig); } catch { /* ignore */ }
  }
}

export function resetSpamConfig() {
  saveSpamConfig(DEFAULT_SPAM_CONFIG);
  return activeConfig;
}

/** 清理预览文本，防御 RTL / 零宽 / 控制符溢出 */
/* eslint-disable no-control-regex */
export function sanitizePreview(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .trim()
    .substring(0, 30)
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[\uFFF0-\uFFFF]/g, "")
    .replace(/[\u0300-\u036F]{3,}/g, "");
}
/* eslint-enable no-control-regex */

function plainText(item) {
  const raw = item?.text || "";
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim();
}

/** 豁免：长文 / 带链接直接放行；带图帖只走关键词漏斗（图片帖通常是有内容的分享） */
function isExempt(item) {
  if (!item) return true;
  const text = plainText(item);
  if (!text) return true;
  if (/https?:\/\//i.test(text)) return true;
  return false;
}

/** 手动展开过的条目（按 id 记录），展开后本会话不再折叠 */
const expandedIds = new Set();

export function isItemExpanded(id) {
  return expandedIds.has(String(id));
}

export function expandItem(id) {
  expandedIds.add(String(id));
}

export function clearExpandedItems() {
  expandedIds.clear();
}

/**
 * 判断帖子 / 评论是否为低信息密度内容
 * @param {{id?:string,text?:string,photos?:Array,video?:object}} item
 * @returns {{ isSpam: boolean, preview?: string }}
 */
export function isSpamItem(item) {
  const config = loadSpamConfig();
  if (!config.enabled) return { isSpam: false };
  if (isExempt(item)) return { isSpam: false };
  if (item.id && isItemExpanded(item.id)) return { isSpam: false };

  const text = plainText(item);
  if (text.length > 1000) return { isSpam: false };

  const lower = text.toLowerCase();
  const noSpace = lower.replace(/\s+/g, "");
  const lines = text.split(/\n+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hasMedia = !!(item.photos?.length || item.video);

  // 短内容漏斗：只对纯文字帖生效，避免把「一句话 + 图」的正常分享折叠掉
  if (!hasMedia && config.enableShortReply && text.length <= config.shortReplyThreshold) {
    if (!config.requireShortKeyword) return { isSpam: true, preview: sanitizePreview(text) };
    for (const kw of config.shortKeywords) {
      if (lower.includes(kw.toLowerCase())) return { isSpam: true, preview: sanitizePreview(text) };
    }
  }

  if (config.enableKeywordBlock) {
    if (config.keywordMatchMode === "exact") {
      const set = new Set(config.keywords.map((k) => k.toLowerCase()));
      const lineHit = lines.some((l) => set.has(l) || set.has(l.replace(/\s+/g, "")));
      if (set.has(lower) || set.has(noSpace) || lineHit) return { isSpam: true, preview: sanitizePreview(text) };
    } else {
      for (const kw of config.keywords) {
        if (lower.includes(kw.toLowerCase())) return { isSpam: true, preview: sanitizePreview(text) };
      }
    }
  }

  return { isSpam: false };
}
