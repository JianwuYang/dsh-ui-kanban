/**
 * 嵌入式看板应用：作为 DSH 槽位里的一个全屏/浮窗 UI 组件。数据全部经由 host 侧的
 * `/kanban-api` 桥（同源 fetch），真实打通 Jira/GitLab。核心闭环：状态分组列表、
 * 同步、新建 issue、详情流转/评论、设置（项目/Jira/GitLab/本地仓库）。
 *
 * 本文件是应用壳（Providers + 状态 + 工具栏）；看板/列表在 kanban-board.tsx，
 * 全部弹窗在 kanban-modals.tsx，共用控件在 primitives.tsx，弹窗/toast 基建在
 * modal.tsx / toast.tsx。仅依赖 react + 主题变量。
 * @module dsh-kanban/client/kanban-app
 */

import React from 'react'
import { api, type BoardIssue, type GitlabMr, type ProjectSummary, type SettingsPayload, type SyncResult } from './api.ts'
import { BoardToolbar, IssueGroups } from './kanban-board.tsx'
import { CreateModal, DetailModal, GitLabPanel, SettingsModal, SyncModal } from './kanban-modals.tsx'
import { DialogsProvider } from './modal.tsx'
import { EmptyState, IconButton, SkeletonBoard, formatDateTime } from './primitives.tsx'
import { useT } from './locales.ts'
import { ToastProvider, useToast } from './toast.tsx'
import type { PromptContentPartLike } from './types.ts'
import { IcBoard, IcClose, IcGear, IcGitlab, IcPlus, IcSync, IcWarning } from './icons.tsx'

interface AppState {
  projects: ProjectSummary[]
  currentProjectId: string | null
  settings: SettingsPayload['settings']
  configured: boolean
  issues: BoardIssue[]
  meta: { lastSyncedAt: string | null; issueCount: number } | null
  search: string
  loading: boolean
  syncing: boolean
  error: string | null
  settingsOpen: boolean
  syncOpen: boolean
  createOpen: boolean
  detailKey: string | null
  gitlabOpen: boolean
  /** Jira key → opened MRs（卡片分支按钮的数据源；GitLab 未配置时为空）。 */
  mrByKey: ReadonlyMap<string, GitlabMr[]>
}

const initial: AppState = {
  projects: [], currentProjectId: null, settings: null, configured: false, issues: [],
  meta: null, search: '', loading: true, syncing: false,
  error: null, settingsOpen: false, syncOpen: false, createOpen: false, detailKey: null, gitlabOpen: false,
  mrByKey: new Map(),
}

/** 薄包装：应用内弹窗/toast 的 Provider 挂在最外层，KanbanAppInner 内部消费。 */
export function KanbanApp(props: {
  onClose: () => void; variant?: 'fullscreen' | 'panel'
  projectTarget?: string | { workspace?: string; cwd?: string }
  onSendToSession?: (key: string, target: 'current' | 'new', images?: PromptContentPartLike[]) => Promise<void>
}): React.ReactElement {
  return (
    <DialogsProvider>
      <ToastProvider>
        <KanbanAppInner {...props} />
      </ToastProvider>
    </DialogsProvider>
  )
}

function KanbanAppInner({ onClose, variant = 'fullscreen', projectTarget, onSendToSession }: {
  onClose: () => void; variant?: 'fullscreen' | 'panel'
  projectTarget?: string | { workspace?: string; cwd?: string }
  onSendToSession?: (key: string, target: 'current' | 'new', images?: PromptContentPartLike[]) => Promise<void>
}): React.ReactElement {
  const [state, setState] = React.useState<AppState>(initial)
  const toast = useToast()
  const t = useT()

  const patch = (p: Partial<AppState>): void => setState((s) => ({ ...s, ...p }))
  const active = state.projects.find((p) => p.id === state.currentProjectId) ?? state.projects[0]

  const load = React.useCallback(async (projectId?: string | null, silent = false): Promise<void> => {
    // silent = 已加载后的静默刷新（同步后/详情流转后），不闪骨架屏。
    if (!silent) patch({ loading: true, error: null })
    try {
      const projectsRes = await api.getProjects(projectTarget)
      const aid = projectId || projectsRes.currentProjectId || projectsRes.projects[0]?.id || null
      const [settings, issues, fullMeta] = await Promise.all([
        api.getSettings(aid ?? undefined), api.getIssues(aid ?? undefined), api.getMeta(aid ?? undefined),
      ])
      patch({
        projects: projectsRes.projects, currentProjectId: aid,
        settings: settings.settings, configured: settings.configured, issues,
        meta: { lastSyncedAt: fullMeta.lastSyncedAt, issueCount: fullMeta.issueCount },
        loading: false,
      })
      // 卡片分支按钮的索引：GitLab 已配置时拉 opened MR 并按 Jira key 建表。
      // 独立于主体加载（失败静默 → 按钮不出现即可），也随静默刷新保持最新。
      if (aid && settings.settings?.gitlab?.baseUrl && settings.settings?.gitlab?.project) {
        try {
          const mrs = await api.gitlabMrs('opened', '', aid)
          const by = new Map<string, GitlabMr[]>()
          for (const m of mrs) {
            for (const k of m.jiraKeys) {
              const list = by.get(k) ?? []
              list.push(m)
              by.set(k, list)
            }
          }
          patch({ mrByKey: by })
        } catch {
          patch({ mrByKey: new Map() })
        }
      } else {
        patch({ mrByKey: new Map() })
      }
    } catch (error) {
      patch({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }, [projectTarget])

  React.useEffect(() => { void load() }, [load])

  const openSettings = (): void => {
    if (state.configured) patch({ settingsOpen: true })
    else { toast(t('configJiraFirst')); patch({ settingsOpen: true }) }
  }

  const runSync = async (): Promise<void> => {
    if (!state.configured) { toast(t('configJiraFirst')); patch({ settingsOpen: true }); return }
    patch({ syncing: true, error: null })
    try {
      const result: SyncResult = await api.sync(undefined, state.currentProjectId ?? undefined)
      await load(state.currentProjectId ?? undefined, true)
      toast(t('syncDone', { total: result.total, added: result.added, updated: result.updated }))
    } catch (error) {
      toast(error instanceof Error ? error.message : t('syncFailed'), 'error')
    } finally {
      patch({ syncing: false })
    }
  }

  // 打开看板后自动从 Jira 同步（每个项目一次；未配置则静默跳过）。
  // 切换工作区（projectTarget 变化 → load → 新的 currentProjectId）后同样自动
  // 同步一次；本次打开期间已同步过的项目不重复同步。先展示缓存数据，同步后静默刷新。
  const syncedProjectsRef = React.useRef<ReadonlySet<string>>(new Set())
  React.useEffect(() => {
    if (state.loading || !state.configured || !state.currentProjectId) return
    if (syncedProjectsRef.current.has(state.currentProjectId)) return
    syncedProjectsRef.current = new Set(syncedProjectsRef.current).add(state.currentProjectId)
    void runSync()
  }, [state.loading, state.configured, state.currentProjectId, runSync])

  const openDetail = (key: string): void => patch({ detailKey: key })
  const saveSettings = async (next: NonNullable<SettingsPayload['settings']>): Promise<void> => {
    try {
      await api.saveSettings(next, state.currentProjectId ?? undefined)
      await load(state.currentProjectId ?? undefined, true)
      toast(t('settingsSaved'))
      patch({ settingsOpen: false })
    } catch (error) {
      throw error instanceof Error ? error : new Error(t('saveFailed'))
    }
  }

  const metaText = state.meta ? `${t('issuesCount', { n: state.meta.issueCount })}${state.meta.lastSyncedAt ? ` · ${t('syncedAt', { time: formatDateTime(state.meta.lastSyncedAt) })}` : ''}` : ''

  if (state.loading) {
    return (
      <div className={variant === 'panel' ? 'kkb-app kkb-app--panel' : 'kkb-app'}>
        <header className={variant === 'panel' ? 'kkb-app__bar kkb-app__bar--panel' : 'kkb-app__bar'}>
          <div className="kkb-app__barrow">
            <span className="kkb-app__brand"><span className="kkb-app__brandicon"><IcBoard size={16} /></span>{t('appBrand')}</span>
            <span className="kkb-app__spacer" />
            <IconButton icon={<IcClose size={14} />} label={t('closePanel')} ghost onClick={onClose} />
          </div>
        </header>
        <main className="kkb-app__main"><SkeletonBoard /></main>
      </div>
    )
  }

  const syncingIcon = <span style={{ display: 'inline-flex' }} className={state.syncing ? 'kb-spin' : ''}><IcSync size={13} /></span>

  return (
    <div className={variant === 'panel' ? 'kkb-app kkb-app--panel' : 'kkb-app'}>
      {variant === 'panel' ? (
        <header className="kkb-app__bar kkb-app__bar--panel">
          <div className="kkb-app__barrow">
            <span className="kkb-app__brand"><span className="kkb-app__brandicon"><IcBoard size={16} /></span>{t('appBrand')}</span>
            <span className="kkb-app__meta" title={metaText}>
              {active?.projectKey ? `${active.name} · ${active.projectKey}` : active ? active.name : ''}
              {state.meta ? ` · ${t('issuesCount', { n: state.meta.issueCount })}` : ''}
            </span>
            <span className="kkb-app__spacer" />
            <IconButton icon={<IcClose size={14} />} label={t('closePanel')} ghost onClick={onClose} />
          </div>
          <div className="kkb-app__barrow">
            <span className="kkb-app__spacer" />
            <button type="button" className="kb-btn" disabled={state.syncing} onClick={() => { if (state.configured) patch({ syncOpen: true }); else openSettings() }}>{syncingIcon}{state.syncing ? t('syncing') : t('sync')}</button>
            <button type="button" className="kb-btn kb-btn--primary" onClick={() => { if (state.configured) patch({ createOpen: true }); else openSettings() }}><IcPlus size={13} />{t('newIssue')}</button>
            <button type="button" className="kb-btn" onClick={() => patch({ gitlabOpen: true })}><IcGitlab size={13} />GitLab</button>
            <button type="button" className="kb-btn" onClick={() => patch({ settingsOpen: true })}><IcGear size={13} />{t('settings')}</button>
          </div>
        </header>
      ) : (
        <header className="kkb-app__bar">
          <span className="kkb-app__brand"><span className="kkb-app__brandicon"><IcBoard size={16} /></span>dsh-kanban</span>
          <span className="kkb-app__meta" title={metaText}>
            {active?.projectKey ? `${active.name} · ${active.projectKey}` : active ? active.name : ''}
            {state.meta ? ` · ${t('issuesCount', { n: state.meta.issueCount })}` : ''}
          </span>
          <span className="kkb-app__spacer" />
          <button type="button" className="kb-btn" disabled={state.syncing} onClick={() => { if (state.configured) patch({ syncOpen: true }); else openSettings() }}>{syncingIcon}{state.syncing ? t('syncing') : t('sync')}</button>
          <button type="button" className="kb-btn kb-btn--primary" onClick={() => { if (state.configured) patch({ createOpen: true }); else openSettings() }}><IcPlus size={13} />{t('newIssue')}</button>
          <button type="button" className="kb-btn" onClick={() => patch({ gitlabOpen: true })}><IcGitlab size={13} />GitLab</button>
          <button type="button" className="kb-btn" onClick={() => patch({ settingsOpen: true })}><IcGear size={13} />{t('settings')}</button>
          <IconButton icon={<IcClose size={14} />} label={t('closePanel')} ghost onClick={onClose} />
        </header>
      )}

      {state.error ? (
        <div className="kb-banner" role="alert">
          <span className="kb-banner__icon"><IcWarning size={14} /></span>
          <span>{state.error}</span>
        </div>
      ) : null}

      <main className="kkb-app__main">
        {!state.configured
          ? <EmptyState icon={<IcBoard size={20} />} title={t('notConfiguredTitle')} hint={t('notConfiguredHint')}
              action={<button className="kb-btn kb-btn--primary" onClick={() => patch({ settingsOpen: true })}><IcGear size={13} />{t('openSettings')}</button>} />
          : state.issues.length === 0
            ? <EmptyState icon={<IcSync size={20} />} title={state.syncing ? t('autoSyncingTitle') : t('noSyncTitle')}
                hint={state.syncing ? t('autoSyncingHint') : t('noSyncHint')}
                action={<button className="kb-btn kb-btn--primary" disabled={state.syncing} onClick={() => patch({ syncOpen: true })}>{syncingIcon}{state.syncing ? t('syncing') : t('sync')}</button>} />
            : <>
                <BoardToolbar search={state.search} onSearch={(v) => patch({ search: v })}
                  meta={state.meta?.lastSyncedAt ? t('syncedAt', { time: formatDateTime(state.meta.lastSyncedAt) }) : ''} />
                <IssueGroups issues={state.issues} onOpen={openDetail} search={state.search}
                  mrByKey={state.mrByKey} target={state.currentProjectId ?? undefined} />
              </>}
      </main>

      {state.settingsOpen
        ? <SettingsModal settings={state.settings} onClose={() => patch({ settingsOpen: false })} onSave={saveSettings} /> : null}
      {state.syncOpen
        ? <SyncModal projectKey={active?.projectKey ?? ''} defaultJql={state.settings?.jira?.jql ?? ''} target={state.currentProjectId ?? undefined}
            onClose={() => patch({ syncOpen: false })}
            onSynced={(result) => {
              patch({ syncOpen: false })
              void load(undefined, true)
              toast(t('syncDone', { total: result.total, added: result.added, updated: result.updated }))
            }} /> : null}
      {state.createOpen
        ? <CreateModal target={state.currentProjectId ?? undefined} onClose={() => patch({ createOpen: false })} onCreated={() => { patch({ createOpen: false }); void load(undefined, true) }} /> : null}
      {state.detailKey
        ? <DetailModal key={state.detailKey} issueKey={state.detailKey} target={state.currentProjectId ?? undefined} onClose={() => patch({ detailKey: null })} onChanged={() => void load(undefined, true)} onSendToSession={onSendToSession} /> : null}
      {state.gitlabOpen
        ? <GitLabPanel onClose={() => patch({ gitlabOpen: false })} projectId={state.currentProjectId} jiraIssues={state.issues} /> : null}
    </div>
  )
}
