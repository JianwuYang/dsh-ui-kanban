/**
 * 客户端半边共用的标识常量。
 * 改名时保持 package.json 的 `name`、src/index.ts 的 `name`、cordis.patch.yml 的
 * `id`/`name` 与此处一致（见 README "Making it your own plugin"）。
 * @module dsh-kanban/client/constants
 */

/** 插件名：settings 命名空间、settings 卡片插槽条目 id、侧栏/输入区条目的共用标识。 */
export const NAMESPACE = 'dsh-kanban'

/**
 * 哪些工具名渲染成自定义看板行（tool.call.toolview 的 keyed 键）。
 * host 半边（src/tools.ts）在这些工具的 output.presentationMeta 里输出
 * `{ kind: 'kanban-board', board }`，客户端据此渲染成看板。
 */
export const BOARD_TOOL_KEYS = ['kanban-issues', 'kanban-sync'] as const

/** 哪些工具名渲染成自定义详情行。 */
export const DETAIL_TOOL_KEYS = ['kanban-issue', 'kanban-move'] as const
