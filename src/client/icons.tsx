/**
 * 插件内联 SVG 图标集（Ic* 组件）：不引入任何图标库（客户端 bundle 只允许 react
 * 运行时依赖）。统一 16x16 viewBox、stroke=currentColor、strokeWidth 1.5，
 * 尺寸由 size prop 控制，装饰性图标默认 aria-hidden。
 * @module dsh-kanban/client/icons
 */

import React from 'react'

export interface IconProps { size?: number; className?: string }

function svgProps({ size = 14, className }: IconProps): { width: number; height: number; viewBox: string; fill: string; className: string | undefined; 'aria-hidden': boolean } {
  return { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', className, 'aria-hidden': true }
}

const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** 看板三列。 */
export function IcBoard(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)}><rect x="1.5" y="2" width="3.4" height="12" rx="1" fill="currentColor" /><rect x="6.3" y="2" width="3.4" height="8" rx="1" fill="currentColor" /><rect x="11.1" y="2" width="3.4" height="10" rx="1" fill="currentColor" /></svg>
}

/** 列表视图。 */
export function IcList(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M8 4h5.5M8 8h5.5M8 12h5.5" /><path d="M3 4h.01M3 8h.01M3 12h.01" strokeWidth={2.4} /></svg>
}

/** 同步/刷新。 */
export function IcSync(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9L13.6 6" /><path d="M13.6 2.5V6h-3.5" /><path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9L2.4 10" /><path d="M2.4 13.5V10h3.5" /></svg>
}

/** 新建。 */
export function IcPlus(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M8 3v10M3 8h10" /></svg>
}

/** 设置。 */
export function IcGear(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" /></svg>
}

/** GitLab（简化徽标形状）。 */
export function IcGitlab(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M8 13.3 3.2 5h2.7L8 8l2.1-3h2.7L8 13.3Z" /></svg>
}

/** 关闭。 */
export function IcClose(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="m4 4 8 8M12 4l-8 8" /></svg>
}

/** 复制。 */
export function IcCopy(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><rect x="6" y="6" width="8" height="8" rx="1.5" /><path d="M10 6V4.5A1.5 1.5 0 0 0 8.5 3h-4A1.5 1.5 0 0 0 3 4.5v4A1.5 1.5 0 0 0 4.5 10H6" /></svg>
}

/** 对勾（复制成功等）。 */
export function IcCheck(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="m3.5 8.5 3 3 6-7" /></svg>
}

/** 删除。 */
export function IcTrash(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M2.5 4h11" /><path d="M6.5 4V2.8A1.3 1.3 0 0 1 7.8 1.5h.4a1.3 1.3 0 0 1 1.3 1.3V4" /><path d="M4 4l.6 9.2a1.5 1.5 0 0 0 1.5 1.3h3.8a1.5 1.5 0 0 0 1.5-1.3L12 4" /><path d="M6.5 7v4M9.5 7v4" /></svg>
}

/** 图片/附件。 */
export function IcImage(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.5" cy="6.5" r="1" /><path d="m2.5 11 3.5-3 2.5 2 2-1.5 3 2.5" /></svg>
}

/** 评论。 */
export function IcComment(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M5.3 13.3A6 6 0 1 0 2.7 10.6l-1.4 4.1 4.1-1.4Z" /></svg>
}

/** 外部链接。 */
export function IcExternalLink(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M13.5 8.5V12a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 12V4.5A1.5 1.5 0 0 1 4.5 3H8" /><path d="M9.5 2.5h4v4" /><path d="M13.5 2.5 6.7 9.3" /></svg>
}

/** 下拉箭头。 */
export function IcChevronDown(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="m3.5 6 4.5 4.5L12.5 6" /></svg>
}

/** 灯箱上一张。 */
export function IcChevronLeft(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M10 3.5 5.5 8 10 12.5" /></svg>
}

/** 灯箱下一张。 */
export function IcChevronRight(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M6 3.5 10.5 8 6 12.5" /></svg>
}

/** 拖拽把手（六点）。 */
export function IcGrip(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)}><g fill="currentColor"><circle cx="4.2" cy="3.6" r=".95" /><circle cx="11.8" cy="3.6" r=".95" /><circle cx="4.2" cy="8" r=".95" /><circle cx="11.8" cy="8" r=".95" /><circle cx="4.2" cy="12.4" r=".95" /><circle cx="11.8" cy="12.4" r=".95" /></g></svg>
}

/** 用户（头像占位）。 */
export function IcUser(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><circle cx="8" cy="5.5" r="2.5" /><path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" /></svg>
}

/** 搜索。 */
export function IcSearch(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
}

/** 链接。 */
export function IcLink(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M6.7 8.7a3.33 3.33 0 0 0 5.03.36l2-2a3.33 3.33 0 0 0-4.71-4.71l-1.15 1.14" /><path d="M9.3 7.3a3.33 3.33 0 0 0-5.03-.36l-2 2a3.33 3.33 0 0 0 4.71 4.71l1.14-1.14" /></svg>
}

/** 取消链接（链接 + 斜杠）。 */
export function IcUnlink(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M6.7 8.7a3.33 3.33 0 0 0 5.03.36l2-2a3.33 3.33 0 0 0-4.71-4.71l-1.15 1.14" /><path d="M2.8 2.8l10.4 10.4" /></svg>
}

/** 分支（GitLab MR）。 */
export function IcBranch(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><circle cx="4.5" cy="4" r="1.6" /><circle cx="11.5" cy="6.5" r="1.6" /><circle cx="4.5" cy="12" r="1.6" /><path d="M4.5 5.6v4.8" /><path d="M4.5 7.5c0-2 7-1.5 7-1" /></svg>
}

/** 警告。 */
export function IcWarning(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="m8 1.8 6.6 11.2H1.4L8 1.8Z" /><path d="M8 6.2v3.4" /><path d="M8 11.6h.01" strokeWidth={2.2} /></svg>
}

/** 加载中转圈（配合 .kb-spin）。 */
export function IcSpinner(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" /></svg>
}

/** 发送（纸飞机，发送到会话）。 */
export function IcSend(props: IconProps): React.ReactElement {
  return <svg {...svgProps(props)} {...stroke}><path d="m14.7 1.3-4.7 13.4-2.7-6-6-2.7Z" /><path d="M14.7 1.3 7.3 8.7" /></svg>
}
