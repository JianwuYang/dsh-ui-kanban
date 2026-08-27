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
import { t } from './locales.ts'

/** 生成发送给会话的分析提示词（带图片附件时提示结合图片分析；跟随当前 UI 语言）。 */
export function buildAnalysisPrompt(key: string, withImages: boolean): string {
  return t(withImages ? 'sendPromptWithImages' : 'sendPrompt', { key })
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
  if (!face) return { ok: false, error: t('sendFailed') }
  const result = await face.prompt(promptParts(key, images), 'queue')
  if (!result.ok) return { ok: false, error: result.error?.message ?? t('sendFailed') }
  return { ok: true }
}

/** 在当前工作区新建会话并把分析请求发进去（新会话成为当前会话）。 */
export async function sendToNewSession(
  sessions: SessionsServiceLike | undefined,
  workspaces: WorkspacesServiceLike | undefined,
  key: string,
  images?: PromptContentPartLike[],
): Promise<{ ok: boolean; error?: string }> {
  if (!workspaces?.startSession) return { ok: false, error: t('sendFailed') }
  const before = sessions?.list.getSnapshot().current
  workspaces.startSession()
  const id = await waitForNewCurrent(sessions, before)
  if (id === undefined) return { ok: false, error: t('sendFailed') }
  const face = sessions?.binding?.(id)?.session
  if (!face) return { ok: false, error: t('sendFailed') }
  const result = await face.prompt(promptParts(key, images), 'queue')
  if (!result.ok) return { ok: false, error: result.error?.message ?? t('sendFailed') }
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
