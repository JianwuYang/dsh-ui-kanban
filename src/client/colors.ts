/**
 * 状态/头像/类型的三层着色工具：
 * - 状态：优先用 Jira 自己的 statusCategory.colorName（固定 6 值调色板，与 Jira
 *   UI 一致），缺失时按状态名做确定性哈希从 10 色精选调色板取色——人定义的状态名
 *   也有稳定、可区分的颜色。
 * - 头像：按显示名哈希取色。
 * - 类型：常见类型映射 + 哈希兜底（低饱和 tint）。
 * 所有主色取 600 级中调 hue，深浅主题均可读；背景 tint 用 color-mix 自动适配主题。
 * @module dsh-kanban/client/colors
 */

import type React from 'react'

/** Jira statusCategory.colorName → 主题安全的中调色。 */
const JIRA_COLOR_MAP: Record<string, string> = {
  'blue-gray': '#64748b',
  green: '#16a34a',
  yellow: '#d97706',
  'warm-red': '#dc2626',
  orange: '#ea580c',
  brown: '#a5692a',
}

/** 哈希兜底调色板（600 级中调，深浅主题均可读）。 */
const PALETTE = [
  '#4f46e5', '#0d9488', '#d97706', '#dc2626', '#7c3aed',
  '#0284c7', '#ea580c', '#16a34a', '#db2777', '#65a30d',
]

/** 常见 issue 类型 → 颜色（小写匹配；未命中走哈希）。 */
const TYPE_COLOR_MAP: Record<string, string> = {
  bug: '#dc2626', 缺陷: '#dc2626', 故障: '#dc2626',
  story: '#16a34a', 故事: '#16a34a', 需求: '#16a34a',
  task: '#2563eb', 任务: '#2563eb',
  epic: '#7c3aed',
  'sub-task': '#0d9488', 子任务: '#0d9488',
  improvement: '#0284c7', 改进: '#0284c7',
}

/** 确定性字符串哈希（FNV-1a），用于从调色板稳定取色。 */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const palettePick = (input: string): string => PALETTE[hashString(input) % PALETTE.length] ?? PALETTE[0]!

/** 状态主色：Jira colorName 优先，缺失按状态名哈希兜底。 */
export function statusAccent(colorName: string | undefined, statusName: string): string {
  if (colorName) {
    const mapped = JIRA_COLOR_MAP[colorName]
    if (mapped) return mapped
  }
  return palettePick(statusName || 'unknown')
}

/** 头像主色：按显示名哈希。 */
export function avatarAccent(name: string): string {
  return palettePick(name || '?')
}

/** 类型主色：常见类型映射优先，否则哈希兜底。 */
export function typeAccent(issueType: string): string {
  const key = issueType.trim().toLowerCase()
  return TYPE_COLOR_MAP[key] ?? palettePick(key || 'other')
}

/** 类型 tag 的低饱和 tint 内联样式（背景 14% 混色 + 主色文字）。 */
export function typeTagStyle(issueType: string): React.CSSProperties {
  const accent = typeAccent(issueType)
  return {
    color: accent,
    background: `color-mix(in srgb, ${accent} 14%, transparent)`,
  }
}

/** 头像内联样式：18% 主色 tint 背景 + 主色文字。 */
export function avatarStyle(name: string): React.CSSProperties {
  const accent = avatarAccent(name)
  return {
    color: accent,
    background: `color-mix(in srgb, ${accent} 18%, transparent)`,
  }
}
