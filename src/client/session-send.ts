/**
 * 把 Jira issue 的「分析请求」发送进 DSH 会话。全部走官方入口：
 * - 发消息：session face 的 prompt(content, 'queue')（ISession.prompt，
 *   content 是 text/image 两部分联合）。
 * - 新建会话：workspaces.startSession()（无参 = 继承当前会话工作区、新建并打开，
 *   官方「新建会话」流程）；之后订阅 sessions.list 等新会话成为当前再发送。
 *
 * 消息只带 issue key + 分析指令，不带内容——内容由 agent 调 kanban-issue 工具
 * 获取（数据新鲜、渲染复用 toolview、上下文干净），并强调只分析不修改。
 * @module dsh-kanban/client/session-send
 */

import type { PromptContentPartLike, SessionFaceLike, SessionsServiceLike, WorkspacesServiceLike } from './types.ts'

const ANALYSIS_INSTRUCTION = '请先调用 kanban-issue 工具查看该问题的最新详情（描述、评论、附件）。附件会带有下载 URL，但如果你无法查看图片内容（当前模型不支持图像输入），请明确说明这一限制，并基于可获得的文本信息分析；分析这个问题是什么情况、可能的原因与影响，并给出处理建议。只做分析和建议，不要修改任何内容。'

const ANALYSIS_INSTRUCTION_WITH_IMAGES = '请先调用 kanban-issue 工具查看该问题的最新详情（描述、评论）。相关图片已作为附件随本条消息附上，请结合图片内容一起分析；分析这个问题是什么情况、可能的原因与影响，并给出处理建议。只做分析和建议，不要修改任何内容。'

/** 生成发送给会话的分析提示词（带图片附件时提示结合图片分析）。 */
export function buildAnalysisPrompt(key: string, withImages: boolean): string {
  return `请分析 Jira 问题 ${key}。${withImages ? ANALYSIS_INSTRUCTION_WITH_IMAGES : ANALYSIS_INSTRUCTION}`
}

/** 当前会话的 session face（root 作用域经 sessions.binding 取官方 face）。 */
function currentSessionFace(sessions: SessionsServiceLike | undefined): SessionFaceLike | undefined {
  if (!sessions) return undefined
  const id = sessions.list.getSnapshot().current
  if (id === undefined) return undefined
  return sessions.binding?.(id)?.session
}

/** 组装发送内容：文本指令 + 图片附件（官方 image content part，base64）。 */
function promptParts(key: string, images?: PromptContentPartLike[]): PromptContentPartLike[] {
  const parts: PromptContentPartLike[] = [{ type: 'text', text: buildAnalysisPrompt(key, (images ?? []).length > 0) }]
  for (const img of images ?? []) parts.push(img)
  return parts
}

/** 发送到当前会话（若当前会话不存在则失败）。images 为随附的图片 base64 部分。 */
export async function sendToCurrentSession(
  sessions: SessionsServiceLike | undefined,
  key: string,
  images?: PromptContentPartLike[],
): Promise<{ ok: boolean; error?: string }> {
  const face = currentSessionFace(sessions)
  if (!face) return { ok: false, error: '没有可用的当前会话' }
  const result = await face.prompt(promptParts(key, images), 'queue')
  if (!result.ok) return { ok: false, error: result.error?.message ?? '发送失败' }
  return { ok: true }
}

/** 在当前工作区新建会话并把分析请求发进去（新会话成为当前会话）。 */
export async function sendToNewSession(
  sessions: SessionsServiceLike | undefined,
  workspaces: WorkspacesServiceLike | undefined,
  key: string,
  images?: PromptContentPartLike[],
): Promise<{ ok: boolean; error?: string }> {
  if (!workspaces?.startSession) return { ok: false, error: 'workspaces 服务不可用，无法新建会话' }
  const before = sessions?.list.getSnapshot().current
  workspaces.startSession()
  const id = await waitForNewCurrent(sessions, before)
  if (id === undefined) return { ok: false, error: '新建会话超时，请稍后重试' }
  const face = sessions?.binding?.(id)?.session
  if (!face) return { ok: false, error: '新会话尚未就绪' }
  const result = await face.prompt(promptParts(key, images), 'queue')
  if (!result.ok) return { ok: false, error: result.error?.message ?? '发送失败' }
  return { ok: true }
}

/** 等 startSession 的产物就绪（当前会话 id 变化且非空），15s 超时返回 undefined。 */
function waitForNewCurrent(
  sessions: SessionsServiceLike | undefined,
  previous: string | undefined,
  timeoutMs = 15000,
): Promise<string | undefined> {
  const list = sessions?.list
  if (!list) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let done = false
    const finish = (id: string | undefined): void => {
      if (done) return
      done = true
      unsubscribe()
      clearTimeout(timer)
      resolve(id)
    }
    const check = (): void => {
      const cur = list.getSnapshot().current
      if (cur !== undefined && cur !== previous) finish(cur)
    }
    const unsubscribe = list.subscribe(check)
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    check()
  })
}
