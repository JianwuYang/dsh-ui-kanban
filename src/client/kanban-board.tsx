/**
 * 看板视图：适配窄面板的「分组列表」——按状态分组、纵向排布，每组可折叠，
 * 卡片整行展示。不再提供拖拽（移动 issue 走卡片 → 详情弹窗 → 流转按钮，
 * 天然满足键盘/单指针操作），也不提供状态筛选（分组本身就是状态概览）。
 * 全屏/悬浮面板共用同一视图；聊天里的 toolview 仍渲染宽版多列看板。
 * @module dsh-kanban/client/kanban-board
 */

import React from 'react'
import { api, type BoardIssue, type BoardStatus, type GitlabMr, type StatusCategory } from './api.ts'
import { IcBranch, IcChevronDown, IcSpinner } from './icons.tsx'
import { statusAccent, typeTagStyle } from './colors.ts'
import { Avatar, SearchInput, StatusDot } from './primitives.tsx'
import { useChoice } from './modal.tsx'
import { useToast } from './toast.tsx'
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

export function IssueGroups({ issues, onOpen, search, mrByKey, target }: {
  issues: BoardIssue[]; onOpen: (key: string) => void; search: string
  /** Jira key → opened MRs（含 GitLab 描述里交叉引用解析出的关联），用于卡片上的分支切换。 */
  mrByKey?: ReadonlyMap<string, GitlabMr[]>
  /** 切换分支的目标工作区。 */
  target?: string
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
        const accent = statusAccent(col.status.color, col.status.name)
        return (
          <section key={colKey} className={`kb-group${isCollapsed ? ' kb-group--collapsed' : ''}`}
            style={{ '--kb-accent': accent } as React.CSSProperties}>
            <button type="button" className="kb-group__head" onClick={() => toggle(colKey)} aria-expanded={!isCollapsed}>
              <span className={isCollapsed ? 'kb-group__chevron' : 'kb-group__chevron kb-group__chevron--open'}><IcChevronDown size={12} /></span>
              <StatusDot category={col.status.category} name={col.status.name} color={accent} />
              <span className="kb-group__count">{col.issues.length}</span>
            </button>
            {/* 折叠用 grid-template-rows 过渡（内容始终渲染，仅收起高度） */}
            <div className={isCollapsed ? 'kb-group__body kb-group__body--collapsed' : 'kb-group__body'}>
              <div className="kb-group__inner">
                {visible.map((issue) => (
                  <Card key={issue.key} issue={issue} onOpen={onOpen} mrs={mrByKey?.get(issue.key)} target={target} />
                ))}
                {visible.length === 0 ? <div className="kb-group__empty">{searching ? t('noMatchGroup') : t('emptyGroup')}</div> : null}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ issue, onOpen, mrs, target }: {
  issue: BoardIssue; onOpen: (key: string) => void
  mrs?: GitlabMr[]; target?: string
}): React.ReactElement {
  const t = useT()
  const priorityCls = priorityLevelClass(issue.priority)
  const typeStyle = issue.issueType ? typeTagStyle(issue.issueType) : undefined
  const hasBranch = mrs !== undefined && mrs.length > 0
  return (
    <div
      className="kb-card kb-card--clickable"
      role="button" tabIndex={0}
      aria-label={t('openCardAria', { key: issue.key, summary: issue.summary })}
      onClick={() => onOpen(issue.key)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(issue.key) } }}
    >
      {/* 紧凑布局：key 与摘要同行（溢出自然换行）；类型/优先级/负责人/分支同处第二行 */}
      <div className="kb-card__summaryline">
        <span className="kb-card__key">{issue.key}</span>
        <span className="kb-card__summary">{issue.summary}</span>
      </div>
      {(issue.issueType || issue.priority || issue.assignee || hasBranch) ? (
        <div className="kb-card__meta">
          {issue.issueType ? <span className="kb-tag" style={typeStyle}>{issue.issueType}</span> : null}
          {issue.priority ? <span className={`kb-tag ${priorityCls}`}>{issue.priority}</span> : null}
          {issue.assignee ? (
            <span className="kb-card__assignee">
              <Avatar name={issue.assignee} size="sm" />
              <span className="kb-card__assignee-name">{issue.assignee}</span>
            </span>
          ) : null}
          {hasBranch ? <BranchChip mrs={mrs} target={target} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * 卡片上的分支切换按钮：该 Jira 关联了 opened 的 MR 时出现。
 * 单个 MR 点击直接切换；多个 MR 先弹列表选择。切换 = host 侧 fetch + checkout，
 * 结果 toast 展示（含 git 报错原文）。按钮是卡片内嵌的真 button，需拦截冒泡。
 */
function BranchChip({ mrs, target }: { mrs: GitlabMr[]; target?: string }): React.ReactElement {
  const t = useT()
  const toast = useToast()
  const choice = useChoice()
  const [busy, setBusy] = React.useState(false)

  const doSwitch = async (branch: string): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.gitCheckout(branch, target)
      if (r.ok) toast(t('branchSwitched', { branch: r.branch }))
      else toast(r.error || t('branchSwitchFailed'), 'error')
    } catch (e) {
      toast(e instanceof Error ? e.message : t('branchSwitchFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const withBranch = mrs.filter((m) => Boolean(m.sourceBranch))
  const onClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (busy || withBranch.length === 0) return
    if (withBranch.length === 1) {
      await doSwitch(withBranch[0]!.sourceBranch!)
      return
    }
    const picked = await choice({
      title: t('switchBranchTitle'),
      message: t('switchBranchPick'),
      options: withBranch.map((m, i) => ({
        value: m.sourceBranch!,
        label: `!${m.iid} ${m.sourceBranch}`,
        primary: i === 0,
      })),
    })
    if (picked !== null) await doSwitch(picked)
  }

  const label = withBranch.length <= 1 ? (withBranch[0]?.sourceBranch ?? mrs[0]?.sourceBranch ?? '')
    : `${withBranch[0]!.sourceBranch} +${withBranch.length - 1}`
  return (
    <button
      type="button"
      className="kb-card__branch"
      title={mrs.length === 1
        ? t('switchBranchTitle')
        : mrs.map((m) => `!${m.iid} ${m.sourceBranch ?? ''}`).join('\n')}
      onClick={(e) => { void onClick(e) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
    >
      {busy ? <IcSpinner size={11} className="kb-spin" /> : <IcBranch size={11} />}
      <span>{label}</span>
    </button>
  )
}
