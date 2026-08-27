/**
 * 看板视图：适配窄面板的「分组列表」——按状态分组、纵向排布，每组可折叠，
 * 卡片整行展示。不再提供拖拽（移动 issue 走卡片 → 详情弹窗 → 流转按钮，
 * 天然满足键盘/单指针操作），也不提供状态筛选（分组本身就是状态概览）。
 * 全屏/悬浮面板共用同一视图；聊天里的 toolview 仍渲染宽版多列看板。
 * @module dsh-kanban/client/kanban-board
 */

import React from 'react'
import type { BoardIssue, BoardStatus, StatusCategory } from './api.ts'
import { IcChevronDown } from './icons.tsx'
import { Avatar, SearchInput, StatusDot } from './primitives.tsx'
import { useT } from './locales.ts'

const CATEGORY_ORDER: StatusCategory[] = ['to do', 'in progress', 'done', 'unknown']

/** 按状态分组并排序（待办 → 进行中 → 已完成 → 未知）。 */
function groupColumns(issues: BoardIssue[]): { status: BoardStatus; issues: BoardIssue[] }[] {
  const by = new Map<string, { status: BoardStatus; issues: BoardIssue[] }>()
  for (const issue of issues) {
    const key = issue.status.id || issue.status.name
    const entry = by.get(key) ?? { status: issue.status, issues: [] }
    entry.issues.push(issue)
    by.set(key, entry)
  }
  return [...by.values()].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.status.category)
    const cb = CATEGORY_ORDER.indexOf(b.status.category)
    return ca !== cb ? ca - cb : a.status.name.localeCompare(b.status.name)
  })
}

/** 搜索匹配（key/摘要/负责人/状态名，大小写不敏感）。 */
export function matchesFilter(issue: BoardIssue, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [issue.key, issue.summary, issue.assignee ?? '', issue.status.name].some((s) => s.toLowerCase().includes(q))
}

/** 优先级 → 着色 tag 类（Highest/High/Critical/Blocker 为高危，Low/Minor/Trivial 为低危）。 */
export function priorityLevelClass(priority: string | undefined | null): string {
  const p = (priority ?? '').toLowerCase()
  if (['highest', 'high', 'critical', 'blocker'].includes(p)) return 'kb-tag--high'
  if (['low', 'lowest', 'minor', 'trivial'].includes(p)) return 'kb-tag--low'
  if (['medium', 'normal', 'major'].includes(p)) return 'kb-tag--medium'
  return ''
}

/* ------------------------------ 工具栏（搜索） ------------------------------ */

export function BoardToolbar({ search, onSearch, meta }: {
  search: string; onSearch: (v: string) => void; meta: string
}): React.ReactElement {
  const t = useT()
  return (
    <div className="kb-toolbar">
      <SearchInput value={search} onChange={onSearch} placeholder={t('searchPlaceholder')} />
      <span className="kb-toolbar__meta">{meta}</span>
    </div>
  )
}

/* ------------------------------ 分组列表 ------------------------------ */

export function IssueGroups({ issues, onOpen, search }: {
  issues: BoardIssue[]; onOpen: (key: string) => void; search: string
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set())
  const t = useT()
  const columns = groupColumns(issues)
  const searching = search.trim() !== ''

  const toggle = (key: string): void => {
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className="kb-groups">
      {columns.map((col) => {
        const colKey = col.status.id || col.status.name
        const visible = col.issues.filter((i) => matchesFilter(i, search))
        // 搜索时隐藏没有匹配项的分组；平时展示全部分组（空组给占位提示）。
        if (searching && visible.length === 0) return null
        const isCollapsed = collapsed.has(colKey)
        return (
          <section key={colKey} className={`kb-group kb-group--${(col.status.category ?? 'unknown').replace(' ', '-')}${isCollapsed ? ' kb-group--collapsed' : ''}`}>
            <button type="button" className="kb-group__head" onClick={() => toggle(colKey)} aria-expanded={!isCollapsed}>
              <span className={isCollapsed ? 'kb-group__chevron' : 'kb-group__chevron kb-group__chevron--open'}><IcChevronDown size={12} /></span>
              <StatusDot category={col.status.category} name={col.status.name} />
              <span className="kb-group__count">{col.issues.length}</span>
            </button>
            {!isCollapsed ? (
              <div className="kb-group__body">
                {visible.map((issue) => (
                  <Card key={issue.key} issue={issue} onOpen={onOpen} />
                ))}
                {visible.length === 0 ? <div className="kb-group__empty">{searching ? t('noMatchGroup') : t('emptyGroup')}</div> : null}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function Card({ issue, onOpen }: { issue: BoardIssue; onOpen: (key: string) => void }): React.ReactElement {
  const t = useT()
  const priorityCls = priorityLevelClass(issue.priority)
  return (
    <div
      className="kb-card kb-card--clickable"
      role="button" tabIndex={0}
      aria-label={t('openCardAria', { key: issue.key, summary: issue.summary })}
      onClick={() => onOpen(issue.key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(issue.key) } }}
    >
      {/* 紧凑布局：key 与摘要同行（溢出自然换行）；类型/优先级/负责人同处第二行 */}
      <div className="kb-card__summaryline">
        <span className="kb-card__key">{issue.key}</span>
        <span className="kb-card__summary">{issue.summary}</span>
      </div>
      {(issue.issueType || issue.priority || issue.assignee) ? (
        <div className="kb-card__meta">
          {issue.issueType ? <span className="kb-tag">{issue.issueType}</span> : null}
          {issue.priority ? <span className={`kb-tag ${priorityCls}`}>{issue.priority}</span> : null}
          {issue.assignee ? (
            <span className="kb-card__assignee">
              <Avatar name={issue.assignee} size="sm" />
              <span className="kb-card__assignee-name">{issue.assignee}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
