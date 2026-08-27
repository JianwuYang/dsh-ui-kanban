import https from 'node:https'
import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type { GitLabSettings } from './types.ts'

/**
 * GitLab REST client built on axios.
 *
 * We use axios (not `@gitbeaker`) because it honours the proxy env
 * (`http_proxy`/`https_proxy`) and can be configured to trust a self-signed TLS
 * certificate for private instances — Node's global `fetch` can do neither out
 * of the box. (Direct port of the ui-kanban `apps/server/src/lib/gitlab.ts`.)
 */

/** Turn a `https://host/group/repo` project value into `group/repo`. */
export function projectPath(project: string): string {
  const p = project.trim()
  return p.replace(/^https?:\/\/[^/]+\/?/i, '')
}

function createClient(settings: GitLabSettings): AxiosInstance {
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  return axios.create({
    baseURL: `${baseUrl}/api/v4`,
    headers: { 'PRIVATE-TOKEN': settings.apiToken },
    timeout: 30_000,
    ...(settings.allowSelfSigned ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
  })
}

function errorMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string; error?: string } }
    message?: string
    cause?: Error
  }
  return (
    e?.response?.data?.message
    || e?.response?.data?.error
    || e?.message
    || e?.cause?.message
    || 'Connection failed'
  )
}

export interface ProjectIssue {
  id: number; iid: number; title: string; state: string; description?: string
  created_at?: string; updated_at?: string
  author?: { username?: string; name?: string }
}
export interface ProjectMr {
  id: number; iid: number; title: string; state: string
  source_branch?: string; target_branch?: string; created_at?: string
  author?: { username?: string; name?: string }
}

function projectBase(settings: GitLabSettings): string {
  const path = projectPath(settings.project)
  return `/projects/${encodeURIComponent(path)}`
}

/** Search branches across the whole project (server-side `?search=` + paging). */
export async function searchGitlabBranches(settings: GitLabSettings, query: string): Promise<string[]> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const names: string[] = []
  let page = 1
  const perPage = 50
  for (;;) {
    const res = await client.get(`${base}/repository/branches`, {
      params: { search: query.trim() || undefined, per_page: perPage, page },
    })
    const data = (res.data ?? []) as { name?: string }[]
    names.push(...data.map((b) => b.name).filter((n): n is string => Boolean(n)))
    if (data.length < perPage || names.length > 500) break
    page += 1
  }
  return names
}

export async function listGitlabIssues(
  settings: GitLabSettings, state = 'all', search = '', page = 1, perPage = 50,
): Promise<ProjectIssue[]> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.get(`${base}/issues`, {
    params: { state: state === 'all' ? undefined : state, search: search || undefined, page, per_page: perPage },
  })
  return res.data as ProjectIssue[]
}

export async function listGitlabMrs(
  settings: GitLabSettings, state = 'all', search = '', page = 1, perPage = 50,
): Promise<ProjectMr[]> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.get(`${base}/merge_requests`, {
    params: { state: state === 'all' ? undefined : state, search: search || undefined, page, per_page: perPage },
  })
  return res.data as ProjectMr[]
}

export async function createGitlabIssue(
  settings: GitLabSettings, title: string, description: string,
): Promise<ProjectIssue> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.post(`${base}/issues`, { title, description })
  return res.data as ProjectIssue
}

export async function updateGitlabIssue(
  settings: GitLabSettings, iid: number, fields: { title?: string; description?: string },
): Promise<ProjectIssue> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.put(`${base}/issues/${iid}`, fields)
  return res.data as ProjectIssue
}

export async function closeGitlabIssue(settings: GitLabSettings, iid: number): Promise<ProjectIssue> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.put(`${base}/issues/${iid}`, { state_event: 'close' })
  return res.data as ProjectIssue
}

export async function closeGitlabMr(settings: GitLabSettings, iid: number): Promise<ProjectMr> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.put(`${base}/merge_requests/${iid}`, { state_event: 'close' })
  return res.data as ProjectMr
}

export async function createGitlabBranch(
  settings: GitLabSettings, name: string, ref: string,
): Promise<{ name: string }> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.post(`${base}/repository/branches`, { branch: name, ref })
  return res.data as { name: string }
}

export async function createGitlabMr(
  settings: GitLabSettings,
  params: { source_branch: string; target_branch?: string; title?: string; description?: string },
): Promise<ProjectMr> {
  const client = createClient(settings)
  const base = projectBase(settings)
  const res = await client.post(`${base}/merge_requests`, {
    source_branch: params.source_branch,
    target_branch: params.target_branch,
    title: params.title,
    description: params.description,
    remove_source_branch: false,
  })
  return res.data as ProjectMr
}

/** Verify the GitLab connection and return the recent branch list. */
export async function testGitlabConnection(settings: GitLabSettings): Promise<{
  ok: boolean
  user: string | null
  error: string | null
  recentBranches: string[]
}> {
  try {
    const client = createClient(settings)
    const user = (await client.get('/user')).data
    const username = user?.username ?? user?.name ?? 'user'
    let recentBranches: string[] = []
    try {
      const base = projectBase(settings)
      const res = await client.get(`${base}/repository/branches`)
      recentBranches = (res.data ?? []).map((b: { name?: string }) => b.name).filter((n: unknown): n is string => typeof n === 'string').slice(0, 50)
    } catch {
      // branch listing is best-effort
    }
    return { ok: true, user: username, error: null, recentBranches }
  } catch (err) {
    return { ok: false, user: null, error: errorMessage(err), recentBranches: [] }
  }
}
