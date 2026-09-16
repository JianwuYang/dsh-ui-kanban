/**
 * 客户端半边入口：把各 UI 面的注册组装起来，并导出 cordis 加载需要的 inject / apply。
 * 每个 UI 面一个独立模块（config-card / kanban-toolview / kanban-activity /
 * chat-branch），各自的注册函数在 apply 里按序调用。全部是纯声明式 UI 注册，
 * 不改任何 harness 源码；配置卡片的数据路径走 ctx.settingsScope（harness 自
 * 2026-08-12 起"注册即暴露"，不再有命名空间白名单）。
 * @module dsh-kanban/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { injectStyles } from './styles.ts'
import { bindLocale } from './locales.ts'
import { registerConfigCard } from './config-card.ts'
import { registerKanbanToolview } from './kanban-toolview.ts'
import { registerKanbanActivity, registerKanbanHeader } from './kanban-activity.tsx'
import { registerChatBranch } from './chat-branch.tsx'

/** 依赖的服务：slots 就绪后本插件才会加载。 */
export const inject = ['slots']

/**
 * 客户端插件主体：注入样式，按顺序注册各 UI 面。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  injectStyles()
  // 绑定 harness 的 locale 服务：语言切换时 UI 文案跟着变（zh/en）。
  // 用 ctx.inject 而不是 apply 期 ctx.get('locale')：客户端插件只声明 inject=['slots']，
  // locale 可能在本插件 apply 之后才 active，apply 期读一次会永久拿到 undefined
  // （UI 永远回退中文）；inject 的回调在服务就绪时才跑，且不阻塞本插件加载。
  ctx.inject(['locale'], (lctx) => { bindLocale(lctx.get('locale')) })
  registerConfigCard(ctx)
  registerKanbanToolview(ctx)
  registerKanbanActivity(ctx)
  registerKanbanHeader(ctx)
  registerChatBranch(ctx)
}
