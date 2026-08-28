/**
 * 看板应用共用的小部件：图标按钮、首字母头像、状态点、搜索框、分段切换、
 * 空状态与骨架屏。全部走 --kb-* token，被 app 与 toolview 复用。
 * @module dsh-kanban/client/primitives
 */

import React from 'react'
import type { StatusCategory } from './api.ts'
import { avatarStyle } from './colors.ts'
import { buildIssueCopyText, copyText, type IssueCopyView } from './copy.ts'
import { IcCheck, IcClose, IcCopy, IcSearch } from './icons.tsx'
import { useT } from './locales.ts'

/** ISO 时间按浏览器本地时区格式化为 yyyy-MM-dd HH:mm:ss（解析失败原样返回）。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/* ---------------- IconButton ---------------- */

export function IconButton({ icon, label, onClick, disabled = false, ghost = false, className = '' }: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; ghost?: boolean; className?: string
}): React.ReactElement {
  return (
    <button type="button" className={`kb-iconbtn${ghost ? ' kb-iconbtn--ghost' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  )
}

/* ---------------- Avatar（首字母头像） ---------------- */

/** 从显示名取头像字符：中文取首个字，拉丁字母取前两个词的首字母。 */
export function initialsOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  if (/[぀-ヿ㐀-鿿豈-﫿]/.test(trimmed)) return trimmed.slice(0, 1)
  const words = trimmed.split(/\s+/)
  return words.slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase() || trimmed.slice(0, 1).toUpperCase()
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }): React.ReactElement {
  const cls = size === 'sm' ? 'kb-avatar kb-avatar--sm' : size === 'lg' ? 'kb-avatar kb-avatar--lg' : 'kb-avatar'
  return <span className={cls} title={name} aria-hidden="true" style={avatarStyle(name)}>{initialsOf(name)}</span>
}

/* ---------------- StatusDot ---------------- */

export function StatusDot({ category, name, color }: { category?: string; name?: string; color?: string }): React.ReactElement {
  const cat: StatusCategory = category === 'in progress' || category === 'done' || category === 'unknown' || category === 'to do' ? category : 'unknown'
  // 指定 color 时经 --kb-dot 覆盖圆点颜色（::before 无法写内联样式，走 CSS 变量）。
  const style = color ? ({ '--kb-dot': color } as React.CSSProperties) : undefined
  return <span className={`kb-status-dot kb-status-dot--${cat.replace(' ', '-')}`} style={style}>{name ?? ''}</span>
}

/* ---------------- SearchInput ---------------- */

export function SearchInput({ value, onChange, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}): React.ReactElement {
  const t = useT()
  const ph = placeholder ?? t('searchGitlab')
  return (
    <div className={`kb-search${className ? ` ${className}` : ''}`}>
      <span className="kb-search__icon"><IcSearch size={13} /></span>
      <input className="kb-input" type="text" value={value} placeholder={ph}
        onChange={(e) => onChange(e.target.value)} aria-label={ph} />
      {value ? (
        <span className="kb-search__clear">
          <IconButton icon={<IcClose size={12} />} label={t('searchClear')} ghost onClick={() => onChange('')} />
        </span>
      ) : null}
    </div>
  )
}

/* ---------------- CopyButton（issue 摘要拷贝） ---------------- */

export function CopyButton({ issue, label, stopPropagation = false }: {
  issue: IssueCopyView; label?: string; stopPropagation?: boolean
}): React.ReactElement {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const doCopy = async (e?: React.MouseEvent): Promise<void> => {
    if (stopPropagation && e) e.stopPropagation()
    const ok = await copyText(buildIssueCopyText(issue))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  return (
    <button type="button" className="kb-btn kb-btn--ghost kb-btn--sm" onClick={(e) => void doCopy(e)} aria-label={t('copyAria', { key: issue.key })}>
      {copied ? <IcCheck size={11} /> : <IcCopy size={11} />}{copied ? t('copied') : label ?? t('copy')}
    </button>
  )
}

/* ---------------- SegToggle（带 aria-pressed 的分段切换） ---------------- */

export interface SegOption<T extends string> { value: T; label: string; icon?: React.ReactNode }

export function SegToggle<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: readonly SegOption<T>[]; label?: string
}): React.ReactElement {
  return (
    <div className="kb-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'kb-seg__on' : ''}
          aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- EmptyState ---------------- */

export function EmptyState({ icon, title, hint, action }: {
  icon?: React.ReactNode; title: string; hint: string; action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="kb-empty">
      {icon ? <div className="kb-empty__icon">{icon}</div> : null}
      <div className="kb-empty__title">{title}</div>
      <div className="kb-empty__hint">{hint}</div>
      {action}
    </div>
  )
}

/* ---------------- 骨架屏 ---------------- */

export function SkeletonBoard({ columns = 4, cards = 3 }: { columns?: number; cards?: number }): React.ReactElement {
  return (
    <div className="kb-skeleton-board" aria-hidden="true">
      {Array.from({ length: columns }, (_, c) => (
        <div className="kb-skeleton-col" key={c}>
          <div className="kb-skeleton kb-skeleton-head" />
          {Array.from({ length: cards }, (_, k) => <div className="kb-skeleton kb-skeleton-card" key={k} />)}
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 8 }: { rows?: number }): React.ReactElement {
  return (
    <div className="kb-skeleton-detail" aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div className="kb-skeleton kb-skeleton-line" key={r} style={{ width: r % 3 === 0 ? '58%' : '82%' }} />
      ))}
    </div>
  )
}

export function SkeletonCards({ cards = 4 }: { cards?: number }): React.ReactElement {
  return (
    <div className="kb-skeleton-cards" aria-hidden="true">
      {Array.from({ length: cards }, (_, k) => <div className="kb-skeleton kb-skeleton-card" key={k} />)}
    </div>
  )
}

export function SkeletonDetail(): React.ReactElement {
  return (
    <div className="kb-skeleton-detail" aria-hidden="true">
      <div className="kb-skeleton kb-skeleton-line" style={{ width: '70%', height: 18 }} />
      <div className="kb-skeleton kb-skeleton-line" style={{ width: '40%' }} />
      <div className="kb-skeleton kb-skeleton-line" style={{ width: '92%' }} />
      <div className="kb-skeleton kb-skeleton-line" style={{ width: '86%' }} />
      <div className="kb-skeleton kb-skeleton-line" style={{ width: '64%' }} />
    </div>
  )
}
