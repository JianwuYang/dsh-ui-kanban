import { execFile } from 'node:child_process'
import { createKanbanStore, resolveDataDir, type LinksFile } from './backend/storage.ts'
import * as jira from './backend/jira.ts'
import * as gitlab from './backend/gitlab.ts'
import { composeJql, type BoardIssue, type BoardIssueDetail, type CreateIssueRequest, type CreateIssueResponse, type CreateMeta, type GitlabIssue, type GitlabListState, type GitlabMr, type GitLabSettings, type JiraSettings, type ProjectSummary, type SyncMeta, type SyncOptions, type SyncResult } from './backend/types.ts'
import type { Config, KanbanProject, KanbanProjectOverride } from './config.ts'

/** The store shape produced by {@link createKanbanStore}. */
export type KanbanStore = ReturnType<typeof createKanbanStore>

/** GitLab 项目页面基址（baseUrl + 规范化后的项目路径），用于拼议题/MR 的 web 链接。 */
function gitlabWebBase(settings: GitLabSettings): string {
  return `${settings.baseUrl.replace(/\/+$/, '')}/${gitlab.projectPath(settings.project)}`
}

/** The minimal structural face of a DSH workspace this backend depends on. */
export interface WorkspaceLike {
  id: string
  title: string
  path: string
}

/** How the backend enumerates/resolves workspaces (wraps the registry). */
export interface WorkspaceProvider {
  list(): WorkspaceLike[]
  resolveByPath(path: string): WorkspaceLike | undefined
}

/**
 * Host-half kanban backend: derives one project per DSH workspace (merging the
 * global Jira/GitLab host+token with the workspace override), resolves the
 * active project from a workspace path / id, and runs all Jira / GitLab ops.
 *
 * The config is read fresh on every call (via `getConfig`), so a settings write
 * (or a `configSource` fallback) takes effect immediately without a restart.
 */
export class KanbanBackend {
  private store: KanbanStore | null = null

  constructor(
    private readonly getConfig: () => Config,
    private readonly getWorkspaces: () => WorkspaceProvider,
  ) {}

  /** The store bound to the current data dir (recreated when `dataDir` changes). */
  private storeFor(): KanbanStore {
    const dir = resolveDataDir(this.getConfig().dataDir)
    if (!this.store || this.store.getDataDir() !== dir) this.store = createKanbanStore(dir)
    return this.store
  }

  private overrideFor(id: string): KanbanProjectOverride | undefined {
    return this.getConfig().projects.find((p) => p.id === id)
  }

  /** Merge a workspace with the global defaults + its per-workspace override. */
  private deriveProject(ws: WorkspaceLike, config: Config, override?: KanbanProjectOverride): KanbanProject {
    const jiraGlobal = config.jira ?? { baseUrl: '', apiToken: '' }
    const gitlabGlobal = config.gitlab ?? { baseUrl: '', apiToken: '' }
    // Legacy fallback: a pre-refactor project stored its OWN baseUrl/apiToken next
    // to projectKey. Treat those as a per-workspace override when the global is
    // empty, so an existing config keeps working after the host/token split.
    const legacyJira = override?.jira as { baseUrl?: string; apiToken?: string } | undefined
    const legacyGitlab = override?.gitlab as { baseUrl?: string; apiToken?: string } | undefined
    return {
      id: ws.id,
      name: (override?.name && override.name.trim()) || ws.title,
      jira: {
        baseUrl: jiraGlobal.baseUrl || legacyJira?.baseUrl || '',
        apiToken: jiraGlobal.apiToken || legacyJira?.apiToken || '',
        projectKey: override?.jira?.projectKey ?? '',
        jql: override?.jira?.jql ?? '',
      },
      gitlab: {
        baseUrl: gitlabGlobal.baseUrl || legacyGitlab?.baseUrl || '',
        apiToken: gitlabGlobal.apiToken || legacyGitlab?.apiToken || '',
        project: override?.gitlab?.project ?? '',
        allowSelfSigned: config.allowSelfSigned ?? true,
        mrAutoLink: override?.gitlab?.mrAutoLink ?? true,
        mrLinkKeywords: override?.gitlab?.mrLinkKeywords ?? '',
        mrLinkMentions: override?.gitlab?.mrLinkMentions ?? true,
      },
      localRepo: { directory: (override?.localRepo?.directory && override.localRepo.directory.trim()) || ws.path },
    }
  }

  /** All workspaces as a stable list. */
  private workspaceList(): WorkspaceLike[] {
    try {
      return this.getWorkspaces().list()
    } catch {
      return []
    }
  }

  /** Resolve a workspace by canonical path (exact, then normalized). */
  workspaceForPath(path?: string | null): WorkspaceLike | undefined {
    const p = (path ?? '').trim()
    if (!p) return undefined
    const all = this.workspaceList()
    return all.find((w) => w.path === p)
      ?? all.find((w) => normalizePath(w.path) === normalizePath(p))
  }

  /** Resolve the active project: the workspace for `cwd`, else the first workspace. */
  activeProject(cwd?: string): KanbanProject | null {
    const config = this.getConfig()
    const ws = this.workspaceForPath(cwd) ?? this.workspaceList()[0]
    if (!ws) return null
    return this.deriveProject(ws, config, this.overrideFor(ws.id))
  }

  /** Resolve a project by id, name, title, or workspace path; empty => active. */
  resolveProject(ref?: string | null, cwd?: string): KanbanProject | null {
    const config = this.getConfig()
    const r = (ref ?? '').trim()
    if (!r) return this.activeProject(cwd)
    const all = this.workspaceList()
    const byOverride = config.projects.find((p) => p.id === r || p.name === r)
    let ws: WorkspaceLike | undefined
    if (byOverride !== undefined) {
      ws = all.find((w) => w.id === byOverride.id)
    } else {
      ws = all.find((w) => w.id === r || w.title === r || w.path === r)
    }
    if (ws === undefined) return null
    return this.deriveProject(ws, config, byOverride ?? this.overrideFor(ws.id))
  }

  /** Resolve any project (id/name/path) or throw a helpful error. */
  requireProject(ref?: string | null, cwd?: string): KanbanProject {
    const project = this.resolveProject(ref, cwd)
    if (!project) throw new Error(`no kanban project for ${ref ? `"${ref}"` : 'this workspace'}`)
    return project
  }

  private requireJira(project: KanbanProject): JiraSettings {
    const settings = project.jira
    if (!settings || !settings.baseUrl || !settings.projectKey) {
      throw new Error(`project "${project.name}" has no Jira connection configured`)
    }
    return settings
  }

  private requireGitlab(project: KanbanProject) {
    const settings = project.gitlab
    if (!settings || !settings.baseUrl || !settings.project) {
      throw new Error(`project "${project.name}" has no GitLab connection configured`)
    }
    return settings.allowSelfSigned === undefined
      ? { ...settings, allowSelfSigned: this.getConfig().allowSelfSigned ?? true }
      : settings
  }

  /** Read-only data dir (for a health/diagnostic tool). */
  dataDir(): string {
    return resolveDataDir(this.getConfig().dataDir)
  }

  /** The currently-resolved live config (for tools that must read it directly). */
  config(): Config {
    return this.getConfig()
  }

  /**
   * Find the project whose Jira base URL origin matches `imageUrl`, so the
   * `/kanban-api/attachment-proxy` route can fetch the image with the right
   * host + token (the browser is not authenticated to Jira).
   */
  projectForJiraUrl(imageUrl: string): KanbanProject | null {
    let target: URL
    try {
      target = new URL(imageUrl)
    } catch {
      return null
    }
    const origin = target.origin
    for (const ws of this.workspaceList()) {
      const project = this.deriveProject(ws, this.getConfig(), this.overrideFor(ws.id))
      if (project.jira?.baseUrl) {
        try {
          if (new URL(project.jira.baseUrl).origin === origin) return project
        } catch {
          // ignore malformed baseUrl
        }
      }
    }
    return null
  }

  /* ---------------------------- projects --------------------------- */

  /** List all projects (one per workspace) with per-project display metadata. */
  async listProjects(): Promise<ProjectSummary[]> {
    const config = this.getConfig()
    const store = this.storeFor()
    return Promise.all(
      this.workspaceList().map(async (ws) => {
        const project = this.deriveProject(ws, config, this.overrideFor(ws.id))
        const meta = await store.readMeta(ws.id)
        return {
          id: ws.id,
          name: project.name,
          projectKey: project.jira?.projectKey,
          lastSyncedAt: meta?.lastSyncedAt ?? null,
          issueCount: meta?.issueCount ?? 0,
        } satisfies ProjectSummary
      }),
    )
  }

  /* ---------------------------- sync ------------------------------- */

  /** Pull matching issues from Jira and replace the cache for the project. */
  async sync(project: KanbanProject, opts: SyncOptions = {}): Promise<SyncResult> {
    const store = this.storeFor()
    const jiraSettings = this.requireJira(project)
    const jql = composeJql(jiraSettings.projectKey, opts.jql ?? jiraSettings.jql, opts.assigneeSelf ?? true, opts.reporterSelf ?? false)
    const issues = await jira.fetchIssues(jiraSettings, jql)
    const existing = await store.readIssues(project.id)
    const existingByKey = new Map(existing.map((i) => [i.key, i]))
    // "updated" means the issue's cached copy actually differs from what Jira
    // now returns (a real refresh), not merely that the key overlaps.
    const added = issues.filter((i) => !existingByKey.has(i.key)).length
    const updated = issues.filter((i) => {
      const prev = existingByKey.get(i.key)
      return prev !== undefined && JSON.stringify(prev) !== JSON.stringify(i)
    }).length
    await store.writeIssues(project.id, issues)
    const lastSyncedAt = new Date().toISOString()
    await store.writeMeta(project.id, {
      lastSyncedAt,
      projectKey: jiraSettings.projectKey,
      jql: jiraSettings.jql,
      jiraBaseUrl: jiraSettings.baseUrl,
      issueCount: issues.length,
    })
    return { ok: true, total: issues.length, added, updated, lastSyncedAt }
  }

  /** Sync metadata (without syncing). */
  async syncMeta(project: KanbanProject): Promise<SyncMeta> {
    const store = this.storeFor()
    const meta = await store.readMeta(project.id)
    return {
      configured: Boolean(project.jira?.projectKey && project.jira?.baseUrl),
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      projectKey: meta?.projectKey,
      jql: meta?.jql,
      jiraBaseUrl: meta?.jiraBaseUrl,
      issueCount: meta?.issueCount ?? 0,
    }
  }

  /** Preview a sync: what the current JQL would pull, without writing the cache. */
  async syncPreview(project: KanbanProject, opts: SyncOptions = {}): Promise<{ total: number; issues: { key: string; summary: string }[] }> {
    const jiraSettings = this.requireJira(project)
    const jql = composeJql(jiraSettings.projectKey, opts.jql ?? jiraSettings.jql, opts.assigneeSelf ?? true, opts.reporterSelf ?? false)
    return jira.searchIssuesPreview(jiraSettings, jql)
  }

  /* ---------------------------- issues ----------------------------- */

  /** Cached issues for the board. */
  async listIssues(project: KanbanProject): Promise<BoardIssue[]> {
    return this.storeFor().readIssues(project.id)
  }

  /** Live detail + transitions + comments for one issue. */
  async issueDetail(project: KanbanProject, key: string): Promise<BoardIssueDetail> {
    const jiraSettings = this.requireJira(project)
    const { issue, detail } = await jira.fetchIssueDetail(jiraSettings, key)
    const transitions = jira.toTransitionOptions(await jira.fetchTransitions(jiraSettings, key))
    const labels = (issue.fields as unknown as { labels?: string[] }).labels ?? []
    const components = ((issue.fields as unknown as { components?: { name?: string }[] }).components ?? [])
      .map((c) => c.name).filter((n): n is string => Boolean(n))
    const commentCount = ((issue.fields as unknown as { comment?: { comments?: unknown[] } }).comment?.comments ?? []).length
    return {
      ...detail,
      labels,
      components,
      commentCount,
      transitions,
      canDelete: await jira.canDeleteIssue(jiraSettings, issue),
      comments: jira.buildComments(issue),
    }
  }

  /** Move an issue through a transition, then refresh its cached status. */
  async move(project: KanbanProject, key: string, transitionId: string, comment?: string): Promise<BoardIssue> {
    const jiraSettings = this.requireJira(project)
    await jira.transitionIssue(jiraSettings, key, transitionId, comment)
    const { detail } = await jira.fetchIssueDetail(jiraSettings, key)
    await this.patchCachedIssue(project, key, detail)
    return detail
  }

  /** Create a Jira issue and insert it into the cache. */
  async createIssue(project: KanbanProject, input: CreateIssueRequest): Promise<CreateIssueResponse> {
    const jiraSettings = this.requireJira(project)
    const { issue } = await jira.createIssue(jiraSettings, input)
    const store = this.storeFor()
    const issues = await store.readIssues(project.id)
    if (!issues.some((i) => i.key === issue.key)) {
      await store.writeIssues(project.id, [issue, ...issues])
    }
    return { ok: true, issue }
  }

  /** Add a comment to an issue. */
  /** Assign an issue to a user (Jira username), optionally with a comment; returns the updated detail. */
  async assign(project: KanbanProject, key: string, username: string, comment?: string): Promise<BoardIssueDetail> {
    const jiraSettings = this.requireJira(project)
    await jira.assignIssue(jiraSettings, key, username, comment)
    return this.issueDetail(project, key)
  }

  async addComment(project: KanbanProject, key: string, body: string): Promise<void> {
    const jiraSettings = this.requireJira(project)
    await jira.addComment(jiraSettings, key, body)
  }

  /** Upload an image (base64) as an issue attachment, returning its filename. */
  async addAttachment(project: KanbanProject, key: string, filename: string, dataBase64: string): Promise<string> {
    const jiraSettings = this.requireJira(project)
    return jira.addAttachment(jiraSettings, key, filename, dataBase64)
  }

  /** Create-form metadata (issue types + field list) for the project. */
  async createMeta(project: KanbanProject, issueTypeId?: string): Promise<CreateMeta> {
    const jiraSettings = this.requireJira(project)
    return jira.fetchCreateMeta(jiraSettings, issueTypeId)
  }

  /** The transitions currently available for one issue. */
  async transitions(project: KanbanProject, key: string): Promise<{ id: string; name: string; toStatus: BoardIssue['status'] }[]> {
    const jiraSettings = this.requireJira(project)
    return jira.toTransitionOptions(await jira.fetchTransitions(jiraSettings, key))
  }

  /** Delete an issue (reporter only) and drop it from the cache. */
  async deleteIssue(project: KanbanProject, key: string): Promise<{ ok: boolean; key: string }> {
    const jiraSettings = this.requireJira(project)
    const { issue } = await jira.fetchIssueDetail(jiraSettings, key)
    if (!(await jira.canDeleteIssue(jiraSettings, issue))) {
      throw new Error('only the reporter can delete this issue')
    }
    await jira.deleteIssue(jiraSettings, key)
    const store = this.storeFor()
    const issues = await store.readIssues(project.id)
    const next = issues.filter((i) => i.key !== key)
    await store.writeIssues(project.id, next)
    const meta = await store.readMeta(project.id)
    await store.writeMeta(project.id, { issueCount: next.length, lastSyncedAt: meta?.lastSyncedAt ?? null })
    return { ok: true, key }
  }

  /** Verify the Jira connection without saving. */
  async testJira(project: KanbanProject): Promise<{ ok: boolean; user?: string | null; error?: string | null }> {
    const jiraSettings = this.requireJira(project)
    try {
      const result = await jira.testConnection(jiraSettings) as { name?: string; key?: string } | undefined
      return { ok: true, user: result?.name ?? result?.key ?? 'user' }
    } catch (error) {
      return { ok: false, user: null, error: jira.toErrorMessage(error) }
    }
  }

  /** Search Jira users for the assignee combobox. */
  async assignees(project: KanbanProject, query: string): Promise<{ name: string; displayName: string }[]> {
    const jiraSettings = this.requireJira(project)
    return jira.searchCreateUsers(jiraSettings, query)
  }

  private async patchCachedIssue(project: KanbanProject, key: string, detail: BoardIssue): Promise<void> {
    const store = this.storeFor()
    const issues = await store.readIssues(project.id)
    const idx = issues.findIndex((i) => i.key === key)
    if (idx < 0) return
    const next = [...issues]
    next[idx] = detail
    await store.writeIssues(project.id, next)
  }

  /* ---------------------------- gitlab ----------------------------- */

  /** GitLab issues for the project, with Jira links attached. */
  async gitlabIssues(project: KanbanProject, state: GitlabListState, search: string): Promise<GitlabIssue[]> {
    const settings = this.requireGitlab(project)
    const links = await this.storeFor().readLinks(project.id)
    const raw = await gitlab.listGitlabIssues(settings, state, search)
    // Reverse cross-references (MR description → issue): derive `mrIid` for
    // issues referenced by MRs, so web-created MRs link up too. One extra call,
    // bounded to the 100 most recent MRs.
    const autoLink = settings.mrAutoLink ?? true
    const refMr = new Map<number, number>()
    if (autoLink) {
      const mrs = await gitlab.listGitlabMrs(settings, 'all', '', 1, 100)
      for (const m of mrs) {
        for (const iid of gitlab.parseMrIssueRefs(m.description, mrLinkKeywords(settings), settings.mrLinkMentions ?? true)) {
          if (!refMr.has(iid)) refMr.set(iid, m.iid)
        }
      }
    }
    return raw.map((r) => ({
      id: r.id,
      iid: r.iid,
      title: r.title,
      state: r.state,
      description: r.description,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      author: (r.author as { username?: string } | undefined)?.username,
      jiraKeys: links.issueJira[String(r.iid)] ?? [],
      mrIid: links.issueMr[String(r.iid)]
        ? Number(links.issueMr[String(r.iid)])
        : refMr.get(r.iid),
      webUrl: `${gitlabWebBase(settings)}/-/issues/${r.iid}`,
    }))
  }

  /** GitLab merge requests for the project, with Jira keys attached. */
  async gitlabMrs(project: KanbanProject, state: GitlabListState, search: string): Promise<GitlabMr[]> {
    const settings = this.requireGitlab(project)
    const links = await this.storeFor().readLinks(project.id)
    const raw = await gitlab.listGitlabMrs(settings, state, search)
    const autoLink = settings.mrAutoLink ?? true
    return raw.map((r) => {
      const parsed = autoLink
        ? gitlab.parseMrIssueRefs(r.description, mrLinkKeywords(settings), settings.mrLinkMentions ?? true)
        : []
      const issueIids = [...new Set([
        ...Object.entries(links.issueMr)
          .filter(([, mr]) => Number(mr) === r.iid)
          .map(([iid]) => Number(iid)),
        ...parsed,
      ])]
      const jiraSet = new Set<string>()
      for (const iid of issueIids) {
        for (const k of links.issueJira[String(iid)] ?? []) jiraSet.add(k)
      }
      return {
        id: r.id,
        iid: r.iid,
        title: r.title,
        state: r.state,
        sourceBranch: r.source_branch,
        targetBranch: r.target_branch,
        author: (r.author as { username?: string } | undefined)?.username,
        createdAt: r.created_at,
        jiraKeys: [...jiraSet],
        issueIids,
        webUrl: `${gitlabWebBase(settings)}/-/merge_requests/${r.iid}`,
      }
    })
  }

  /** Create a GitLab issue from one or more Jira issues and record the links. */
  async gitlabCreateIssueFromJira(
    project: KanbanProject,
    jiras: { key: string; summary: string }[],
    title?: string,
    description?: string,
  ): Promise<GitlabIssue> {
    const settings = this.requireGitlab(project)
    const numbers = jiras.map((j) => j.key).join('、')
    const fallbackTitle = title || `${numbers} ${jiras[0]?.summary ?? ''}`.trim()
    const fallbackDesc = description || `${numbers} ${jiras[0]?.summary ?? ''}`.trim()
    const created = await gitlab.createGitlabIssue(settings, fallbackTitle, fallbackDesc)
    const links = await this.storeFor().readLinks(project.id)
    links.issueJira[String(created.iid)] = jiras.map((j) => j.key)
    await this.storeFor().writeLinks(project.id, links)
    return {
      id: created.id,
      iid: created.iid,
      title: created.title,
      state: created.state,
      description: created.description,
      author: (created.author as { username?: string } | undefined)?.username,
      jiraKeys: jiras.map((j) => j.key),
      webUrl: `${gitlabWebBase(settings)}/-/issues/${created.iid}`,
    }
  }

  /** Link one or more Jira keys to an existing GitLab issue. */
  async gitlabLinkJira(project: KanbanProject, iid: number, jiraKeys: string[]): Promise<GitlabIssue> {
    const settings = this.requireGitlab(project)
    const links = await this.storeFor().readLinks(project.id)
    links.issueJira[String(iid)] = [...new Set([...(links.issueJira[String(iid)] ?? []), ...jiraKeys])]
    await this.storeFor().writeLinks(project.id, links)
    const raw = (await gitlab.listGitlabIssues(settings, 'all', String(iid))).find((i) => i.iid === iid)
    if (!raw) throw new Error(`GitLab issue !${iid} not found`)
    return {
      id: raw.id,
      iid: raw.iid,
      title: raw.title,
      state: raw.state,
      author: (raw.author as { username?: string } | undefined)?.username,
      jiraKeys: links.issueJira[String(iid)] ?? [],
      webUrl: `${gitlabWebBase(settings)}/-/issues/${raw.iid}`,
    }
  }

  /** Remove one or more Jira keys from a GitLab issue's link store. */
  async gitlabUnlinkJira(project: KanbanProject, iid: number, keys: string[]): Promise<{ ok: boolean }> {
    await this.requireGitlab(project)
    const links = await this.storeFor().readLinks(project.id)
    const existing = links.issueJira[String(iid)] ?? []
    links.issueJira[String(iid)] = existing.filter((k) => !keys.includes(k))
    await this.storeFor().writeLinks(project.id, links)
    return { ok: true }
  }

  /** Associate an existing GitLab issue with an existing MR. */
  async gitlabLinkIssueToMr(project: KanbanProject, iid: number, mrIid: number): Promise<{ ok: boolean }> {
    await this.requireGitlab(project)
    const links = await this.storeFor().readLinks(project.id)
    links.issueMr[String(iid)] = String(mrIid)
    await this.storeFor().writeLinks(project.id, links)
    return { ok: true }
  }

  /** Create a merge request (optionally creating the branch first) and link issues. */
  async gitlabCreateMr(
    project: KanbanProject,
    params: { sourceBranch: string; targetBranch?: string; title?: string; issueIids: number[]; createBranch?: boolean },
  ): Promise<GitlabMr> {
    const settings = this.requireGitlab(project)
    const target = params.targetBranch || 'main'
    if (params.createBranch) {
      await gitlab.createGitlabBranch(settings, params.sourceBranch, target)
    }
    // Write `Closes #iid` lines for the linked issues so GitLab's own UI shows
    // the native cross-references (auto-close on merge), not just our local store.
    const closes = params.issueIids.map((iid) => `Closes #${iid}`).join('\n')
    const mr = await gitlab.createGitlabMr(settings, {
      source_branch: params.sourceBranch,
      target_branch: target,
      title: params.title,
      description: params.title ? `${params.title}\n\n${closes}` : closes,
    })
    const links = await this.storeFor().readLinks(project.id)
    for (const iid of params.issueIids) links.issueMr[String(iid)] = String(mr.iid)
    await this.storeFor().writeLinks(project.id, links)
    const jiraSet = new Set<string>()
    for (const iid of params.issueIids) {
      for (const k of links.issueJira[String(iid)] ?? []) jiraSet.add(k)
    }
    return {
      id: mr.id,
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      author: (mr.author as { username?: string } | undefined)?.username,
      createdAt: mr.created_at,
      jiraKeys: [...jiraSet],
      issueIids: params.issueIids,
      webUrl: `${gitlabWebBase(settings)}/-/merge_requests/${mr.iid}`,
    }
  }

  async gitlabCloseIssue(project: KanbanProject, iid: number): Promise<{ ok: boolean }> {
    const settings = this.requireGitlab(project)
    await gitlab.closeGitlabIssue(settings, iid)
    return { ok: true }
  }

  async gitlabCloseMr(project: KanbanProject, iid: number): Promise<{ ok: boolean }> {
    const settings = this.requireGitlab(project)
    await gitlab.closeGitlabMr(settings, iid)
    return { ok: true }
  }

  async gitlabBranches(project: KanbanProject, query: string): Promise<string[]> {
    const settings = this.requireGitlab(project)
    return gitlab.searchGitlabBranches(settings, query)
  }

  async gitlabTest(project: KanbanProject): Promise<{ ok: boolean; user?: string | null; error?: string | null; recentBranches?: string[] }> {
    const settings = this.requireGitlab(project)
    return gitlab.testGitlabConnection(settings)
  }

  /** Switch the project's local repo to a branch: `git fetch --all` then `git checkout`. */
  async gitCheckout(project: KanbanProject, branch: string): Promise<{ ok: boolean; branch: string; error?: string }> {
    const dir = project.localRepo?.directory?.trim()
    if (!dir) throw new Error(`workspace "${project.name}" has no local repo configured`)
    // Defense-in-depth: execFile 不经过 shell，这里再限制分支名字符（git 规则的精简版）。
    if (!/^(?![-/])(?!.*\.\.)[A-Za-z0-9._/-]+(?<![./])$/.test(branch)) throw new Error(`invalid branch name: "${branch}"`)
    const run = (args: string[]): Promise<{ code: number; stderr: string }> =>
      new Promise((resolve) => {
        execFile('git', ['-C', dir, ...args], { timeout: 60_000 }, (error, _stdout, stderr) => {
          resolve({ code: error ? Number((error as { code?: unknown }).code) || 1 : 0, stderr: String(stderr ?? '').trim() })
        })
      })
    // 先同步远端：刚在 GitLab 上新建的分支本地还不存在，fetch 后 `git checkout`
    // 的 DWIM 行为会自动建同名跟踪分支。
    const fetched = await run(['fetch', '--quiet', '--all'])
    const checked = await run(['checkout', branch])
    if (checked.code !== 0) {
      const reason = checked.stderr || (fetched.code !== 0 ? fetched.stderr : '')
      return { ok: false, branch, error: reason || 'git checkout failed' }
    }
    return { ok: true, branch }
  }
}

/** Normalize a path for the workspace-path fallback match (no realpath here). */
function normalizePath(p: string): string {
  return p.replace(/\/+$/, '')
}

/** Effective closing-keyword list for MR cross-reference parsing (config, or GitLab's official list). */
function mrLinkKeywords(settings: GitLabSettings): string[] {
  const custom = (settings.mrLinkKeywords ?? '')
    .split(/[,，]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return custom.length ? custom : gitlab.GITLAB_CLOSING_KEYWORDS
}

/** Convenience export so the config-carrying project type is visible to tools. */
export type { LinksFile }
