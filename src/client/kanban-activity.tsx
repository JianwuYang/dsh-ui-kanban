/**
 * 会话级看板：入口是会话标题旁的「看板」图标按钮（`conversation.session.header.utilities`，
 * session 作用域），点击后打开一个右侧悬浮面板（`shell.overlay`），显示当前会话对应工作区
 * （项目）的 Jira 列表。
 *
 * 参考 dsh-agent-teams 的 ActivityPanel：面板挂进 ui-layout 的 `shell.overlay`（根级 list
 * 悬浮层）。但与之前的常驻徽标不同，这里**不再有常驻徽标**（它会压到顶部栏）；面板只在用户
 * 点会话标题旁的「看板」按钮后打开。按钮在 session 作用域、天然知道当前会话；面板经一个
 * 模块级 bus 接收「打开时的 sessionId」，并据此把会话的 cwd → 工作区 → 项目。
 *
 * 工作区跟随：面板打开后实时跟踪 sessions 列表的**当前选中会话**——用户在 DSH 里切换
 * 会话（工作区）时，projectTarget 跟着变，KanbanApp 自动重新加载对应工作区的项目；
 * 无当前会话时回退到打开按钮所属会话的工作区。
 *
 * 数据：全部走 host 侧 `/kanban-api` 桥（同源 fetch），用 `?cwd=`（会话工作区）或
 * `?workspace=`（切换）选择项目。
 * @module dsh-kanban/client/kanban-activity
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { NAMESPACE } from './constants.ts'
import { IcBoard } from './icons.tsx'
import { KanbanApp } from './kanban-app.tsx'
import { sendToCurrentSession, sendToNewSession } from './session-send.ts'
import type { ObservableSnapshotLike, PromptContentPartLike, SessionListStateLike, SessionsServiceLike, WorkspacesServiceLike } from './types.ts'

/* ---------------- 模块级 bus：header 按钮 ↔ shell.overlay 面板 ---------------- */

interface BusState { open: boolean; sessionId: string | undefined }
const busListeners = new Set<() => void>()
let bus: BusState = { open: false, sessionId: undefined }

function getBus(): BusState { return bus }
function setBus(next: BusState): void { bus = next; for (const l of busListeners) l() }
function subscribeBus(listener: () => void): () => void { busListeners.add(listener); return () => { busListeners.delete(listener) } }

/** Open the floater for a session (the header button calls this). */
function openKanban(sessionId?: string): void { setBus({ open: true, sessionId }) }
/** Close the floater (the panel's close button calls this). */
function closeKanban(): void { setBus({ open: false, sessionId: undefined }) }

/* ---------------- 插槽注册 ---------------- */

/** 注册 `shell.overlay` 面板（仅当 bus 打开时渲染，无常驻徽标）。 */
export function registerKanbanActivity(ctx: Context): void {
  const sessions = (ctx.get('sessions') as SessionsServiceLike | undefined)
  const workspaces = (ctx.get('workspaces') as WorkspacesServiceLike | undefined)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: `${NAMESPACE}-panel`, order: 80, label: 'dsh-kanban 看板' },
    () => React.createElement(KanbanFloatPanel, { sessions, workspaces }),
  ))
}

/** 注册 `conversation.session.header.utilities` 的「看板」图标按钮（session 作用域）。 */
export function registerKanbanHeader(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: NAMESPACE, order: 60, label: 'dsh-kanban 看板' },
    (props: { sessionId?: string }) => React.createElement(HeaderKanbanButton, props),
  ))
}

/* ---------------- header 按钮 ---------------- */

/** 会话标题旁的「看板」按钮（图标 + 文字，点击区域更大）：点击打开当前会话的悬浮看板。 */
function HeaderKanbanButton({ sessionId }: { sessionId?: string }): React.ReactElement {
  return React.createElement('button', {
    type: 'button',
    className: 'kkb-header-btn kkb-header-btn--label',
    onClick: () => openKanban(sessionId),
    'aria-label': '打开 dsh-kanban 看板',
    title: '看板',
  },
    React.createElement(IcBoard, { className: 'kkb-header-icon', size: 14 }),
    React.createElement('span', null, '看板'),
  )
}

/* ---------------- 面板 ---------------- */

/** 面板正文：仅在 bus 打开时渲染，并实时跟随「当前会话」的工作区。
 *  直接把功能完整的 {@link KanbanApp}（variant='panel'）挂进来：
 *  工具栏 + 分组列表 + 详情/新建/GitLab/设置 弹窗一应俱全；弹窗是整屏浮层，
 *  不受窄面板限制。数据经 host 侧 `/kanban-api` 桥，按会话 cwd 定位工作区。
 *  「丢进会话分析」经官方 ISession.prompt / workspaces.startSession 发送。 */
function KanbanFloatPanel({ sessions, workspaces }: {
  sessions: SessionsServiceLike | undefined; workspaces: WorkspacesServiceLike | undefined
}): React.ReactElement | null {
  const busState = React.useSyncExternalStore(subscribeBus, getBus)
  const open = busState.open
  const openingCwd = useSessionCwd(sessions?.list, busState.sessionId)
  const currentCwd = useCurrentSessionCwd(sessions?.list)

  // 实时跟随当前会话的工作区（cwd → 工作区 → 项目）；无当前会话时回退到打开按钮所属会话。
  // cwd 变化时 KanbanApp 的 load 会重新按新 target 拉取项目。
  const cwd = currentCwd ?? openingCwd
  const projectTarget = React.useMemo(() => (cwd ? { cwd } : undefined), [cwd])

  // 「丢进会话分析」回调：发送失败抛错（DetailModal 弹 error toast）；
  // 新建会话成功后直接关面板，用户立刻看到新会话。
  const onSendToSession = React.useCallback(async (key: string, target: 'current' | 'new', images?: PromptContentPartLike[]): Promise<void> => {
    const result = target === 'current'
      ? await sendToCurrentSession(sessions, key, images)
      : await sendToNewSession(sessions, workspaces, key, images)
    if (!result.ok) throw new Error(result.error ?? '发送失败')
    if (target === 'new') closeKanban()
  }, [sessions, workspaces])

  if (!open) return null

  return React.createElement(KanbanApp, { variant: 'panel', projectTarget, onClose: closeKanban, onSendToSession })
}

/* ---------------- session helpers ---------------- */

const EMPTY_SESSION_STATE: SessionListStateLike = { current: undefined, ids: [], byId: {} }
const noopSubscribe = (): (() => void) => () => {}
const noopGetSnapshot = (): SessionListStateLike => EMPTY_SESSION_STATE

/** The workspace path (cwd) for a session id, read from the sessions snapshot. */
function useSessionCwd(sessions: ObservableSnapshotLike<SessionListStateLike> | undefined, sessionId: string | undefined): string | undefined {
  const state = React.useSyncExternalStore(
    sessions === undefined ? noopSubscribe : sessions.subscribe,
    sessions === undefined ? noopGetSnapshot : sessions.getSnapshot,
  )
  return sessionId === undefined ? undefined : state.byId?.[sessionId]?.cwd
}

/** The workspace path (cwd) of the CURRENT session, read from the sessions snapshot. */
function useCurrentSessionCwd(sessions: ObservableSnapshotLike<SessionListStateLike> | undefined): string | undefined {
  const state = React.useSyncExternalStore(
    sessions === undefined ? noopSubscribe : sessions.subscribe,
    sessions === undefined ? noopGetSnapshot : sessions.getSnapshot,
  )
  return state.current === undefined ? undefined : state.byId?.[state.current]?.cwd
}
