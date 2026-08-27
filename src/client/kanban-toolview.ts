/**
 * 看板 toolview（tool.call.toolview 插槽，按工具名 keyed）：当 model 调用
 * kanban-issues / kanban-sync 时，把结果渲染成一块看板（按状态列分组的卡片）；
 * kanban-issue / kanban-move 渲染成详情；kanban-projects 渲染成项目列表。
 *
 * 数据来源：host 半边在工具的 output.presentationMeta 里输出结构化 meta
 * （{ kind, ... }），经 tool/result 事件穿到客户端 block.meta；缺失时回退到
 * 渲染 block.content 的文本行。本模块不 import 任何 @deepseek-ai 客户端包，
 * 只用 React + 主题变量；与 KanbanApp 共用 kb-* 类名（kb-board--tool 修饰：
 * 无拖拽、紧凑列宽）。保持 React.createElement 风格，避免 JSX 与额外 externals。
 * @module dsh-kanban/client/kanban-toolview
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { BOARD_TOOL_KEYS, DETAIL_TOOL_KEYS } from './constants.ts'
import { Avatar, StatusDot, formatDateTime } from './primitives.tsx'
import { t } from './locales.ts'
import type { ToolCallBlockLike, ToolCallOwnerPropsLike } from './types.ts'

/* ---- meta 结构（host 半边 presentationMeta 的输出） ---- */

interface BoardCardLike {
  key?: string
  summary?: string
  status?: string
  issueType?: string
  priority?: string
  assignee?: string | null
  updated?: string
}
interface BoardColumnLike { name?: string; category?: string; color?: string; issues?: BoardCardLike[] }
interface BoardMeta { kind: 'kanban-board'; board: { project?: string; projectKey?: string; total?: number; columns?: BoardColumnLike[] } }
interface DetailMeta { kind: 'kanban-detail'; detail: { key?: string; summary?: string; status?: string; issueType?: string; priority?: string; assignee?: string; reporter?: string; description?: string; descriptionHtml?: string; transitions?: { id: string; name: string }[]; comments?: { author?: string; created?: string; body?: string; bodyHtml?: string }[]; attachments?: { id: string; filename: string; mimeType?: string; size?: number; url: string }[] } }
interface ProjectsMeta { kind: 'kanban-projects'; projects: { projects?: { id: string; name: string; projectKey?: string; issueCount?: number }[]; currentWorkspaceId?: string | null } }
interface SyncMeta { kind: 'kanban-sync'; result: { project?: string; total?: number; added?: number; updated?: number; lastSyncedAt?: string | null } }

type AnyMeta = BoardMeta | DetailMeta | ProjectsMeta | SyncMeta

/** 在 `tool.call.toolview` 插槽给看板工具注册自定义渲染行。 */
export function registerKanbanToolview(ctx: Context): void {
  for (const key of BOARD_TOOL_KEYS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, KanbanToolview))
  }
  for (const key of DETAIL_TOOL_KEYS) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key }, KanbanToolview))
  }
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'kanban-projects' }, KanbanToolview))
}

/** 看板行：所有分支都用 React.createElement，避免 JSX 与额外 externals。 */
export function KanbanToolview(props: ToolCallOwnerPropsLike): React.ReactElement {
  const block: ToolCallBlockLike | undefined = props.block
  const meta = readMeta(block)
  if (meta === null) return renderFallback(block)
  if (meta.kind === 'kanban-board') return renderBoard(meta)
  if (meta.kind === 'kanban-detail') return renderDetail(meta)
  if (meta.kind === 'kanban-projects') return renderProjects(meta)
  if (meta.kind === 'kanban-sync') return renderSync(meta)
  return renderFallback(block)
}

function readMeta(block: ToolCallBlockLike | undefined): AnyMeta | null {
  const meta = block?.meta
  if (!meta || typeof meta !== 'object' || !('kind' in meta)) return null
  return meta as AnyMeta
}

function blockText(block: ToolCallBlockLike | undefined): string {
  return (block?.content ?? []).map((c) => c.type === 'text' ? (c.text ?? '') : '').join('').trim()
}

/* ---- 看板 ---- */

function renderBoard(meta: BoardMeta): React.ReactElement {
  const board = meta.board ?? {}
  const columns = board.columns ?? []
  const metaText = `${board.projectKey ? `${board.projectKey} · ` : ''}${t('issuesCount', { n: board.total ?? 0 })}`.trim()
  return React.createElement('div', { className: 'kb-board kb-board--tool' },
    React.createElement('div', { className: 'kb-toolbar' },
      React.createElement('span', { className: 'kb-toolbar__title' }, board.project ?? 'Kanban'),
      React.createElement('span', { className: 'kb-toolbar__meta' }, metaText),
    ),
    columns.length === 0
      ? React.createElement('div', { className: 'kb-note' }, t('tvNoCache'))
      : React.createElement('div', { className: 'kb-board' }, columns.map((c, i) => renderColumn(c, i))),
  )
}

function renderColumn(col: BoardColumnLike, index: number): React.ReactElement {
  const issues = col.issues ?? []
  const category = col.category ?? 'unknown'
  return React.createElement('div', { className: `kb-column kb-column--${category.replace(' ', '-')}`, key: index },
    React.createElement('div', { className: 'kb-column__head' },
      col.category
        ? React.createElement(StatusDot, { category: col.category, name: col.name })
        : React.createElement(React.Fragment, null, colorDot(col.color), React.createElement('span', { className: 'kb-column__name' }, col.name ?? '')),
      React.createElement('span', { className: 'kb-column__count' }, String(issues.length)),
    ),
    issues.length === 0
      ? React.createElement('div', { className: 'kb-note kb-column__empty' }, t('tvEmptyCol'))
      : React.createElement('div', { className: 'kb-column__body' }, issues.map((issue, j) => renderIssue(issue, j))),
  )
}

function colorDot(color?: string): React.ReactElement | null {
  return React.createElement('span', {
    className: 'kb-column__dot',
    style: { background: color ? colorVar(color) : 'var(--dsw-alias-label-tertiary)' },
  })
}

function colorVar(color: string): string {
  const map: Record<string, string> = {
    'blue-gray': 'var(--dsw-alias-info)', green: 'var(--dsw-alias-success)', yellow: 'var(--dsw-alias-warning)',
    brown: 'var(--dsw-alias-warning)', orange: 'var(--dsw-alias-warning)', 'warm-red': 'var(--dsw-alias-state-error-primary)',
  }
  return map[color] ?? color
}

function renderIssue(issue: BoardCardLike, index: number): React.ReactElement {
  const tags: string[] = []
  if (issue.issueType) tags.push(issue.issueType)
  if (issue.priority) tags.push(issue.priority)
  return React.createElement('div', { className: 'kb-card', key: index },
    React.createElement('div', { className: 'kb-card__key' }, issue.key ?? ''),
    React.createElement('div', { className: 'kb-card__summary' }, issue.summary ?? ''),
    tags.length > 0
      ? React.createElement('div', { className: 'kb-card__tags' }, tags.map((t, j) => React.createElement('span', { className: 'kb-tag', key: j }, t)))
      : null,
    issue.assignee
      ? React.createElement('div', { className: 'kb-card__assignee' },
          React.createElement(Avatar, { name: issue.assignee, size: 'sm' }),
          React.createElement('span', { className: 'kb-card__assignee-name' }, issue.assignee))
      : null,
  )
}

/* ---- 详情 ---- */

function renderDetail(meta: DetailMeta): React.ReactElement {
  const d = meta.detail ?? {}
  const transitions = d.transitions ?? []
  return React.createElement('div', { className: 'kb-detail kb-detail--tool' },
    React.createElement('div', { className: 'kb-toolbar' },
      React.createElement('span', { className: 'kb-toolbar__title' }, `${d.key ?? ''} · ${d.summary ?? ''}`),
    ),
    React.createElement('div', { className: 'kb-detail__meta' },
      d.status ? React.createElement('span', { className: 'kb-detail__chip' }, t('statusChip', { name: d.status })) : null,
      d.issueType ? React.createElement('span', { className: 'kb-detail__chip' }, t('typeChip', { name: d.issueType })) : null,
      d.priority ? React.createElement('span', { className: 'kb-detail__chip' }, t('priorityChip', { name: d.priority })) : null,
      d.assignee
        ? React.createElement('span', { className: 'kb-detail__chip' },
            React.createElement(Avatar, { name: d.assignee, size: 'sm' }), d.assignee)
        : null,
    ),
    d.descriptionHtml
      ? React.createElement('div', { className: 'kb-detail__html', dangerouslySetInnerHTML: { __html: d.descriptionHtml } })
      : d.description
        ? React.createElement('div', { className: 'kb-detail__desc' }, d.description)
        : null,
    (d.attachments ?? []).length > 0
      ? React.createElement('div', { className: 'kb-detail__section' },
          React.createElement('div', { className: 'kb-detail__label' }, t('attachmentsLabel', { n: (d.attachments ?? []).length })),
          React.createElement('div', { className: 'kb-detail__transitions' },
            (d.attachments ?? []).map((a, i) => React.createElement('a', {
              className: 'kb-tag', key: i, href: a.url, target: '_blank', rel: 'noreferrer noopener', title: a.url,
            }, a.filename))))
      : null,
    transitions.length > 0
      ? React.createElement('div', { className: 'kb-detail__section' },
          React.createElement('div', { className: 'kb-detail__label' }, t('tvTransitions')),
          React.createElement('div', { className: 'kb-detail__transitions' },
            transitions.map((t, i) => React.createElement('span', { className: 'kb-tag', key: i }, t.name))))
      : null,
    (d.comments ?? []).length > 0
      ? React.createElement('div', { className: 'kb-note' }, `评论 ${(d.comments ?? []).length} 条。`)
      : null,
  )
}

/* ---- 项目列表 ---- */

function renderProjects(meta: ProjectsMeta): React.ReactElement {
  const projects = meta.projects?.projects ?? []
  const active = meta.projects?.currentWorkspaceId ?? ''
  return React.createElement('div', { className: 'kb-detail kb-detail--tool' },
    React.createElement('div', { className: 'kb-toolbar' },
      React.createElement('span', { className: 'kb-toolbar__title' }, t('tvProjects')),
    ),
    projects.length === 0
      ? React.createElement('div', { className: 'kb-note' }, t('tvNoProjects'))
      : React.createElement('div', { className: 'kb-projects' },
          projects.map((p, i) => React.createElement('div', {
            className: p.id === active ? 'kb-projects__item kb-projects__active' : 'kb-projects__item', key: i,
          },
            p.id === active ? React.createElement('span', { className: 'kb-projects__dot' }) : null,
            React.createElement('span', { className: 'kb-projects__name' }, `${p.name}${p.projectKey ? ` (${p.projectKey})` : ''}`),
            React.createElement('span', { className: 'kb-projects__meta' }, t('issuesCount', { n: p.issueCount ?? 0 })),
          )),
        ),
  )
}

/* ---- 同步结果 ---- */

function renderSync(meta: SyncMeta): React.ReactElement {
  const r = meta.result ?? {}
  return React.createElement('div', { className: 'kb-detail kb-detail--tool' },
    React.createElement('div', { className: 'kb-toolbar' },
      React.createElement('span', { className: 'kb-toolbar__title' }, t('tvSyncTitle')),
      r.project ? React.createElement('span', { className: 'kb-toolbar__meta' }, r.project) : null,
    ),
    React.createElement('div', { className: 'kb-statrow' },
      React.createElement('div', { className: 'kb-statrow__item' },
        React.createElement('span', { className: 'kb-statrow__num' }, String(r.total ?? 0)),
        React.createElement('span', { className: 'kb-statrow__label' }, t('tvStatTotal'))),
      React.createElement('div', { className: 'kb-statrow__item' },
        React.createElement('span', { className: 'kb-statrow__num' }, String(r.added ?? 0)),
        React.createElement('span', { className: 'kb-statrow__label' }, t('tvStatAdded'))),
      React.createElement('div', { className: 'kb-statrow__item' },
        React.createElement('span', { className: 'kb-statrow__num' }, String(r.updated ?? 0)),
        React.createElement('span', { className: 'kb-statrow__label' }, t('tvStatUpdated'))),
    ),
    r.lastSyncedAt ? React.createElement('div', { className: 'kb-note kb-note--tool-meta' }, t('tvLastSync', { time: formatDateTime(r.lastSyncedAt) })) : null,
  )
}

/* ---- 兜底：渲染文本内容 ---- */

function renderFallback(block: ToolCallBlockLike | undefined): React.ReactElement {
  const textContent = blockText(block)
  return React.createElement('div', { className: 'kb-detail kb-detail--tool' },
    React.createElement('div', { className: 'kb-note' }, textContent || t('tvFallback')),
  )
}
