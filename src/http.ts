import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { KanbanBackend } from './service.ts'
import type { Config, KanbanProject } from './config.ts'
import * as gitlab from './backend/gitlab.ts'
import { toErrorMessage } from './backend/jira.ts'
import type { AppSettings, CreateIssueRequest, ProjectSummary } from './backend/types.ts'

/**
 * Host-side `/kanban-api` HTTP bridge: registers one `webServer` prefix route
 * that exposes the ported {@link KanbanBackend} (projects / settings / issues /
 * sync / gitlab) as a same-origin REST surface the embedded browser UI fetches.
 * No harness edit needed — `ctx.webServer.register()` is a plugin-visible
 * route registry, so the browser client can `fetch('/kanban-api/...')`.
 *
 * With the workspace model, "projects" are derived from DSH workspaces. A
 * request selects a project via `?workspace=<id|title|path>` (or `?project=`),
 * or `?cwd=<path>` for the session's workspace when the browser knows it;
 * absent, the first workspace is used.
 */

/** Minimal structural face of the web-server route registry (no harness type dep). */
interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
interface WebServerLike {
  register(route: WebRoute): () => void
}

/** Register the `/kanban-api` prefix route on the web server, when web is composed. */
export function registerKanbanApi(ctx: Context, backend: KanbanBackend, writeConfig: (patch: Partial<Config>) => Promise<void>): void {
  ctx.inject(['webServer'], (wctx) => {
    const ws = (wctx as unknown as { webServer: WebServerLike }).webServer
    ws.register({
      kind: 'prefix',
      path: '/kanban-api',
      handler: (req, res) => handle(backend, writeConfig, req, res),
    })
  })
}

async function handle(
  backend: KanbanBackend,
  writeConfig: (patch: Partial<Config>) => Promise<void>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const segments = url.pathname.replace(/^\/kanban-api\/?/, '').split('/').filter(Boolean)
    const query = url.searchParams
    const method = (req.method ?? 'GET').toUpperCase()
    const body = await readJson(req)

    if (segments.length === 0 || segments[0] === 'state') {
      if (method === 'GET') return sendJson(res, 200, await bootstrap(backend))
    }

    // NOTE: each branch is `return await` so a rejection stays inside this
    // try/catch and sendError() can return a JSON error body (a bare
    // `return routeX(...)` would leak the rejection to the webserver, which
    // answers a body-less 400).
    if (segments[0] === 'projects') return await projectsRoute(backend, writeConfig, segments, method, query, body, res)
    if (segments[0] === 'settings') return await settingsRoute(backend, writeConfig, segments, method, query, body, res)
    if (segments[0] === 'sync') return await syncRoute(backend, segments, method, query, body, res)
    if (segments[0] === 'issues') return await issuesRoute(backend, segments, method, query, body, res)
    if (segments[0] === 'gitlab') return await gitlabRoute(backend, segments, method, query, body, res)
    if (segments[0] === 'attachment-proxy') return await attachmentProxyRoute(backend, query, res)

    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    sendError(res, error)
  }
}

/* ----------------------------- helpers ----------------------------- */

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.method === 'GET' || req.method === 'DELETE') return {}
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload === undefined ? null : payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function sendError(res: ServerResponse, error: unknown): void {
  // toErrorMessage 会把 Jira 返回体里的 errorMessages/errors 提取成人话
  // （axios 的默认 message 只是 "Request failed with status code 400"，没有信息量）。
  const message = toErrorMessage(error)
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
  // axios 的通用错误码（ERR_BAD_REQUEST 等）同样没有信息量，不暴露给前端。
  const usefulCode = code === undefined || code.startsWith('ERR_') ? undefined : code
  sendJson(res, 400, { error: message, ...(usefulCode === undefined ? {} : { code: usefulCode }) })
}

/* --------------------------- attachment-proxy --------------------------- */

/**
 * Proxy a Jira attachment / thumbnail image through the host so the browser
 * (which is not authenticated to Jira) can render it. The URL is validated to
 * be on the configured Jira host for some project, then fetched with that
 * project's token and streamed back (bytes are never cached on disk).
 */
async function attachmentProxyRoute(
  backend: KanbanBackend,
  query: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const url = query.get('url') ?? ''
  if (!url) return sendError(res, new Error('url is required'))

  const project = backend.projectForJiraUrl(url)
  if (!project?.jira?.baseUrl) return sendError(res, new Error('no Jira connection for this image'))

  let target: URL
  try {
    target = new URL(url)
    if (target.origin !== new URL(project.jira.baseUrl).origin) {
      return sendError(res, new Error('invalid url'))
    }
  } catch {
    return sendError(res, new Error('invalid url'))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let resp: Response
  try {
    resp = await fetch(target.toString(), {
      headers: { Authorization: `Bearer ${project.jira.apiToken}` },
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timer)
    return sendError(res, new Error('failed to fetch attachment'))
  }
  clearTimeout(timer)

  if (!resp.ok) return sendJson(res, resp.status, { error: 'failed to fetch attachment' })

  const buf = Buffer.from(await resp.arrayBuffer())
  res.writeHead(200, {
    'Content-Type': resp.headers.get('content-type') ?? 'application/octet-stream',
    'Cache-Control': 'private, max-age=3600',
  })
  res.end(buf)
}

/**
 * Resolve the project a request targets. `?workspace=`/`?project=` pick an
 * explicit workspace (id/title/path); `?cwd=` names the session's workspace
 * path; absent, the first workspace is used. Throws "not configured" when no
 * project can be resolved.
 */
function requireRouteProject(backend: KanbanBackend, query: URLSearchParams): KanbanProject {
  const ref = query.get('workspace')?.trim() || query.get('project')?.trim()
  const cwd = query.get('cwd')?.trim()
  const project = ref
    ? backend.requireProject(ref)
    : cwd
      ? backend.requireProject(undefined, cwd)
      : backend.activeProject()
  if (!project) throw Object.assign(new Error('no kanban project configured'), { code: 'error.notConfigured' })
  return project
}

async function projectsPayload(backend: KanbanBackend, target?: { workspace?: string | null; cwd?: string | null }): Promise<{ projects: ProjectSummary[]; currentProjectId: string | null }> {
  const projects = await backend.listProjects()
  const firstId = projects[0]?.id ?? null
  let currentProjectId = firstId
  if (target?.cwd) currentProjectId = backend.resolveProject(undefined, target.cwd)?.id ?? firstId
  else if (target?.workspace) currentProjectId = backend.resolveProject(target.workspace)?.id ?? firstId
  return { projects, currentProjectId }
}

async function bootstrap(backend: KanbanBackend) {
  const projects = await backend.listProjects()
  const active = backend.activeProject()
  const settings = active ? { jira: active.jira, gitlab: active.gitlab, localRepo: active.localRepo } : null
  const meta = active ? await backend.syncMeta(active) : null
  const issues = active ? await backend.listIssues(active) : []
  return {
    projects,
    currentProjectId: projects[0]?.id ?? null,
    configured: Boolean(active?.jira?.projectKey && active?.jira?.baseUrl),
    settings,
    meta,
    issues,
    dataDir: backend.dataDir(),
  }
}

/* ----------------------------- projects ---------------------------- */

async function projectsRoute(
  backend: KanbanBackend,
  writeConfig: (patch: Partial<Config>) => Promise<void>,
  segments: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const id = segments[1]
  if (method === 'GET' && id === undefined) return sendJson(res, 200, await projectsPayload(backend, { workspace: query.get('workspace'), cwd: query.get('cwd') }))

  // POST /projects — set a workspace's override (projects are workspace-derived).
  if (method === 'POST' && id === undefined) {
    const wsRef = (typeof body.workspace === 'string' && body.workspace.trim()) || (typeof body.project === 'string' && body.project.trim())
    if (!wsRef) throw Object.assign(new Error('workspace is required (projects are workspace-derived)'), { code: 'error.workspaceRequired' })
    const derived = backend.requireProject(wsRef)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const config = backend.config()
    const overrides = config.projects.map((p) => ({ ...p }))
    let entry = overrides.find((p) => p.id === derived.id)
    if (!entry) {
      entry = { id: derived.id }
      overrides.push(entry)
    }
    if (name) entry.name = name
    // Optionally copy another override's connection field.
    const srcId = typeof body.fromProjectId === 'string' ? body.fromProjectId.trim() : ''
    if (srcId) {
      const src = config.projects.find((p) => p.id === srcId)
      if (src) {
        if (src.jira) entry.jira = { ...src.jira }
        if (src.gitlab) entry.gitlab = { ...src.gitlab }
        if (src.localRepo) entry.localRepo = { ...src.localRepo }
      }
    }
    await writeConfig({ projects: overrides })
    return sendJson(res, 200, await projectsPayload(backend))
  }

  // PUT /projects/<id> — rename a workspace's override.
  if (method === 'PUT' && id !== undefined && segments[2] === undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw Object.assign(new Error('Project name is required.'), { code: 'error.projectNameRequired' })
    const config = backend.config()
    await writeConfig({ projects: config.projects.map((p) => p.id === id ? { ...p, name } : p) })
    return sendJson(res, 200, await projectsPayload(backend))
  }

  // POST /projects/<id>/activate — projects follow the session workspace; keep for API compat.
  if (method === 'POST' && id !== undefined && segments[2] === 'activate') {
    return sendJson(res, 200, await projectsPayload(backend))
  }

  // DELETE /projects/<id> — drop a workspace's override (revert to global defaults).
  if (method === 'DELETE' && id !== undefined && segments[2] === undefined) {
    const config = backend.config()
    await writeConfig({ projects: config.projects.filter((p) => p.id !== id) })
    return sendJson(res, 200, await projectsPayload(backend))
  }
  sendJson(res, 404, { error: 'not found' })
}

/* ----------------------------- settings ---------------------------- */

async function settingsRoute(
  backend: KanbanBackend,
  writeConfig: (patch: Partial<Config>) => Promise<void>,
  segments: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const project = requireRouteProject(backend, query)
  if (segments[1] === 'test' && method === 'POST') {
    return sendJson(res, 200, await backend.testJira(project))
  }
  if (segments[1] === 'gitlab' && segments[2] === 'test' && method === 'POST') {
    const candidate = (body.gitlab ?? project.gitlab) as NonNullable<typeof project.gitlab>
    if (!candidate) throw new Error('GitLab is not configured')
    return sendJson(res, 200, await gitlab.testGitlabConnection(candidate))
  }
  if (segments[1] === 'gitlab' && segments[2] === 'branches' && method === 'POST') {
    const candidate = (body.gitlab ?? project.gitlab) as NonNullable<typeof project.gitlab>
    const q = typeof body.q === 'string' ? body.q : ''
    return sendJson(res, 200, { branches: candidate ? await gitlab.searchGitlabBranches(candidate, q) : [] })
  }
  if (segments[1] === 'createmeta' && method === 'GET') {
    const typeId = query.get('issueType') ?? undefined
    return sendJson(res, 200, await backend.createMeta(project, typeId))
  }
  if (segments[1] === 'assignees' && method === 'GET') {
    return sendJson(res, 200, await backend.assignees(project, query.get('q') ?? ''))
  }
  // PUT /settings/global — merge-only write of the GLOBAL jira/gitlab host+token.
  // The config card uses this: it can't read the redacted token, so a blank must
  // never replace the host-side secret, and this must not touch a workspace
  // override (projectKey/jql/gitlab.project).
  if (segments[1] === 'global' && segments[2] === undefined && method === 'PUT') {
    const config = backend.config()
    const next: Partial<Config> = {}
    if (body.jira) {
      const cur = config.jira ?? { baseUrl: '', apiToken: '' }
      const j = body.jira as { baseUrl?: string; apiToken?: string }
      next.jira = { baseUrl: j.baseUrl ?? cur.baseUrl, apiToken: j.apiToken || cur.apiToken }
    }
    if (body.gitlab) {
      const cur = config.gitlab ?? { baseUrl: '', apiToken: '' }
      const g = body.gitlab as { baseUrl?: string; apiToken?: string }
      next.gitlab = { baseUrl: g.baseUrl ?? cur.baseUrl, apiToken: g.apiToken || cur.apiToken }
    }
    if (!next.jira && !next.gitlab) throw new Error('nothing to update')
    await writeConfig(next)
    return sendJson(res, 200, { ok: true })
  }

  if (method === 'GET' && segments[1] === undefined) {
    return sendJson(res, 200, { configured: Boolean(project.jira?.projectKey && project.jira?.baseUrl), settings: { jira: project.jira, gitlab: project.gitlab, localRepo: project.localRepo } })
  }
  if (method === 'PUT' && segments[1] === undefined) {
    const patch = body as Partial<AppSettings>
    const config = backend.config()
    const next: Partial<Config> = {}
    // Global host/token (merged so a redacted/empty token from the browser never
    // clears the host-side secret); the workspace override gets the per-workspace
    // identity (projectKey / jql / gitlab.project / localRepo dir).
    if (patch.jira) {
      const cur = config.jira ?? { baseUrl: '', apiToken: '' }
      next.jira = { baseUrl: patch.jira.baseUrl ?? cur.baseUrl, apiToken: patch.jira.apiToken || cur.apiToken }
    }
    if (patch.gitlab) {
      const cur = config.gitlab ?? { baseUrl: '', apiToken: '' }
      next.gitlab = { baseUrl: patch.gitlab.baseUrl ?? cur.baseUrl, apiToken: patch.gitlab.apiToken || cur.apiToken }
    }
    const overrides = config.projects.map((p) => ({ ...p }))
    let entry = overrides.find((p) => p.id === project.id)
    if (!entry) { entry = { id: project.id }; overrides.push(entry) }
    if (patch.jira) entry.jira = { projectKey: patch.jira.projectKey ?? entry.jira?.projectKey ?? '', jql: patch.jira.jql ?? entry.jira?.jql ?? '' }
    if (patch.gitlab) entry.gitlab = { project: patch.gitlab.project ?? entry.gitlab?.project ?? '' }
    if (patch.localRepo) entry.localRepo = { directory: patch.localRepo.directory ?? '' }
    next.projects = overrides
    await writeConfig(next)
    return sendJson(res, 200, { ok: true })
  }
  sendJson(res, 404, { error: 'not found' })
}

/* ------------------------------ sync ------------------------------- */

async function syncRoute(
  backend: KanbanBackend,
  segments: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const active = requireRouteProject(backend, query)
  if (method === 'GET' && segments[1] === undefined) return sendJson(res, 200, await backend.syncMeta(active))
  if (method === 'POST' && segments[1] === 'preview') {
    return sendJson(res, 200, await backend.syncPreview(active, {
      jql: typeof body.jql === 'string' ? body.jql : undefined,
      assigneeSelf: typeof body.assigneeSelf === 'boolean' ? body.assigneeSelf : undefined,
      reporterSelf: typeof body.reporterSelf === 'boolean' ? body.reporterSelf : undefined,
    }))
  }
  if (method === 'POST' && segments[1] === undefined) {
    const result = await backend.sync(active, {
      jql: typeof body.jql === 'string' ? body.jql : undefined,
      assigneeSelf: typeof body.assigneeSelf === 'boolean' ? body.assigneeSelf : undefined,
      reporterSelf: typeof body.reporterSelf === 'boolean' ? body.reporterSelf : undefined,
    })
    return sendJson(res, 200, result)
  }
  sendJson(res, 404, { error: 'not found' })
}

/* ------------------------------ issues ------------------------------ */

async function issuesRoute(
  backend: KanbanBackend,
  segments: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const active = requireRouteProject(backend, query)
  const key = segments[1]
  if (method === 'GET' && key === undefined) return sendJson(res, 200, await backend.listIssues(active))
  if (method === 'POST' && key === undefined) {
    const input = body as Partial<CreateIssueRequest>
    if (!input.summary?.trim()) throw Object.assign(new Error('Summary is required.'), { code: 'error.summaryRequired' })
    const result = await backend.createIssue(active, { summary: input.summary, fields: input.fields ?? {} })
    return sendJson(res, 201, { ok: true, issue: result.issue })
  }
  if (key === undefined) { sendJson(res, 404, { error: 'not found' }); return }

  if (method === 'GET' && segments[2] === 'transitions') return sendJson(res, 200, await backend.transitions(active, key))
  if (method === 'GET' && segments[2] === undefined) return sendJson(res, 200, await backend.issueDetail(active, key))
  if (method === 'POST' && segments[2] === 'transition') {
    const transitionId = typeof body.transitionId === 'string' ? body.transitionId : ''
    if (!transitionId) throw Object.assign(new Error('transitionId is required.'), { code: 'error.transitionIdRequired' })
    const issue = await backend.move(active, key, transitionId, typeof body.comment === 'string' ? body.comment : undefined)
    return sendJson(res, 200, { ok: true, issue })
  }
  if (method === 'POST' && segments[2] === 'assign') {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw Object.assign(new Error('name is required.'), { code: 'error.assigneeRequired' })
    const detail = await backend.assign(active, key, name, typeof body.comment === 'string' ? body.comment : undefined)
    return sendJson(res, 200, detail)
  }
  if (method === 'POST' && segments[2] === 'comments') {
    const bodyText = typeof body.body === 'string' ? body.body.trim() : ''
    if (!bodyText) throw Object.assign(new Error('Comment body is required.'), { code: 'error.commentRequired' })
    await backend.addComment(active, key, bodyText)
    return sendJson(res, 200, { ok: true })
  }
  if (method === 'POST' && segments[2] === 'attachments') {
    const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
    const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
    if (!filename || !dataBase64) throw Object.assign(new Error('filename and dataBase64 are required.'), { code: 'error.attachmentRequired' })
    const uploaded = await backend.addAttachment(active, key, filename, dataBase64)
    return sendJson(res, 201, { ok: true, filename: uploaded })
  }
  if (method === 'DELETE' && segments[2] === undefined) return sendJson(res, 200, await backend.deleteIssue(active, key))

  sendJson(res, 404, { error: 'not found' })
}

/* ------------------------------ gitlab ------------------------------ */

async function gitlabRoute(
  backend: KanbanBackend,
  segments: string[],
  method: string,
  query: URLSearchParams,
  body: Record<string, unknown>,
  res: ServerResponse,
): Promise<void> {
  const active = requireRouteProject(backend, query)
  const kind = segments[1]
  const id = segments[2]
  const sub = segments[3]

  if (kind === 'issues' && method === 'GET' && id === undefined) {
    return sendJson(res, 200, await backend.gitlabIssues(active, (query.get('state') as 'all' | 'opened' | 'closed' | 'merged' | null) ?? 'all', query.get('search') ?? ''))
  }
  if (kind === 'merge_requests' && method === 'GET' && id === undefined) {
    return sendJson(res, 200, await backend.gitlabMrs(active, (query.get('state') as 'all' | 'opened' | 'closed' | 'merged' | null) ?? 'all', query.get('search') ?? ''))
  }
  if (kind === 'issues' && method === 'POST' && id === undefined) {
    const issue = await backend.gitlabCreateIssueFromJira(active, (body.jiras ?? []) as { key: string; summary: string }[], typeof body.title === 'string' ? body.title : undefined, typeof body.description === 'string' ? body.description : undefined)
    return sendJson(res, 201, { ok: true, issue })
  }
  if (kind === 'merge_requests' && method === 'POST' && id === undefined) {
    const mr = await backend.gitlabCreateMr(active, {
      sourceBranch: typeof body.sourceBranch === 'string' ? body.sourceBranch : '',
      targetBranch: typeof body.targetBranch === 'string' ? body.targetBranch : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
      issueIids: Array.isArray(body.issueIids) ? body.issueIids as number[] : [],
      createBranch: body.createBranch === true,
    })
    return sendJson(res, 201, { ok: true, merge_request: mr })
  }
  if (kind === 'issues' && id !== undefined && sub === 'link-jira' && method === 'POST') {
    return sendJson(res, 200, await backend.gitlabLinkJira(active, Number(id), Array.isArray(body.jiraKeys) ? body.jiraKeys as string[] : []))
  }
  if (kind === 'issues' && id !== undefined && sub === 'unlink-jira' && method === 'POST') {
    const keys = Array.isArray(body.keys) ? body.keys as string[] : []
    return sendJson(res, 200, await backend.gitlabUnlinkJira(active, Number(id), keys))
  }
  if (kind === 'issues' && id !== undefined && sub === 'mr' && method === 'POST') {
    const mrIid = Number(body.mrIid)
    if (!mrIid) throw Object.assign(new Error('mrIid is required.'), { code: 'error.mrRequired' })
    return sendJson(res, 200, await backend.gitlabLinkIssueToMr(active, Number(id), mrIid))
  }
  if (kind === 'issues' && id !== undefined && sub === 'close' && method === 'POST') {
    return sendJson(res, 200, await backend.gitlabCloseIssue(active, Number(id)))
  }
  if (kind === 'merge_requests' && id !== undefined && sub === 'close' && method === 'POST') {
    return sendJson(res, 200, await backend.gitlabCloseMr(active, Number(id)))
  }
  sendJson(res, 404, { error: 'not found' })
}
