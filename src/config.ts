import Schema from '@deepseek-ai/schemastery'

/**
 * Plugin configuration for the `dsh-kanban` settings namespace, reshaped for
 * the workspace model:
 *
 * - Global (editable in dsh settings): the **shared Jira / GitLab hosts and
 *   tokens** plus the few transport-level knobs (`dataDir`, `allowSelfSigned`,
 *   `verbose`). These are the defaults every workspace inherits.
 * - Per-workspace: the kanban board auto-derives one project per DSH
 *   **workspace**; `config.projects` only carries the per-workspace **overrides**
 *   (Jira project key + JQL, GitLab project path, local-repo dir, display
 *   name). A workspace with no override inherits the global host/token and uses
 *   its own directory as the local repo.
 *
 * Every Jira/GitLab token is `role('secret')` so the web settings surface never
 * ships it back to the browser.
 */

/** Global Jira connection: host + token inherited by every workspace. */
export interface JiraGlobal {
  baseUrl: string
  apiToken: string
}

/** Global GitLab connection: host + token inherited by every workspace. */
export interface GitlabGlobal {
  baseUrl: string
  apiToken: string
}

/** Per-workspace Jira override (host/token come from the global settings). */
export interface JiraOverride {
  projectKey?: string
  jql?: string
}

/** Per-workspace GitLab override (host/token come from the global settings). */
export interface GitlabOverride {
  project?: string
  /** Auto-derive MR ↔ issue links from cross-references in MR descriptions. */
  mrAutoLink?: boolean
  /** Comma-separated closing keywords; empty => GitLab's official word list. */
  mrLinkKeywords?: string
  /** A plain `#123` mention counts as a (non-closing) link. */
  mrLinkMentions?: boolean
}

/** Per-workspace local-repo override; empty => the workspace's own directory. */
export interface LocalRepoOverride {
  directory?: string
}

/** One workspace's override entry in `config.projects`. */
export interface KanbanProjectOverride {
  /** Workspace id (the stable uuid the workspace registry assigns). */
  id: string
  /** Display name override; empty => the workspace title. */
  name?: string
  jira?: JiraOverride
  gitlab?: GitlabOverride
  localRepo?: LocalRepoOverride
}

/** Plugin config: global defaults + per-workspace overrides. */
export interface Config {
  /** Local data-cache directory; empty => default `~/.dsh/kanban` (env `KANBAN_DATA_DIR` overrides). */
  dataDir?: string
  /** Common default for GitLab self-signed TLS. */
  allowSelfSigned?: boolean
  verbose?: boolean
  /** Global Jira host + token (inherited by every workspace). */
  jira?: JiraGlobal
  /** Global GitLab host + token (inherited by every workspace). */
  gitlab?: GitlabGlobal
  /** Per-workspace overrides; a workspace with no entry inherits the globals. */
  projects: KanbanProjectOverride[]
}

/**
 * A fully-resolved project (the unit the backend operates on), derived from a
 * workspace by merging the global defaults with that workspace's override.
 */
export interface KanbanProject {
  id: string
  name: string
  jira?: {
    baseUrl: string
    apiToken: string
    projectKey: string
    jql: string
  }
  gitlab?: {
    baseUrl: string
    apiToken: string
    project: string
    allowSelfSigned?: boolean
    branches?: { name: string; marker?: string }[]
    mrAutoLink: boolean
    mrLinkKeywords: string
    mrLinkMentions: boolean
  }
  localRepo?: { directory: string }
}

const JiraGlobalSchema = Schema.object({
  baseUrl: Schema.string().default(''),
  apiToken: Schema.string().role('secret').default(''),
})

const GitlabGlobalSchema = Schema.object({
  baseUrl: Schema.string().default(''),
  apiToken: Schema.string().role('secret').default(''),
})

const JiraOverrideSchema = Schema.object({
  projectKey: Schema.string().default(''),
  jql: Schema.string().default(''),
})

const GitlabOverrideSchema = Schema.object({
  project: Schema.string().default(''),
  mrAutoLink: Schema.boolean().default(true),
  mrLinkKeywords: Schema.string().default(''),
  mrLinkMentions: Schema.boolean().default(true),
})

const LocalRepoOverrideSchema = Schema.object({
  directory: Schema.string().default(''),
})

const ProjectOverrideSchema = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().default(''),
  jira: JiraOverrideSchema,
  gitlab: GitlabOverrideSchema,
  localRepo: LocalRepoOverrideSchema,
})

/** Schemastery schema: validation + defaults apply at load time. */
export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default(''),
  allowSelfSigned: Schema.boolean().default(true),
  verbose: Schema.boolean().default(false),
  jira: JiraGlobalSchema,
  gitlab: GitlabGlobalSchema,
  projects: Schema.array(ProjectOverrideSchema).default([]),
})
