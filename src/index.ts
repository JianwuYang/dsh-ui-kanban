/**
 * dsh-kanban 主插件：把 ui-kanban 的 Jira/GitLab 看板改造成一个可被 agent
 * 使用的 dsh 插件。
 *
 * 概念映射（工作区模型）：**每个 DSH 工作区对应看板里的一个「项目」**。项目不再
 * 手动创建，而是由工作区自动派生：`id`=工作区id、`name`=工作区title、`localRepo`
 * 目录默认=工作区 `path`。全局配置（settings `dsh-kanban` 顶层）存放共享的
 * **Jira / GitLab host + token**（以及 `dataDir/allowSelfSigned/verbose`），每个
 * 工作区只在其覆盖里写差异项（`projectKey`/`jql`、GitLab `project` 路径、本地仓库
 * 目录），未写则继承全局。[当前项目] 跟随**当前会话的工作区**（工具用
 * `exec.agent.session.cwd` 解析），不再有全局 activeProject。
 *
 * host 半边注册了一组模型可调用的工具（src/tools.ts），让 agent 能真正操作看板：
 * 同步、读板、读详情、流转、创建、评论，以及 GitLab 的 issue / MR / 关联操作。数据
 * 缓存放本地（issues/meta/links，按工作区 id 落盘），连接配置来自 settings 命名空间。
 *
 * 加载契约：模块具名导出 apply(ctx, config)；框架在依赖（inject）就绪后调用 apply，
 * 卸载时自动回收所有通过 ctx 注册的监听器与 effect，无需手动移除。
 * @module dsh-kanban
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import { Config, type Config as KanbanConfig } from './config.ts'
import { KanbanBackend, type WorkspaceLike, type WorkspaceProvider } from './service.ts'
import { registerKanbanTools } from './tools.ts'
import { registerKanbanApi } from './http.ts'

export { KanbanBackend, type KanbanStore, type WorkspaceLike, type WorkspaceProvider } from './service.ts'
export { registerKanbanApi } from './http.ts'
export type { Config as KanbanConfigType } from './config.ts'

/** 插件显示名（诊断日志中使用）。 */
export const name = 'dsh-kanban'

/** 命名空间 / 插件标识：settings 命名空间、bundle 条目 id 共用。 */
export const NAMESPACE = 'dsh-kanban'

/** 依赖的服务：tools 就绪后本插件才会加载。 */
export const inject = ['tools']

/** 工作区注册表服务键（新→旧）。 */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

/**
 * 插件主体：把所有注册挂在 ctx 上，随插件卸载自动回收。
 *
 * 配置来源：settings 服务存在时，把它注册为命名空间 `dsh-kanban`（cordis.yml 里的
 * 配置作为 composition base 层），GUI 配置卡片写入的用户层会覆盖 base；settings 服务
 * 不存在时回退到 cordis.yml 配置。工具通过 configSource() 惰性读取，因此用户在 GUI 里
 * 改完配置立即生效，无需重启。配置写操作（改全局连接 / 工作区覆盖）经 writeConfig()
 * 写回 settings 命名空间；settings 不可用时给出明确错误。
 *
 * 工作区：懒读取 `workspaceRegistry` / `workspace` 服务；headless 或服务未就绪时返回
 * 空列表（此时看板无项目，工具会给出「无项目」提示）。
 */
export function apply(ctx: Context, config: KanbanConfig): void {
  let configSource: () => KanbanConfig = () => config
  let scope: SettingsScope<KanbanConfig> | undefined

  ctx.inject(['settings'], (sctx) => {
    const scoped = sctx.settings.register(settingsNamespace(NAMESPACE), Config, { base: config })
    scope = scoped
    configSource = () => scoped.get()
    // settings 服务卸载时回退到 composition entry（或插件自身卸载），保持无 settings
    // 的 profile（headless）也能读到 cordis.yml 配置。
    sctx.effect(() => () => { configSource = () => config })
  })

  const getWorkspaces = (): WorkspaceProvider => {
    const registry = (ctx.get(WORKSPACE_KEYS[0])
      ?? ctx.get(WORKSPACE_KEYS[1])) as {
      list(): WorkspaceLike[]
      resolveByPath?(path: string): Promise<WorkspaceLike | undefined>
    } | undefined
    // Synchronous list view (registry.list() is synchronous).
    const list = (): WorkspaceLike[] => {
      try {
        return (registry?.list() ?? []).map((w) => ({ id: String(w.id), title: w.title, path: w.path }))
      } catch {
        return []
      }
    }
    return {
      list,
      resolveByPath: (path) => {
        const all = list()
        const p = (path ?? '').trim().replace(/\/+$/, '')
        if (!p) return undefined
        return all.find((w) => w.path === p || w.path.replace(/\/+$/, '') === p)
      },
    }
  }

  const backend = new KanbanBackend(() => configSource(), getWorkspaces)

  // 写回配置（全局 jira/gitlab host+token、按工作区覆盖）。settings 未挂载时报错。
  const writeConfig = async (patch: Partial<KanbanConfig>): Promise<void> => {
    if (!scope) {
      throw new Error('settings 服务不可用：请直接编辑 cordis.yml 中 dsh-kanban 段的 jira/gitlab，或启动带 dsh-web-app 的 profile')
    }
    await scope.update(patch)
  }

  registerKanbanTools(ctx, backend, writeConfig)
  registerKanbanApi(ctx, backend, writeConfig)
}
