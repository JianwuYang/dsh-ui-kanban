import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { KanbanBackend } from './service.ts'
import type { Config } from './config.ts'
import type { BoardIssue, BoardStatus, GitlabListState, StatusCategory } from './backend/types.ts'

const text = (s: string) => [{ type: 'text' as const, text: s }]

/** Read the session's workspace path from the tool run context (loose, runtime-only). */
const cwdOf = (exec: unknown): string | undefined =>
  (exec as { agent?: { session?: { cwd?: string } } } | undefined)?.agent?.session?.cwd

const CATEGORY_ORDER: readonly StatusCategory[] = ['to do', 'in progress', 'done', 'unknown']

/** Group issues into board columns ordered by status category, then name. */
function buildColumns(issues: BoardIssue[]): { name: string; category: StatusCategory; color?: string; issues: BoardIssue[] }[] {
  const byStatus = new Map<string, { status: BoardStatus; issues: BoardIssue[] }>()
  for (const issue of issues) {
    const key = issue.status.id || issue.status.name
    const entry = byStatus.get(key) ?? { status: issue.status, issues: [] }
    entry.issues.push(issue)
    byStatus.set(key, entry)
  }
  return [...byStatus.values()]
    .sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.status.category)
      const cb = CATEGORY_ORDER.indexOf(b.status.category)
      return ca !== cb ? ca - cb : a.status.name.localeCompare(b.status.name)
    })
    .map((e) => ({ name: e.status.name, category: e.status.category, color: e.status.color, issues: e.issues }))
}

/** Minimal schema for a Jira board result (the model sees the shape). */
const boardSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    project: { type: 'string' },
    projectKey: { type: 'string' },
    total: { type: 'integer' },
    columns: { type: 'array' },
  },
} as const

/** Minimal schema for a sync result (no `columns`, but the delta counts). */
const syncSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    project: { type: 'string' },
    projectKey: { type: 'string' },
    total: { type: 'integer' },
    added: { type: 'integer' },
    updated: { type: 'integer' },
  },
} as const

/** Render a board succinctly for the model. */
function renderBoard(value: Record<string, unknown>): string {
  const columns = Array.isArray(value.columns) ? value.columns as { name?: string; category?: string; issues?: unknown[] }[] : []
  if (columns.length === 0) return `No issues yet — run kanban-sync first for project "${String(value.project)}".`
  const lines = columns.map((c) => `- ${c.name} (${c.category ?? ''}): ${Array.isArray(c.issues) ? c.issues.length : 0}`)
  lines.push(`Total: ${String(value.total)}`)
  lines.push('Run kanban-move <key> <transitionId> to change status, or kanban-issue <key> for detail.')
  return lines.join('\n')
}

const projectParams = { project: { type: 'string', description: 'Workspace id, title, or path; empty = the current session\'s workspace' } } as const

export function registerKanbanTools(
  ctx: Context,
  backend: KanbanBackend,
  writeConfig: (patch: Partial<Config>) => Promise<void>,
): void {
  /* ---------------- projects ---------------- */

  ctx.tools.register(defineTool({
    name: 'kanban-projects',
    description: 'List the kanban projects (one per workspace), their Jira keys and sync state.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_a, value) => text(renderProjects(value)), presentationMeta: (_a, value) => ({ kind: 'kanban-projects', projects: value }) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Kanban projects', content: r.content }),
    async execute(_args, exec) {
      const projects = await backend.listProjects()
      const current = cwdOf(exec) ? backend.workspaceForPath(cwdOf(exec))?.id : undefined
      return { projects, currentWorkspaceId: current ?? null }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-set-active-project',
    description: 'Confirm the current kanban project (it follows the current session\'s workspace).',
    parameters: { ...projectParams },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Active project', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      return { ok: true, project: { id: project.id, name: project.name } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-configure',
    description: 'Set the global Jira/GitLab host+token (no project) or a workspace\'s per-project override (projectKey / jql / gitlab project path / local repo dir).',
    parameters: {
      project: { type: 'string', description: 'Workspace id, title, or path — omit to update the GLOBAL jira/gitlab host+token' },
      jira: { type: 'json', description: '{ baseUrl, apiToken } global when project omitted, else { projectKey, jql } override' },
      gitlab: { type: 'json', description: '{ baseUrl, apiToken } global when project omitted, else { project } override' },
      localRepo: { type: 'json', description: '{ directory } override (default = the workspace dir)' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Configured', content: r.content }),
    async execute(args) {
      const config = backend.config()
      const target = (args.project ?? '').trim()
      if (!target) {
        // Global host+token.
        const patch: Partial<Config> = {
          ...(typeof args.jira === 'object' && args.jira !== null ? { jira: args.jira as unknown as Config['jira'] } : {}),
          ...(typeof args.gitlab === 'object' && args.gitlab !== null ? { gitlab: args.gitlab as unknown as Config['gitlab'] } : {}),
        }
        if (Object.keys(patch).length === 0) throw new Error('provide jira/gitlab host+token to set the global connection')
        await writeConfig(patch)
        return { ok: true, scope: 'global', message: 'global connection updated', projectId: '', name: '' }
      }
      const project = backend.resolveProject(target)
      if (!project) throw new Error(`workspace "${target}" not found`)
      const overrides = config.projects.map((p) => ({ ...p }))
      let entry = overrides.find((p) => p.id === project.id)
      if (!entry) {
        entry = { id: project.id }
        overrides.push(entry)
      }
      const j = args.jira as { projectKey?: string; jql?: string } | undefined
      const g = args.gitlab as { project?: string } | undefined
      const l = args.localRepo as { directory?: string } | undefined
      if (j !== undefined) entry.jira = { projectKey: j.projectKey ?? '', jql: j.jql ?? '' }
      if (g !== undefined) entry.gitlab = { project: g.project ?? '' }
      if (l !== undefined) entry.localRepo = { directory: l.directory ?? '' }
      await writeConfig({ projects: overrides })
      return { ok: true, scope: 'workspace', message: 'workspace override updated', projectId: project.id, name: project.name }
    },
  }))

  /* ---------------- sync / board ---------------- */

  ctx.tools.register(defineTool({
    name: 'kanban-sync',
    description: 'Sync the project\'s issues from Jira (replace the local cache). Returns added/updated counts.',
    parameters: {
      ...projectParams,
      jql: { type: 'string', description: 'Overrides the saved JQL filter (project= is auto-prepended)' },
      assigneeSelf: { type: 'boolean', description: 'Only issues where assignee = currentUser()' },
      reporterSelf: { type: 'boolean', description: 'Only issues where reporter = currentUser()' },
    },
    output: { schema: syncSchema, render: (_a, v) => text(renderSync(String(v.updated), String(v.added), String(v.total))), presentationMeta: (_a, v) => ({ kind: 'kanban-sync', result: v }) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Sync complete', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const result = await backend.sync(project, {
        jql: args.jql,
        assigneeSelf: args.assigneeSelf,
        reporterSelf: args.reporterSelf,
      })
      return { project: project.name, projectKey: project.jira?.projectKey ?? '', total: result.total, added: result.added, updated: result.updated, lastSyncedAt: result.lastSyncedAt }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-issues',
    description: 'Read the current board: cached issues for a project, grouped by status column.',
    parameters: { ...projectParams },
    output: { schema: boardSchema, render: (_a, v) => text(renderBoard(v as Record<string, unknown>)), presentationMeta: (_a, value) => ({ kind: 'kanban-board', board: value }) },
    presentCall: () => ({ card: 'generic', title: 'Kanban board', content: text('reading board…') }),
    presentResult: (_a, r) => ({ card: 'generic', title: 'Kanban board', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const issues = await backend.listIssues(project)
      const meta = await backend.syncMeta(project)
      return {
        project: project.name,
        projectKey: project.jira?.projectKey ?? '',
        total: issues.length,
        columns: buildColumns(issues),
        meta: { lastSyncedAt: meta.lastSyncedAt, issueCount: meta.issueCount },
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-issue',
    description: 'Fetch live detail for one issue: description, transitions, comments, canDelete.',
    parameters: {
      key: { type: 'string', required: true, description: 'Jira issue key, e.g. PROJ-123' },
      ...projectParams,
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(renderDetail(v as Record<string, unknown>)), presentationMeta: (_a, value) => ({ kind: 'kanban-detail', detail: value }) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Issue detail', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const detail = await backend.issueDetail(project, args.key)
      return { ...detail, transitions: detail.transitions.map((t) => ({ id: t.id, name: t.name, to: t.toStatus.name })) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-move',
    description: 'Move an issue to another status via a Jira workflow transition.',
    parameters: {
      key: { type: 'string', required: true, description: 'Jira issue key' },
      transitionId: { type: 'string', required: true, description: 'Transition id (from kanban-issue transitions)' },
      comment: { type: 'string', description: 'Optional comment added while transitioning' },
      ...projectParams,
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(renderDetail(v as Record<string, unknown>)), presentationMeta: (_a, value) => ({ kind: 'kanban-detail', detail: value }) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Issue moved', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const issue = await backend.move(project, args.key, args.transitionId, args.comment)
      return { ...issue }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-create',
    description: 'Create a Jira issue for a project and insert it into the board cache.',
    parameters: {
      summary: { type: 'string', required: true, description: 'Issue summary/title' },
      issueType: { type: 'string', description: 'Issue type name (e.g. Bug, Story); uses createmeta defaults when omitted' },
      description: { type: 'string', description: 'Issue description (plain text)' },
      assignee: { type: 'string', description: 'Assignee (Jira username or display name)' },
      ...projectParams,
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Issue created', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const fields: Record<string, unknown> = { project: { key: project.jira?.projectKey ?? '' } }
      if (args.issueType) fields.issuetype = { name: args.issueType }
      if (args.description) fields.description = args.description
      if (args.assignee) fields.assignee = { name: args.assignee }
      const result = await backend.createIssue(project, { summary: args.summary, fields })
      return { ok: true, issue: result.issue }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-comment',
    description: 'Add a comment to a Jira issue.',
    parameters: {
      key: { type: 'string', required: true, description: 'Jira issue key' },
      body: { type: 'string', required: true },
      ...projectParams,
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Comment added', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      await backend.addComment(project, args.key, args.body)
      return { ok: true, key: args.key }
    },
  }))

  /* ---------------- gitlab ---------------- */

  ctx.tools.register(defineTool({
    name: 'kanban-gitlab-issues',
    description: 'List GitLab issues for a project (with linked Jira keys and MR).',
    parameters: {
      ...projectParams,
      state: { type: 'string', enum: ['all', 'opened', 'closed'], description: 'Filter by state' },
      search: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'GitLab issues', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      return { project: project.name, issues: await backend.gitlabIssues(project, gitlabState(args.state), args.search ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-gitlab-mrs',
    description: 'List GitLab merge requests for a project (with associated issues and Jira keys).',
    parameters: {
      ...projectParams,
      state: { type: 'string', enum: ['all', 'opened', 'closed', 'merged'], description: 'Filter by state' },
      search: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'GitLab merge requests', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      return { project: project.name, merge_requests: await backend.gitlabMrs(project, gitlabState(args.state), args.search ?? '') }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-gitlab-create-issue',
    description: 'Create one GitLab issue from one or more Jira issues and record the links.',
    parameters: {
      ...projectParams,
      jiras: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, summary: { type: 'string' } } }, description: 'Jira issues to merge into one GitLab issue' },
      title: { type: 'string' },
      description: { type: 'string' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'GitLab issue created', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const issue = await backend.gitlabCreateIssueFromJira(project, (args.jiras ?? []).map((j) => ({ key: j.key ?? '', summary: j.summary ?? '' })), args.title, args.description)
      return { ok: true, issue }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-gitlab-create-mr',
    description: 'Create a GitLab merge request (optionally from a new branch) and link issues.',
    parameters: {
      ...projectParams,
      sourceBranch: { type: 'string', required: true, description: 'Source branch name' },
      targetBranch: { type: 'string', description: 'Target branch (default main)' },
      title: { type: 'string' },
      issueIids: { type: 'array', items: { type: 'integer' }, description: 'GitLab issue iids to associate' },
      createBranch: { type: 'boolean', description: 'Create the source branch first (default false)' },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Merge request created', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      const mr = await backend.gitlabCreateMr(project, {
        sourceBranch: args.sourceBranch,
        ...(args.targetBranch ? { targetBranch: args.targetBranch } : {}),
        ...(args.title ? { title: args.title } : {}),
        issueIids: args.issueIids ?? [],
        ...(args.createBranch ? { createBranch: args.createBranch } : {}),
      })
      return { ok: true, merge_request: mr }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'kanban-gitlab-link-jira',
    description: 'Link one or more Jira keys to an existing GitLab issue.',
    parameters: {
      ...projectParams,
      iid: { type: 'integer', required: true },
      jiraKeys: { type: 'array', items: { type: 'string' } },
    },
    output: { schema: { type: 'json' }, render: (_a, v) => text(String(v)) },
    presentResult: (_a, r) => ({ card: 'generic', title: 'Linked Jira', content: r.content }),
    async execute(args, exec) {
      const project = backend.requireProject(args.project, cwdOf(exec))
      return { ok: true, issue: await backend.gitlabLinkJira(project, args.iid, args.jiraKeys ?? []) }
    },
  }))
}

function renderProjects(value: unknown): string {
  const v = value as { projects?: { name?: string; projectKey?: string; issueCount?: number }[]; currentWorkspaceId?: string | null }
  const projects = v.projects ?? []
  if (projects.length === 0) return 'No kanban projects — configure Jira/GitLab host+token in settings, then sync a workspace.'
  return projects.map((p) => `- ${p.name}${p.projectKey ? ` (${p.projectKey})` : ''}: ${p.issueCount ?? 0} issues`).join('\n')
}

function renderSync(updated: string, added: string, total: string): string {
  return `Sync complete: ${total} issues (${added} new, ${updated} updated) in the cache.`
}

function renderDetail(v: Record<string, unknown>): string {
  const key = v.key ?? '(unknown)'
  const summary = v.summary ?? ''
  const status = typeof v.status === 'object' && v.status !== null ? (v.status as { name?: string }).name ?? '' : ''
  const issueType = v.issueType ?? ''
  const assignee = v.assignee ?? ''
  const lines = [`${key}: ${summary}`, `Status: ${status}${issueType ? ` · ${issueType}` : ''}${assignee ? ` · ${assignee}` : ''}`]
  if (v.description) lines.push(String(v.description))
  // 描述里的 `!image-xxx.png!` 是 Jira wiki 占位符——这里补上附件的真实下载
  // URL，模型至少能拿到可引用的地址（能否"看图"取决于模型是否支持图像输入）。
  if (Array.isArray(v.attachments) && (v.attachments as unknown[]).length) {
    lines.push(`Attachments (${(v.attachments as unknown[]).length}):`)
    for (const a of v.attachments as { filename?: string; mimeType?: string; size?: number; url?: string }[]) {
      const meta = [a.mimeType, a.size !== undefined ? `${a.size} bytes` : undefined].filter(Boolean).join(', ')
      lines.push(`- ${a.filename ?? ''}${meta ? ` (${meta})` : ''}: ${a.url ?? ''}`)
    }
  }
  if (Array.isArray(v.transitions) && v.transitions.length) {
    lines.push('Transitions: ' + (v.transitions as { id: string; name: string }[]).map((t) => `${t.id}=${t.name}`).join(', '))
  }
  if (Array.isArray(v.comments) && v.comments.length) {
    lines.push(`Comments (${(v.comments as unknown[]).length}):`)
    for (const c of v.comments as { author?: string; created?: string; body?: string }[]) {
      lines.push(`- ${c.author ?? ''}: ${(c.body ?? '').slice(0, 200)}`)
    }
  }
  return lines.join('\n')
}

function gitlabState(state?: string): GitlabListState {
  const s = state as GitlabListState | undefined
  return s === 'all' || s === 'opened' || s === 'closed' || s === 'merged' ? s : 'all'
}
