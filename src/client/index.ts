/**
 * 客户端半边入口：把各 UI 面的注册组装起来，并导出 cordis 加载需要的 inject / apply。
 * 每个 UI 面一个独立模块（config-card / kanban-toolview），各自的注册函数在 apply 里
 * 按序调用。
 *
 * 本入口注册的插槽全部是纯声明式 UI 注册，不受 harness 的 WEB_SETTINGS_NAMESPACES
 * 白名单影响；只有配置卡片的数据路径（settings 命名空间）受白名单门控（见 config-card.ts）。
 * @module dsh-kanban/client
 */

import type { Context } from '@deepseek-ai/cordis'
import { injectStyles } from './styles.ts'
import { bindLocale } from './locales.ts'
import { registerConfigCard } from './config-card.ts'
import { registerKanbanToolview } from './kanban-toolview.ts'
import { registerKanbanActivity, registerKanbanHeader } from './kanban-activity.tsx'

/** 依赖的服务：slots 就绪后本插件才会加载。 */
export const inject = ['slots']

/**
 * 客户端插件主体：注入样式，按顺序注册各 UI 面。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: Context): void {
  injectStyles()
  // 绑定 harness 的 locale 服务：语言切换时 UI 文案跟着变（zh/en）。
  bindLocale(ctx.get('locale'))
  registerConfigCard(ctx)
  registerKanbanToolview(ctx)
  registerKanbanActivity(ctx)
  registerKanbanHeader(ctx)
}
