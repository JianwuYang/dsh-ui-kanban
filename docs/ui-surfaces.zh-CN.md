# dsh-kanban — 浏览器半边 UI 面

客户端半边（`src/client/`）通过 `ctx.slots` 注册四个 UI 面。除配置卡片的*数据路径*
外，其余都是纯声明式插槽注册，**无需**改动 harness 源码即可在任何 harness 上工作；
只有配置卡片的数据路径受 web settings 白名单门控（见下文）。

| 面 | 模块 | Id / Key | 行为 |
|----|------|----------|------|
| `settings.plugin.item` | `src/client/config-card.ts` | key = `dsh-kanban` | 设置 → 插件 → Configurable 下的一张卡片。编辑**全局 Jira/GitLab host + token**（token 是密码框；留空保留 host 侧密钥，不会覆盖已脱敏的 token）以及标量设置（`dataDir`、`allowSelfSigned`、`verbose`）。全局 host/token 通过 merge-only 的 `PUT /kanban-api/settings/global` 端点写入；工作区级的项目/连接覆盖用 `kanban-configure` 工具管理。 |
| `conversation.session.header.utilities` | `src/client/kanban-activity.tsx` | id = `dsh-kanban` | 会话标题右侧工具行里的**「看板」按钮（图标 + 文字）**。会话作用域：点击打开该会话工作区的悬浮面板。这是交互式看板的唯一入口。 |
| `shell.overlay` | `src/client/kanban-activity.tsx` | id = `dsh-kanban-panel` | 由上面的头部按钮打开的**会话级悬浮面板**（无常驻徽标）。实时跟随**当前选中会话**的工作区（无选中时回退到打开按钮所属会话的 `cwd`）：在 DSH 里切换会话/工作区时，面板经 `?cwd=` 重新加载新工作区的项目。通过面板的关闭按钮关闭。 |
| `tool.call.toolview` | `src/client/kanban-toolview.ts` | keys = `kanban-issues`、`kanban-sync`、`kanban-issue`、`kanban-move`、`kanban-projects` | 把 kanban 工具调用的结果渲染成可视的看板 / 详情 / 项目列表。 |

## host 侧 `/kanban-api` 桥

host 半边（`src/http.ts`）在 `/kanban-api` 注册一个 `webServer` 前缀路由，把移植来的
`KanbanBackend`（projects / settings / issues / sync / gitlab）暴露为同源 REST。
嵌入式浏览器应用直接 fetch 这些端点——Jira/GitLab 凭据只存在于这一处。路由经
`ctx.webServer.register()`（插件可见的路由注册表）注册，无需改动 harness；只有在
组合了 web server（`web` profile）时才挂载，headless profile 直接没有这条路由。

看板/列表端点接受可选的 `?workspace=<id|title|path>` 查询（定位某个工作区）或
`?cwd=<path>`（会话的工作区）——会话级悬浮面板在 `GET /issues` 和 `POST /sync`
上用其中之一来显示按会话区分的项目。缺省时回退到第一个工作区。在工作区模型下，
看板从每个 DSH 工作区派生一个项目，全局 Jira/GitLab host+token 位于命名空间顶层。

## 看板如何渲染

host 半边运行 `kanban-issues`（或 `kanban-sync`）时输出结构化的
`output.presentationMeta`，形状为 `{ kind: 'kanban-board', board }`
（`kanban-issue`/`kanban-move` 是 `kanban-detail`，`kanban-projects` 是
`kanban-projects`）。客户端的 `tool.call.toolview` 行从工具结果块（`block.meta`）
读取该 `meta` 并渲染：

- **board** — 按状态分组的列，每列是 issue 卡片（key、摘要、类型/优先级标签、负责人）。
- **detail** — key · 摘要、状态/类型/优先级/负责人、描述、附件、可用流转、评论数。
- **projects** — 项目（工作区）列表，当前项高亮。
- **sync** — 同步结果统计。

如果 `meta` 缺失（例如旧日志），该行回退为渲染工具输出的文本 `content`。

## 客户端 UI 架构与设计系统

客户端半边组织为 `src/client/` 下的小模块：

| 模块 | 职责 |
|------|------|
| `styles.ts` | 单个注入的 `<style>` 标签。设计 token 定义在 `:root, body`（`--kb-*`：圆角、间距、字号 ≥12px、动效 150–300ms、映射到 `--dsw-alias-*` 的语义色、状态类目色——注意 harness 把 `--dsw-alias-*` 定义在 `body` 上，主题映射 token 不能只放在 `:root`）。共享组件类是不加作用域的 `.kb-*`（应用与聊天 toolview 共用）；`.kkb-app` 只放应用布局规则；`.kkb-config-*` / `.kkb-header-*` 负责其余面。 |
| `icons.tsx` | 内联 SVG 图标集（`Ic*`），不引入图标库——客户端 bundle 只允许 `react` 运行时依赖。 |
| `modal.tsx` | 应用内 `Modal`（模块级深度栈保证 Esc 只关最顶层的嵌套弹窗、焦点陷阱 + 恢复、body 滚动锁、进出场动画；`footer={null}` 可去掉底栏）、`ConfirmDialog`/`PromptDialog`/`ChoiceDialog` + `DialogsProvider`——替代所有原生 `alert`/`confirm`/`prompt`。 |
| `toast.tsx` | `ToastProvider` + `useToast()`——带进出场动画的 aria-live toast。 |
| `primitives.tsx` | 共享组件：`IconButton`、`Avatar`（首字母）、`StatusDot`、`SearchInput`、`SegToggle`、`EmptyState`、骨架屏、`CopyButton`、`formatDateTime`（浏览器本地时间戳）。 |
| `kanban-app.tsx` | 应用壳：Providers、状态、加载/同步处理器、面板头（两行——品牌/元信息/关闭，带文字的操作按钮）。 |
| `kanban-board.tsx` | 唯一的看板视图：面向窄面板的按状态分组纵向列表——可折叠分组（状态点 + 数量 + 箭头）、整行卡片、本地搜索。没有拖拽、没有状态筛选 chips：移动 issue 走「点击 → 详情 → 流转按钮」（键盘友好），分组本身就是状态概览。 |
| `kanban-modals.tsx` | 设置 / 新建 issue（createmeta 驱动、芯片式多值字段）/ GitLab 工作区（嵌套子弹窗）/ issue 详情（附件、评论框、丢进会话分析）/ 图片灯箱。 |
| `session-send.ts` | 经官方 `ISession.prompt`（当前会话）与 `workspaces.startSession()`（当前工作区新建会话）实现「丢进会话分析」；图片附件以 image content part（base64）随消息发出。 |

交互：Esc 关闭最顶层弹窗（灯箱优先）、焦点陷阱与恢复、`prefers-reduced-motion`
禁用动画、状态分组按类目着色（待办中性色 / 进行中警示色 / 已完成成功色）、优先级
彩色标签、同步/详情加载有骨架屏、分组列表带本地搜索。toolview 类名已从旧的
`kkb-*` 集合迁移到共享的 `kb-*` 集合。

**丢进会话分析**：issue 详情弹窗有「丢进会话分析」按钮——确认弹窗（当前会话 /
在当前工作区新建会话）后面板经官方 `ISession.prompt` 发送提示词
（`session-send.ts`；新建会话走 `workspaces.startSession()`）。消息只带 issue key +
调用 `kanban-issue` 的指令，且只分析不修改——agent 通过工具拉实时数据，聊天里用
现有 toolview 渲染。图片附件经 host 代理拉取后以 image content part（base64）附上，
支持视觉的模型能直接看到；纯文本模型优雅降级。issue 详情的工具文本同时列出附件及
其真实的 Jira 下载 URL。

## 原生 harness 上的配置卡片

配置卡片在任何状态下都会渲染。在原生 harness 上，`dsh-kanban` settings 命名空间
不在 web 网关白名单（`WEB_SETTINGS_NAMESPACES`）里，因此 `settings.describe` 回答
`settings-not-exposed`，卡片显示只读的「未暴露」状态卡而不是字段。这只影响卡片的
**可编辑性**——host 半边在每次工具调用时仍然读取解析后的命名空间，工具照常工作。

要让卡片可编辑，把命名空间加进白名单：

```ts
const WEB_SETTINGS_NAMESPACES = [
  'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek',
  'dsh-kanban',   // ← 加这一行
] as const
```

（harness 中的路径是 `packages/host/apiproxy/src/api-proxy.ts`；重建 / 重启 harness
后刷新页面。）

## 编辑纪律

客户端 bundle 运行时只依赖 `react`（由浏览器模块表提供）；其余全部内联。不 import
任何 `@deepseek-ai` 客户端包——客户端半边使用 `src/client/types.ts` 里的最小结构类型，
服务一律经 `ctx` / `ctx.slots` 获取。
