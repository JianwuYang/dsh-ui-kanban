/**
 * 会话输入行的「当前分支」chip（conversation.input.left 插槽）：在输入框工具行
 * 左侧展示当前会话工作区本地仓库的真实 git 分支，点开向上弹出本地分支列表，
 * 选中即切换（复用 host 半边已有的 /kanban-api/git/checkout 流程）。
 *
 * 数据链路：slot 是 session 作用域，owner props（InputZone）不带 cwd，因此按
 * 会话 id 从 sessions 服务快照里读工作区路径（useSessionCwd）；分支读取/列表/
 * 切换走 /kanban-api/git/* 路由（host 半边 gitRoute）。
 *
 * 本组件渲染在 harness 会话 UI 中，不在 KanbanApp 的 ToastProvider 树内：chip
 * 自裹 ToastProvider（viewport 是 fixed 定位，任意位置可用），下拉用自绘
 * popover（useChoice 的 Dialog 上下文此处不可用）。sessions 服务在插槽挂载时
 * 惰性读取（config-card 的 settingsScope 同理），headless 环境优雅降级。
 * @module dsh-kanban/client/chat-branch
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { NAMESPACE } from './constants.ts'
import { api } from './api.ts'
import { IcBranch, IcCheck, IcChevronDown, IcSpinner } from './icons.tsx'
import { t, useT } from './locales.ts'
import { ToastProvider, useToast } from './toast.tsx'
import { useSessionCwd } from './kanban-activity.tsx'
import type { SessionsServiceLike } from './types.ts'

type BranchStatus = 'loading' | 'ready' | 'error' | 'no-repo'

interface BranchState {
  status: BranchStatus
  branch: string | null
  detached: boolean
  error: string | null
}

const LOADING_STATE: BranchState = { status: 'loading', branch: null, detached: false, error: null }

/** 注册到 conversation.input.left：chip 出现在输入框工具行左侧（仅 session 作用域）。 */
export function registerChatBranch(ctx: Context): void {
  ctx.slots.inject('conversation.input.left', () => {
    const sessions = ctx.get('sessions') as SessionsServiceLike | undefined
    return ctx.slots.register(
      { name: 'conversation.input.left', id: `${NAMESPACE}-branch`, order: 100, label: `dsh-kanban ${t('appBrand')}` },
      (props: { session?: { sessionId?: string }; sessionId?: string }) => React.createElement(
        ToastProvider,
        null,
        React.createElement(ChatBranchChip, {
          sessions,
          // owner InputZone.session 优先，standard sessionId seat 兜底（双保险）。
          sessionId: props.session?.sessionId ?? props.sessionId,
        }),
      ),
    )
  })
}

interface ChatBranchChipProps {
  sessions: SessionsServiceLike | undefined
  sessionId: string | undefined
}

function ChatBranchChip({ sessions, sessionId }: ChatBranchChipProps): React.ReactElement | null {
  const t = useT()
  const toast = useToast()
  const cwd = useSessionCwd(sessions?.list, sessionId)
  const [state, setState] = React.useState<BranchState>(LOADING_STATE)
  const [open, setOpen] = React.useState(false)
  const [branches, setBranches] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const wrapRef = React.useRef<HTMLSpanElement>(null)

  // 当前分支：随会话工作区（cwd）变化重读。
  React.useEffect(() => {
    let cancelled = false
    if (!cwd) {
      setState({ status: 'no-repo', branch: null, detached: false, error: null })
      return
    }
    setState(LOADING_STATE)
    void api.gitCurrentBranch({ cwd })
      .then((r) => {
        if (cancelled) return
        if (r.branch !== null) setState({ status: 'ready', branch: r.branch, detached: false, error: null })
        else if (r.detached) setState({ status: 'ready', branch: null, detached: true, error: null })
        else setState({ status: 'no-repo', branch: null, detached: false, error: r.error ?? null })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setState({ status: 'error', branch: null, detached: false, error: e instanceof Error ? e.message : String(e) })
      })
    return () => { cancelled = true }
  }, [cwd])

  // 分支列表：每次打开下拉时取新（checkout 的 fetch --all 会带进新远端 ref）。
  React.useEffect(() => {
    if (!open || !cwd) return
    let cancelled = false
    setBranches([])
    void api.gitBranches({ cwd })
      .then((r) => { if (!cancelled) setBranches(r.branches ?? []) })
      .catch(() => { if (!cancelled) setBranches([]) })
    return () => { cancelled = true }
  }, [open, cwd])

  // 点击 popover 外部关闭。
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const el = wrapRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const doSwitch = async (branch: string): Promise<void> => {
    if (!cwd || busy) return
    setBusy(branch)
    try {
      const r = await api.gitCheckout(branch, { cwd })
      if (r.ok) {
        toast(t('branchSwitched', { branch: r.branch }))
        setState({ status: 'ready', branch: r.branch, detached: false, error: null })
        setOpen(false)
      } else {
        toast(r.error || t('branchSwitchFailed'), 'error')
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('branchSwitchFailed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  // 无工作区（或会话不在 sessions 快照里）的会话：整个 chip 隐藏。
  if (!cwd) return null

  const label = state.status === 'loading' ? t('branchLoading')
    : state.status === 'error' ? t('branchLoadFailed')
    : state.status === 'no-repo' ? t('branchNotRepo')
    : state.detached ? t('branchDetached')
    : state.branch ?? t('branchDetached')
  const display = (state.branch !== null && !branches.includes(state.branch) ? [state.branch, ...branches] : branches)

  return (
    <span className="kb-branch-wrap" ref={wrapRef}>
      <button
        type="button"
        className={[
          'kb-branch-chip',
          state.status === 'error' || state.status === 'no-repo' ? 'kb-branch-chip--error' : '',
        ].filter(Boolean).join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('switchBranchTitle')}
        title={t('currentBranchTitle', { branch: state.branch ?? '' }) + (state.error ? `\n${state.error}` : '')}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false) }}
      >
        {state.status === 'loading' ? <IcSpinner size={11} className="kb-spin" /> : <IcBranch size={11} />}
        <span className="kb-branch-chip__name">{label}</span>
        <span className="kb-branch-chip__chevron"><IcChevronDown size={10} /></span>
      </button>
      {open ? (
        <div className="kb-branch-menu" role="menu" aria-label={t('switchBranchTitle')}>
          {display.length === 0 ? (
            <div className="kb-branch-menu__empty">{t('branchListEmpty')}</div>
          ) : display.map((b) => (
            <button
              key={b}
              type="button"
              role="menuitemradio"
              aria-checked={b === state.branch}
              className={['kb-branch-menu__item', b === state.branch ? 'kb-branch-menu__item--on' : ''].filter(Boolean).join(' ')}
              disabled={busy !== null}
              onClick={() => void doSwitch(b)}
            >
              <span className="kb-branch-menu__check">{b === state.branch ? <IcCheck size={11} /> : null}</span>
              <span className="kb-branch-menu__name">{b}</span>
              {busy === b ? <IcSpinner size={11} className="kb-spin" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
