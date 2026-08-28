import fs from 'node:fs'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JiraClient } from 'jira-data-center-client'
import type { JiraIssue, JiraStatus, JiraTransition } from 'jira-data-center-client'
import type {
  BoardIssue,
  BoardStatus,
  BoardAttachment,
  CreateIssueRequest,
  CreateMeta,
  CreateMetaField,
  CreateUserOption,
  IssueComment,
  JiraSettings,
  StatusCategory,
} from './types.ts'

/**
 * Thin facade over `jira-data-center-client` so the plugin tools never touch
 * the vendor library directly, and normalization lives in one place.
 * (Direct port of the ui-kanban `apps/server/src/lib/jira.ts`.)
 */

export function createJiraClient(settings: JiraSettings): JiraClient {
  return new JiraClient({
    baseUrl: settings.baseUrl.replace(/\/+$/, ''),
    token: settings.apiToken,
    axiosConfig: { timeout: 30_000 },
  })
}

/** Turn a Jira/axios error into a useful, human-readable message. */
export function toErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; response?: { data?: unknown } }
    const data = e.response?.data as
      | { errorMessages?: string[]; errors?: Record<string, unknown> }
      | undefined
    if (data) {
      const parts: string[] = []
      if (Array.isArray(data.errorMessages) && data.errorMessages.length) {
        parts.push(...data.errorMessages.map(String))
      }
      if (data.errors && typeof data.errors === 'object') {
        for (const [field, msg] of Object.entries(data.errors)) {
          parts.push(`${field}: ${String(msg)}`)
        }
      }
      if (parts.length) return parts.join('; ')
    }
    if (e.message) return e.message
  }
  return 'Unknown error'
}

/** Verify the given connection; returns the authenticated user on success. */
export async function testConnection(settings: JiraSettings): Promise<unknown> {
  const client = createJiraClient(settings)
  return client.testConnection()
}

/* ------------------------- normalization --------------------------- */

function mapCategory(status: JiraStatus): StatusCategory {
  const key = status.statusCategory?.key?.toLowerCase()
  switch (key) {
    case 'new':
    case 'todo':
    case 'to do':
      return 'to do'
    case 'indeterminate':
    case 'in progress':
      return 'in progress'
    case 'done':
      return 'done'
    default:
      return 'unknown'
  }
}

export function toBoardStatus(status: JiraStatus): BoardStatus {
  return {
    id: status.id,
    name: status.name,
    category: mapCategory(status),
    color: status.statusCategory?.colorName,
  }
}

/** Stringify a string-or-ADF description into plain text where possible. */
function normalizeDescription(description: string | object | null | undefined): string | null {
  if (!description) return null
  if (typeof description === 'string') return description
  try {
    return collectAdfText(description as { content?: unknown[] }) || null
  } catch {
    return null
  }
}

function collectAdfText(node: unknown): string {
  if (Array.isArray(node)) return node.map(collectAdfText).filter(Boolean).join(' ')
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>
    const parts: string[] = []
    if (typeof obj.text === 'string') parts.push(obj.text)
    if (Array.isArray(obj.content)) parts.push(collectAdfText(obj.content))
    return parts.filter(Boolean).join(' ')
  }
  return ''
}

/**
 * Rewrite Jira attachment/thumbnail image URLs in rendered HTML to point at the
 * host proxy, so the browser (which is not authenticated to Jira) can load them.
 * Only `/secure/attachment/**` and `/secure/thumbnail/**` URLs are rewritten;
 * issue browse links are left untouched.
 */
export function proxyJiraImageUrls(html: string): string {
  return html.replace(
    /(https?:\/\/[^"'<>\s]+)/g,
    (match) =>
      /\/secure\/(?:attachment|thumbnail)\//.test(match)
        ? `/kanban-api/attachment-proxy?url=${encodeURIComponent(match)}`
        : match,
  )
}

export function normalizeIssue(issue: JiraIssue, baseUrl: string): BoardIssue {
  const f = issue.fields
  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary ?? issue.key,
    description: normalizeDescription(f.description),
    status: f.status ? toBoardStatus(f.status) : { id: 'unknown', name: 'Unknown', category: 'unknown' },
    issueType: f.issuetype?.name,
    priority: f.priority?.name,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    created: f.created,
    updated: f.updated,
    url: `${baseUrl.replace(/\/+$/, '')}/browse/${issue.key}`,
  }
}

/* ---------------------------- fetching ----------------------------- */

const BOARD_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'created',
  'updated',
  'description',
].join(',')

/** Fetch all issues matching the given JQL (auto-paginates). */
export async function fetchIssues(settings: JiraSettings, jql: string): Promise<BoardIssue[]> {
  const client = createJiraClient(settings)
  const issues = await client.issues.searchAll({ jql, fields: BOARD_FIELDS }, 5000)
  return issues.map((issue) => normalizeIssue(issue, settings.baseUrl))
}

/** Preview a sync: search a page of matches (read-only, no cache write). */
export async function searchIssuesPreview(
  settings: JiraSettings,
  jql: string,
  maxResults = 50,
): Promise<{ total: number; issues: { key: string; summary: string }[] }> {
  const client = createJiraClient(settings)
  const res = await client.issues.search({ jql, fields: 'summary', maxResults })
  return {
    total: res.total,
    issues: res.issues.map((issue) => ({ key: issue.key, summary: issue.fields.summary ?? issue.key })),
  }
}

/** Fetch a single issue with board-level detail (plain-text description). */
export async function fetchIssueDetail(
  settings: JiraSettings,
  key: string,
): Promise<{ issue: JiraIssue; detail: BoardIssue & { descriptionHtml?: string; attachments?: BoardAttachment[] } }> {
  const client = createJiraClient(settings)
  const issue = await client.issues.get({ issueKeyOrId: key, expand: 'changelog,renderedFields' })
  const detail: BoardIssue & { descriptionHtml?: string; attachments?: BoardAttachment[] } = normalizeIssue(issue, settings.baseUrl)
  // Prefer Jira's rendered HTML (handles wiki markup + embedded images); the
  // images are rewritten to the host proxy so the browser (not authenticated
  // to Jira) can display them. `description` stays plain text for the model.
  const rendered = issue.renderedFields?.description
  if (typeof rendered === 'string' && rendered.trim()) {
    detail.descriptionHtml = proxyJiraImageUrls(rendered)
  }
  // 附件清单：文本描述里的 `!image-xxx.png!` 是 wiki 占位符，这里补上真实的
  // Jira 下载 URL，让模型至少拿到可引用的地址（模型能否"看图"取决于模型能力）。
  const base = settings.baseUrl.replace(/\/+$/, '')
  detail.attachments = (issue.fields.attachment ?? []).map((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    url: a.content && typeof a.content === 'string'
      ? a.content
      : `${base}/secure/attachment/${a.id}/${encodeURIComponent(a.filename)}`,
  }))
  return { issue, detail }
}

/** Fetch the transitions available for an issue. */
export async function fetchTransitions(
  settings: JiraSettings,
  key: string,
): Promise<JiraTransition[]> {
  const client = createJiraClient(settings)
  const res = await client.issues.getTransitions({ issueKeyOrId: key })
  return res.transitions
}

/** Move an issue through a workflow transition. */
export async function transitionIssue(
  settings: JiraSettings,
  key: string,
  transitionId: string,
  comment?: string,
): Promise<void> {
  const client = createJiraClient(settings)
  await client.issues.transition({ issueKeyOrId: key, transitionId, comment })
}

/* ------------------------- create-form meta ------------------------ */

interface CreatemetaFieldValue {
  fieldId: string
  name: string
  required: boolean
  hasDefaultValue?: boolean
  schema?: { type?: string }
  allowedValues?: { value?: string; name?: string }[]
}

interface CreatemetaPathResponse {
  values?: CreatemetaFieldValue[]
}

async function parseJiraJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let message = `Jira ${label} failed (${res.status})`
    try {
      const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> }
      const parts = [
        ...(body.errorMessages ?? []),
        ...Object.entries(body.errors ?? {}).map(([f, m]) => `${f}: ${m}`),
      ]
      if (parts.length) message = parts.join('; ')
    } catch {
      // malformed error body
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch the create-field list for a project + issue type via the path-based
 * endpoint (the typed client's query form is disabled on newer Jira).
 */
async function fetchCreateMetaFields(
  settings: JiraSettings,
  issueTypeId: string,
): Promise<CreateMetaField[]> {
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  const url =
    `${baseUrl}/rest/api/2/issue/createmeta/`
    + `${encodeURIComponent(settings.projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${settings.apiToken}`, 'Content-Type': 'application/json' },
  })
  const data = await parseJiraJson<CreatemetaPathResponse>(res, 'createmeta')
  return (data.values ?? []).map((v) => ({
    id: v.fieldId,
    name: v.name,
    type: v.schema?.type,
    required: v.required,
    hasDefaultValue: v.hasDefaultValue,
    allowedValues: (v.allowedValues ?? []).map((a) => a.value ?? a.name ?? '').filter(Boolean),
  }))
}

/** Create-form metadata for the configured project and selected issue type. */
export async function fetchCreateMeta(
  settings: JiraSettings,
  issueTypeId?: string,
): Promise<CreateMeta> {
  const client = createJiraClient(settings)
  const project = (await client.projects.get({
    projectKeyOrId: settings.projectKey,
    expand: 'issueTypes',
  })) as unknown as { issueTypes?: { id: string; name: string }[] }
  const issueTypes = (project.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name }))
  const typeId = issueTypeId ?? issueTypes[0]?.id
  const fields = typeId ? await fetchCreateMetaFields(settings, typeId) : []
  return { projectKey: settings.projectKey, issueTypes, fields }
}

/** Search users by query for the searchable assignee. */
export async function searchCreateUsers(
  settings: JiraSettings,
  query: string,
): Promise<CreateUserOption[]> {
  const client = createJiraClient(settings)
  const users = await client.users.searchUsers({ username: query, maxResults: 20 })
  return users.map((u) => ({ name: u.name, displayName: u.displayName ?? u.name }))
}

/** The authenticated user's username (for permission checks). */
export async function getCurrentUsername(settings: JiraSettings): Promise<string> {
  const client = createJiraClient(settings)
  const me = await client.users.getMyself()
  return me.name ?? me.key ?? ''
}

/** The reporter's Jira username (or key) for an issue, if any. */
export function reporterUsername(issue: JiraIssue): string | undefined {
  return issue.fields.reporter?.name ?? issue.fields.reporter?.key
}

/** Whether the current user may delete the issue (they are the reporter). */
export async function canDeleteIssue(settings: JiraSettings, issue: JiraIssue): Promise<boolean> {
  const reporter = reporterUsername(issue)
  if (!reporter) return false
  const me = await getCurrentUsername(settings)
  return me === reporter
}

/** Delete a Jira issue. */
export async function deleteIssue(settings: JiraSettings, key: string): Promise<void> {
  const client = createJiraClient(settings)
  await client.issues.delete({ issueKeyOrId: key })
}

/** Build the comment list for a fetched issue (plain-text body + rendered HTML). */
export function buildComments(issue: JiraIssue): IssueComment[] {
  const raw = issue.fields.comment?.comments ?? []
  const rendered = (
    issue.renderedFields as { comment?: { comments?: { body?: string }[] } } | undefined
  )?.comment?.comments ?? []
  return raw.map((c, i) => {
    const html = rendered[i]?.body
    return {
      id: c.id,
      author: c.author?.displayName,
      created: c.created,
      body: normalizeDescription(c.body as string | object | null | undefined) ?? '',
      ...(typeof html === 'string' && html.trim() ? { bodyHtml: proxyJiraImageUrls(html) } : {}),
    }
  })
}

/** Assign an issue to a user (Jira username), optionally with a comment. */
export async function assignIssue(
  settings: JiraSettings,
  key: string,
  username: string,
  comment?: string,
): Promise<void> {
  const client = createJiraClient(settings)
  await client.issues.update({ issueKeyOrId: key, fields: { assignee: { name: username } } })
  if (comment && comment.trim()) {
    await client.issues.addComment({ issueKeyOrId: key, body: comment.trim() })
  }
}

/** Add a comment to an issue (author = current user). */
export async function addComment(
  settings: JiraSettings,
  key: string,
  body: string,
): Promise<void> {
  const client = createJiraClient(settings)
  await client.issues.addComment({ issueKeyOrId: key, body })
}

/** Upload an image (base64) as an issue attachment, returning its filename. */
export async function addAttachment(
  settings: JiraSettings,
  key: string,
  filename: string,
  dataBase64: string,
): Promise<string> {
  const buffer = Buffer.from(dataBase64, 'base64')
  const dir = path.join(os.tmpdir(), `kb-att-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  const tempPath = path.join(dir, filename)
  await writeFile(tempPath, buffer)
  try {
    const client = createJiraClient(settings)
    const attachments = await client.issues.addAttachment({ issueKeyOrId: key, filePath: tempPath })
    const first = Array.isArray(attachments) ? attachments[0] : attachments
    return (first as { filename?: string } | undefined)?.filename ?? filename
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Create a Jira issue via the typed client. */
export async function createIssue(
  settings: JiraSettings,
  input: CreateIssueRequest,
): Promise<{ issue: BoardIssue; key: string }> {
  const fields = input.fields
  const projectKey = ((fields.project as { key?: string } | undefined)?.key) ?? settings.projectKey
  const issuetypeName = ((fields.issuetype as { name?: string } | undefined)?.name) ?? ''

  const client = createJiraClient(settings)
  const created = await client.issues.create({
    projectKeyOrId: projectKey,
    issueTypeName: issuetypeName,
    summary: input.summary,
    customFields: fields,
  })
  const issue = await client.issues.get({ issueKeyOrId: created.key })
  return { issue: normalizeIssue(issue, settings.baseUrl), key: created.key }
}

/** Map vendor transitions to our slim DTO. */
export function toTransitionOptions(
  transitions: JiraTransition[],
): { id: string; name: string; toStatus: BoardStatus }[] {
  return transitions.map((t) => ({
    id: t.id,
    name: t.name,
    toStatus: toBoardStatus(t.to),
  }))
}
