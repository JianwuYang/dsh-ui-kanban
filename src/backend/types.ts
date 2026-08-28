/**
 * Shared contracts between the kanban tools (host half) and the client board
 * view. These mirror the `@ui-kanban/shared` package from the original
 * ui-kanban project, but are self-contained here so the plugin carries no
 * cross-package dependency.
 *
 * The shapes are `type` aliases (not `interface`s) so object literals built
 * from them remain assignable to the `JsonValue` index-signature type dsh
 * tools require of their output values.
 */

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Jira Server / Data Center connection configuration for one project. */
export type JiraSettings = {
  /** Jira base URL, e.g. `https://jira.example.com`. */
  baseUrl: string
  /** Jira Personal Access Token (bearer token). Host-only. */
  apiToken: string
  /** Project key, e.g. `PROJ`. */
  projectKey: string
  /** JQL filter (without `project = <key>`, which is auto-appended). */
  jql: string
}

/**
 * Build the full JQL run against Jira: `project = <key>` is always prepended,
 * then the user filter, then a "me" clause. A leading `project = …` in `filter`
 * is stripped so legacy JQL doesn't duplicate it.
 */
export function composeJql(
  projectKey: string,
  filter: string,
  assigneeSelf: boolean,
  reporterSelf: boolean,
): string {
  let f = (filter ?? '').trim()
  f = f.replace(/^project\s*=\s*[^\s]+(\s+AND\s+)?/i, '')
  const parts = [`project = ${projectKey}`]
  if (f) parts.push(f)
  const self: string[] = []
  if (assigneeSelf) self.push('assignee = currentUser()')
  if (reporterSelf) self.push('reporter = currentUser()')
  if (self.length) parts.push(self.length > 1 ? `(${self.join(' OR ')})` : self[0]!)
  return parts.join(' AND ')
}

/** A configured GitLab branch (the first / pinned one is the main branch). */
export type GitLabBranch = {
  name: string
  marker?: string
}

/** GitLab connection configuration (self-hosted / private instance). */
export type GitLabSettings = {
  baseUrl: string
  apiToken: string
  /** Project path (e.g. `group/repo`) or id, or a full URL. */
  project: string
  /** Accept the server's TLS cert without validation (self-signed). */
  allowSelfSigned?: boolean
  /** Configured branches (a main branch is always present). */
  branches?: GitLabBranch[]
  /** Auto-derive MR ↔ issue links from cross-references in MR descriptions. */
  mrAutoLink?: boolean
  /** Comma-separated closing keywords; empty => GitLab's official word list. */
  mrLinkKeywords?: string
  /** A plain `#123` mention counts as a (non-closing) link. */
  mrLinkMentions?: boolean
}

/** Result of a GitLab connectivity test (includes the recent branch list). */
export type GitlabConnectionResult = {
  ok: boolean
  user?: string | null
  error?: string | null
  recentBranches?: string[]
}

/** Local repository (checked-out working copy) configuration. */
export type LocalRepoSettings = {
  directory: string
}

/** Everything the user configures for one project, split by integration. */
export type AppSettings = {
  jira?: JiraSettings
  gitlab?: GitLabSettings
  localRepo?: LocalRepoSettings
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

/** A project is a fully self-contained workspace: config + cached data. */
export type ProjectSummary = {
  id: string
  name: string
  /** Jira project key, for a friendlier label (optional). */
  projectKey?: string
  /** ISO timestamp of the last sync for this project, if any. */
  lastSyncedAt?: string | null
  /** Number of cached issues, if known. */
  issueCount?: number
}

/* ------------------------------------------------------------------ */
/* Status / issue view model                                           */
/* ------------------------------------------------------------------ */

/**
 * Coarse status bucket used to colour and cluster columns. Mirrors Jira's
 * `statusCategory.key` (`new` / `indeterminate` / `done`).
 */
export type StatusCategory = 'to do' | 'in progress' | 'done' | 'unknown'

/** A board column — a Jira status with its display metadata. */
export type BoardStatus = {
  id: string
  name: string
  category: StatusCategory
  /** Optional raw Jira status category colour name. */
  color?: string
}

/** The minimal, serialisable issue shape the board renders. */
export type BoardIssue = {
  id: string
  key: string
  summary: string
  description?: string | null
  status: BoardStatus
  issueType?: string
  priority?: string
  assignee?: string | null
  reporter?: string | null
  created?: string
  updated?: string
  url: string
}

/** A Jira workflow transition (status change) offered for an issue. */
export type JiraTransitionOption = {
  id: string
  name: string
  toStatus: BoardStatus
}

/** Full detail for a single issue, shown in the detail modal / tool result. */
export type BoardIssueDetail = BoardIssue & {
  labels?: string[]
  components?: string[]
  commentCount?: number
  transitions: JiraTransitionOption[]
  canDelete?: boolean
  comments?: IssueComment[]
  /**
   * Description rendered as Jira HTML (wiki markup + embedded images), with
   * image URLs rewritten to the host proxy so the browser (not authenticated
   * to Jira) can display them. `description` stays plain text for the model.
   */
  descriptionHtml?: string
  /** 附件清单（含 Jira 原始下载 URL），供模型文本输出与 UI 展示。 */
  attachments?: BoardAttachment[]
}

/** Jira issue 附件（图片/文件）的最小描述。 */
export type BoardAttachment = {
  id: string
  filename: string
  mimeType?: string
  size?: number
  /** Jira 下载 URL（`/secure/attachment/<id>/<filename>` 绝对地址）。 */
  url: string
}

/* ------------------------------------------------------------------ */
/* Sync / meta                                                         */
/* ------------------------------------------------------------------ */

export type SyncResult = {
  ok: boolean
  total: number
  added: number
  updated: number
  lastSyncedAt: string | null
  error?: string
}

/** One-off overrides for a sync. */
export type SyncOptions = {
  jql?: string
  assigneeSelf?: boolean
  reporterSelf?: boolean
}

export type SyncMeta = {
  configured: boolean
  lastSyncedAt: string | null
  projectKey?: string
  jql?: string
  jiraBaseUrl?: string
  issueCount: number
}

/* ------------------------------------------------------------------ */
/* GitLab workspace (issues / merge requests)                         */
/* ------------------------------------------------------------------ */

export type GitlabListState = 'opened' | 'closed' | 'merged' | 'all'

export type GitlabIssue = {
  id: number
  iid: number
  title: string
  state: string
  description?: string
  createdAt?: string
  updatedAt?: string
  author?: string
  jiraKeys: string[]
  mrIid?: number
  /** GitLab 页面链接（host 侧按 baseUrl + 项目路径拼好）。 */
  webUrl?: string
}

export type GitlabMr = {
  id: number
  iid: number
  title: string
  state: string
  sourceBranch?: string
  targetBranch?: string
  author?: string
  createdAt?: string
  jiraKeys: string[]
  issueIids?: number[]
  /** GitLab 页面链接（host 侧按 baseUrl + 项目路径拼好）。 */
  webUrl?: string
}

/* ------------------------------------------------------------------ */
/* Create issue                                                        */
/* ------------------------------------------------------------------ */

export type CreateIssueRequest = {
  summary: string
  /** Full Jira `fields` object (in Jira REST format). */
  fields: Record<string, unknown>
}

export type CreateIssueResponse = {
  ok: boolean
  issue: BoardIssue
}

export type IssueTypeOption = {
  id: string
  name: string
}

export type CreateMetaField = {
  id: string
  name: string
  type?: string
  required?: boolean
  allowedValues?: string[]
  hasDefaultValue?: boolean
}

export type CreateMeta = {
  projectKey: string
  issueTypes: IssueTypeOption[]
  fields: CreateMetaField[]
}

export type CreateUserOption = {
  name: string
  displayName: string
}

export type IssueComment = {
  id: string
  author?: string
  created?: string
  /** Plain-text body (model / text fallback). */
  body: string
  /** Body rendered as Jira HTML (images proxied) for the browser. */
  bodyHtml?: string
}
