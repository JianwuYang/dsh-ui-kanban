/**
 * Browser client for the embedded kanban app: talks to the host-side
 * `/kanban-api` bridge (registered by dsh-kanban host half) over the DSH web
 * server — same origin, so plain `fetch` works and no CORS/shape issues arise.
 * The bridge is the only place Jira/GitLab credentials live.
 * @module dsh-kanban/client/api
 */

export type StatusCategory = 'to do' | 'in progress' | 'done' | 'unknown'
export type GitlabListState = 'all' | 'opened' | 'closed' | 'merged'

export interface BoardStatus { id: string; name: string; category: StatusCategory; color?: string }
export interface BoardIssue {
  id: string; key: string; summary: string; description?: string | null
  status: BoardStatus; issueType?: string; priority?: string
  assignee?: string | null; reporter?: string | null; created?: string; updated?: string; url: string
}
export interface JiraTransitionOption { id: string; name: string; toStatus: BoardStatus }
export interface BoardIssueDetail extends BoardIssue {
  labels?: string[]; components?: string[]; commentCount?: number
  transitions: JiraTransitionOption[]; canDelete?: boolean; comments?: IssueComment[]
  descriptionHtml?: string
  attachments?: { id: string; filename: string; mimeType?: string; size?: number; url: string }[]
}
export interface IssueComment { id: string; author?: string; created?: string; body: string; bodyHtml?: string }

export interface JiraSettings { baseUrl: string; apiToken: string; projectKey: string; jql: string }
export interface GitLabBranch { name: string; marker?: string }
export interface GitLabSettings { baseUrl: string; apiToken: string; project: string; allowSelfSigned?: boolean; branches?: GitLabBranch[]; mrAutoLink?: boolean; mrLinkKeywords?: string; mrLinkMentions?: boolean }
export interface LocalRepoSettings { directory: string }
export interface AppSettings { jira?: JiraSettings; gitlab?: GitLabSettings; localRepo?: LocalRepoSettings }

export interface ProjectSummary { id: string; name: string; projectKey?: string; lastSyncedAt?: string | null; issueCount?: number }
export interface SettingsPayload { configured: boolean; settings: AppSettings | null }
export interface SyncMeta { configured: boolean; lastSyncedAt: string | null; projectKey?: string; jql?: string; jiraBaseUrl?: string; issueCount: number }
export interface SyncResult { ok: boolean; total: number; added: number; updated: number; lastSyncedAt: string | null; error?: string }

export interface CreateMeta { projectKey: string; issueTypes: { id: string; name: string }[]; fields: CreateMetaField[] }
export interface CreateMetaField { id: string; name: string; type?: string; required?: boolean; allowedValues?: string[]; hasDefaultValue?: boolean }
export interface CreateUserOption { name: string; displayName: string }
export interface GitlabIssue { id: number; iid: number; title: string; state: string; description?: string; author?: string; jiraKeys: string[]; mrIid?: number; webUrl?: string }
export interface GitlabMr { id: number; iid: number; title: string; state: string; sourceBranch?: string; targetBranch?: string; author?: string; jiraKeys: string[]; issueIids?: number[]; webUrl?: string }

export class ApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type only on requests that carry a body: the header is meaningless
  // on a GET and only invites a preflight.
  const headers = init?.body === undefined ? undefined : { 'Content-Type': 'application/json' }
  const res = await fetch(`/kanban-api${path}`, { ...init, ...(headers === undefined ? {} : { headers }) })
  const text = await res.text()
  const body = text ? (JSON.parse(text) as unknown) : undefined
  if (!res.ok) {
    const data = body as { error?: string; code?: string } | undefined
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, data?.code)
  }
  return body as T
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) })

/**
 * Which workspace a request targets: a bare string is a workspace/project
 * reference, the object form names a session (the registry's ownership truth),
 * its working directory, or an explicit workspace.
 */
export type ProjectTarget = string | { workspace?: string; cwd?: string; session?: string }

const targetParams = (t?: ProjectTarget): string => {
  if (t === undefined || t === null) return ''
  if (typeof t === 'string') return `project=${encodeURIComponent(t)}`
  const parts: string[] = []
  if (t.workspace) parts.push(`workspace=${encodeURIComponent(t.workspace)}`)
  if (t.cwd) parts.push(`cwd=${encodeURIComponent(t.cwd)}`)
  if (t.session) parts.push(`session=${encodeURIComponent(t.session)}`)
  return parts.join('&')
}

/** Query params (with a leading `?`) for a workspace target. */
const qs = (t?: ProjectTarget): string => {
  const params = targetParams(t)
  return params ? `?${params}` : ''
}

/** Append a workspace target to a path that may already carry a query string. */
const withTarget = (path: string, t?: ProjectTarget): string => {
  const params = targetParams(t)
  if (!params) return path
  return `${path}${path.includes('?') ? '&' : '?'}${params}`
}

export const api = {
  getMeta: (target?: ProjectTarget) => request<SyncMeta>(`/sync${qs(target)}`),
  getSettings: (target?: ProjectTarget) => request<SettingsPayload>(`/settings${qs(target)}`),
  saveSettings: (settings: AppSettings, target?: ProjectTarget) => request<{ ok: boolean }>(`/settings${qs(target)}`, { method: 'PUT', ...json(settings) }),
  getProjects: (target?: ProjectTarget) => request<{ projects: ProjectSummary[]; currentProjectId: string | null }>(`/projects${qs(target)}`),
  testSettings: (jira: JiraSettings) => request<{ ok: boolean; user?: string | null; error?: string | null }>('/settings/test', { method: 'POST', ...json({ jira }) }),
  testGitlab: (gitlab: GitLabSettings) => request<{ ok: boolean; user?: string | null; error?: string | null; recentBranches?: string[] }>('/settings/gitlab/test', { method: 'POST', ...json({ gitlab }) }),
  gitlabBranches: (q: string, target?: ProjectTarget) => request<{ branches: string[] }>(withTarget('/settings/gitlab/branches', target), { method: 'POST', ...json({ q }) }),
  getCreateMeta: (issueType?: string, target?: ProjectTarget) => request<CreateMeta>(withTarget(`/settings/createmeta${issueType ? `?issueType=${encodeURIComponent(issueType)}` : ''}`, target)),
  searchAssignees: (q: string, target?: ProjectTarget) => request<CreateUserOption[]>(withTarget(`/settings/assignees?q=${encodeURIComponent(q)}`, target)),
  sync: (options?: { jql?: string; assigneeSelf?: boolean; reporterSelf?: boolean }, target?: ProjectTarget) => request<SyncResult>(`/sync${qs(target)}`, { method: 'POST', ...(options ? json(options) : {}) }),
  getIssues: (target?: ProjectTarget) => request<BoardIssue[]>(`/issues${qs(target)}`),
  createIssue: (input: { summary: string; fields: Record<string, unknown> }, target?: ProjectTarget) => request<{ ok: boolean; issue: BoardIssue }>(`/issues${qs(target)}`, { method: 'POST', ...json(input) }),
  // Every issue-scoped call MUST carry the workspace target: the host resolves an
  // absent one to the *first* workspace, so a multi-workspace board would read a
  // key from (or write to) the wrong Jira project.
  getIssueDetail: (key: string, target?: ProjectTarget) => request<BoardIssueDetail>(withTarget(`/issues/${encodeURIComponent(key)}`, target)),
  transitionIssue: (key: string, transitionId: string, comment?: string, target?: ProjectTarget) => request<{ ok: boolean; issue: BoardIssue }>(withTarget(`/issues/${encodeURIComponent(key)}/transition`, target), { method: 'POST', ...json({ transitionId, ...(comment ? { comment } : {}) }) }),
  deleteIssue: (key: string, target?: ProjectTarget) => request<{ ok: boolean; key: string }>(withTarget(`/issues/${encodeURIComponent(key)}`, target), { method: 'DELETE' }),
  assignIssue: (key: string, payload: { name: string; comment?: string }, target?: ProjectTarget) => request<BoardIssueDetail>(withTarget(`/issues/${encodeURIComponent(key)}/assign`, target), { method: 'POST', ...json(payload) }),
  addComment: (key: string, body: string, target?: ProjectTarget) => request<{ ok: boolean }>(withTarget(`/issues/${encodeURIComponent(key)}/comments`, target), { method: 'POST', ...json({ body }) }),
  uploadAttachment: (key: string, payload: { filename: string; mime: string; dataBase64: string }, target?: ProjectTarget) => request<{ ok: boolean; filename: string }>(withTarget(`/issues/${encodeURIComponent(key)}/attachments`, target), { method: 'POST', ...json(payload) }),
  gitlabIssues: (state: GitlabListState, search: string, target?: ProjectTarget) => request<GitlabIssue[]>(withTarget(`/gitlab/issues?state=${state}&search=${encodeURIComponent(search)}`, target)),
  gitlabMrs: (state: GitlabListState, search: string, target?: ProjectTarget) => request<GitlabMr[]>(withTarget(`/gitlab/merge_requests?state=${state}&search=${encodeURIComponent(search)}`, target)),
  gitlabCreateIssueFromJira: (jiras: { key: string; summary: string }[], title?: string, description?: string, target?: ProjectTarget) => request<{ ok: boolean; issue: GitlabIssue }>(withTarget('/gitlab/issues', target), { method: 'POST', ...json({ jiras, ...(title ? { title } : {}), ...(description ? { description } : {}) }) }),
  gitlabCreateMr: (payload: { sourceBranch: string; targetBranch?: string; title?: string; issueIids: number[]; createBranch?: boolean }, target?: ProjectTarget) => request<{ ok: boolean; merge_request: GitlabMr }>(withTarget('/gitlab/merge_requests', target), { method: 'POST', ...json(payload) }),
  gitlabLinkJira: (iid: number, jiraKeys: string[], target?: ProjectTarget) => request<{ ok: boolean; issue: GitlabIssue }>(withTarget(`/gitlab/issues/${iid}/link-jira`, target), { method: 'POST', ...json({ jiraKeys }) }),
  gitlabUnlinkJira: (iid: number, keys: string[], target?: ProjectTarget) => request<{ ok: boolean }>(withTarget(`/gitlab/issues/${iid}/unlink-jira`, target), { method: 'POST', ...json({ keys }) }),
  gitlabLinkIssueToMr: (iid: number, mrIid: number, target?: ProjectTarget) => request<{ ok: boolean }>(withTarget(`/gitlab/issues/${iid}/mr`, target), { method: 'POST', ...json({ mrIid }) }),
  gitlabCloseIssue: (iid: number, target?: ProjectTarget) => request<{ ok: boolean }>(withTarget(`/gitlab/issues/${iid}/close`, target), { method: 'POST' }),
  gitlabCloseMr: (iid: number, target?: ProjectTarget) => request<{ ok: boolean }>(withTarget(`/gitlab/merge_requests/${iid}/close`, target), { method: 'POST' }),
  gitCheckout: (branch: string, target?: ProjectTarget) => request<{ ok: boolean; branch: string; error?: string }>(withTarget('/git/checkout', target), { method: 'POST', ...json({ branch }) }),
  gitCurrentBranch: (target?: ProjectTarget) => request<{ branch: string | null; detached: boolean; error?: string }>(withTarget('/git/current-branch', target)),
  gitBranches: (target?: ProjectTarget) => request<{ branches: string[]; current?: string | null; error?: string }>(withTarget('/git/branches', target)),
  syncPreview: (options?: { jql?: string; assigneeSelf?: boolean; reporterSelf?: boolean }, target?: ProjectTarget) => request<{ total: number; issues: { key: string; summary: string }[] }>(withTarget('/sync/preview', target), { method: 'POST', ...(options ? json(options) : {}) }),
}
