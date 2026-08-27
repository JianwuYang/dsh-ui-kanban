/**
 * 客户端半边的最小结构类型：运行时实例全部来自 ctx 服务（cordis 的 ctx.get /
 * 声明合并），不 import 任何 @deepseek-ai 客户端包，避免跨插件值导入与版本分裂。
 * 完整契约见 dsh-client-runtime 的 SettingsScope / SettingsScopeBinder 与
 * dsh-client-ui-slots 的插槽系统。
 * @module dsh-kanban/client/types
 */

/** 一个 settings 命名空间在浏览器侧的同步快照。 */
export interface SettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  value: unknown
  user: unknown
  writable: boolean
}

/** 浏览器侧 settings scope 的最小面。 */
export interface SettingsScopeLike {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** settingsScope 服务的最小面（dsh-client-ui-settings SettingsScopeBinder）。 */
export interface SettingsScopeBinderLike {
  bind(spec: { namespace: string }): SettingsScopeLike
}

/** 一次 slots.register 的最小选项。 */
export interface SlotOptions {
  name: string
  key?: string
  id?: string
  order?: number
  label?: string
  inject?: (sessionId: string) => Record<string, unknown>
}

/** 浏览器插槽服务的最小面。 */
export interface SlotsLike {
  inject(name: string, register: () => unknown): void
  register(options: SlotOptions, component: unknown): unknown
}

/** 一个 tool.call.toolview 的 block 的最小结构（ToolCallBlock 的子集）。 */
export interface ToolCallBlockLike {
  kind: 'tool-result' | 'tool-call'
  callId: string
  call?: { name: string; argsRaw: string } | null
  content?: readonly { type: string; text?: string }[]
  isError?: boolean
  meta?: unknown
  callView?: unknown
  resultView?: unknown
  subCalls?: readonly ToolCallBlockLike[]
}

/** tool.call.toolview 的 owner props 最小结构（ToolCallOwnerProps 的子集）。 */
export interface ToolCallOwnerPropsLike {
  callId?: string
  toolName?: string
  block?: ToolCallBlockLike
  cwd?: string
  home?: string
  openFile?: (path: string) => void
  inspect?: () => void
}

/** 一个可订阅的只读快照（session 列表等服务用）。 */
export interface ObservableSnapshotLike<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): T
}

/** 会话列表状态的最小面（dsh-client-runtime SessionListState 的子集）。 */
export interface SessionListStateLike {
  current: string | undefined
  ids: string[]
  /** Per-session rows; `cwd` (the workspace path) is what we read for the workspace model. */
  byId: Record<string, { cwd?: string }>
}

/**
 * sessions 服务的最小面（dsh-client-runtime SessionsService 的子集）。
 * 注意：`@deepseek-ai/cordis` 的类型已通过 `@deepseek-ai/dsh-client-runtime`
 * 把 `ctx.sessions` 声明为 `SessionStore`，因此这里不再对 Context 做声明合并，
 * 只在读取处做结构投射（见 kanban-activity.tsx 的 `ctx.get('sessions')`）。
 */
export interface SessionsServiceLike {
  list: ObservableSnapshotLike<SessionListStateLike>
  /** 选中一个会话为当前。 */
  open?(id: string): void
  /** 会话绑定（binding(id).session 是会话 face，官方 prompt 入口）。 */
  binding?(id: string): SessionBindingLike | undefined
}

/** SessionBinding 的最小面：session face 上的 prompt 就是向会话发消息的官方入口。 */
export interface SessionBindingLike {
  session: SessionFaceLike
}

/** ISession.prompt 的 content 部分（text / image）。 */
export type PromptContentPartLike =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

/** ISession.prompt 的最小面（官方「向会话发送提示」入口，queue=追加一轮）。 */
export interface SessionFaceLike {
  prompt(
    content: PromptContentPartLike[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }>
}

/**
 * workspaces 服务的最小面（dsh-client-runtime WorkspacesService 的子集）。
 * startSession() 无参 = 在当前会话工作区新建会话并打开（官方「新建会话」流程）。
 */
export interface WorkspacesServiceLike {
  startSession(workspaceId?: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 浏览器插槽服务（运行时由 client-ui-slots 提供）。 */
    slots: SlotsLike
  }
}
