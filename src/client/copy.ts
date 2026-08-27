/**
 * 看板里 Jira 事项的「拷贝」工具：把一条 issue 的摘要信息格式化成一段可粘贴的
 * 文本（key、摘要、状态、描述、评论、链接），供用户复制到会话/评论区/剪贴板。
 *
 * 默认使用 `navigator.clipboard`（安全上下文），失败时回退到
 * `document.execCommand('copy')`，尽量覆盖 dsh web 的所有宿主页面。
 * @module dsh-kanban/client/copy
 */

/** 一条 issue 的最小视图（BoardIssue / BoardIssueDetail 都满足）。 */
export interface IssueCopyView {
  key: string
  summary: string
  description?: string | null
  status?: { name?: string; category?: string } | null
  issueType?: string | null
  priority?: string | null
  assignee?: string | null
  reporter?: string | null
  url?: string
  comments?: { author?: string; created?: string; body?: string }[]
}

/** 把 issue 格式化成可粘贴的纯文本（供人 / agent 阅读）。 */
export function buildIssueCopyText(issue: IssueCopyView): string {
  const lines: string[] = [`${issue.key}: ${issue.summary}`]
  if (issue.status?.name) lines.push(`状态：${issue.status.name}`)
  if (issue.issueType) lines.push(`类型：${issue.issueType}`)
  if (issue.priority) lines.push(`优先级：${issue.priority}`)
  if (issue.assignee) lines.push(`负责人：${issue.assignee}`)
  if (issue.reporter) lines.push(`报告人：${issue.reporter}`)
  if (issue.url) lines.push(`链接：${issue.url}`)

  const desc = (issue.description ?? '').trim()
  if (desc) lines.push('', '描述：', desc)

  const comments = (issue.comments ?? []).filter((c) => (c.body ?? '').trim().length > 0)
  if (comments.length > 0) {
    lines.push('', '评论：')
    for (const c of comments) {
      const who = c.author ?? '未知'
      const when = c.created ? ` (${c.created})` : ''
      const body = (c.body ?? '').replace(/\n+/g, '\n  ').trim()
      lines.push(`- ${who}${when}: ${body}`)
    }
  }

  return lines.join('\n')
}

/** 把文本写入系统剪贴板；返回是否成功。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 回退到 execCommand 路径
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
