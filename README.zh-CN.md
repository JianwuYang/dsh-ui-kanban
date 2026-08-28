# dsh-kanban

[English](README.md) | **简体中文**

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，
把 **Jira Server / Data Center + GitLab** 看板变成 **agent 真正能干活** 的看板——
每个 DSH 工作区就是一个看板项目，模型通过工具驱动看板，会话标题旁的悬浮面板给你人类的视角。

## 截图

| 悬浮看板 | Issue 详情 | 新建 issue |
|---|---|---|
| <img src="images/kanban-panel.png" width="320" alt="悬浮看板"> | <img src="images/issue-detail.png" width="560" alt="Issue 详情"> | <img src="images/create-issue.png" width="330" alt="新建 issue"> |

| GitLab 工作区 | 设置 |
|---|---|
| <img src="images/gitlab-workspace.png" width="560" alt="GitLab 工作区"> | <img src="images/settings.png" width="560" alt="设置"> |

## 亮点

- **一个工作区 = 一个项目。** 看板从每个工作区自动派生一个项目：独立的 Jira
  连接、GitLab 连接、本地仓库配置，以及各自的 issue 缓存。
- **面板跟随你的工作区。** 从会话标题旁的「看板」按钮打开面板后，面板实时跟踪
  **当前选中的会话**并自动加载对应工作区的项目——切换会话，看板跟着切。
- **打开即自动同步。** 每次打开面板，每个项目自动从 Jira 同步一次（先展示缓存
  数据，同步在后台进行）；刚配置好 Jira 也会自动同步一次。
- **为窄面板设计的分组列表。** 按状态分组、类目色条、可折叠分组、数量徽标、
  本地搜索；移动 issue 走「点击卡片 → 详情 → 流转按钮」（键盘友好）。
- **完整的 issue 详情。** 渲染后的描述（Jira 图片经 host 代理，浏览器无需
  token）、附件链接、流转按钮、评论（支持粘贴/选择图片上传）、图片灯箱。
- **用 Jira 自己的元数据建 issue。** 表单由 Jira createmeta 接口驱动：必填
  标记、问题类型自动选中、类型与优先级并排、负责人搜索、模块/标签等数组字段的
  芯片式多值输入（可点建议、可自由输入）、Jira 错误原因内联展示。
- **GitLab 工作区。** 议题与合并请求、状态筛选、搜索、打开 GitLab 链接、从
  选中的 Jira 事项创建议题、链接 Jira、创建合并请求（现有/新建分支、分支预览、
  关联议题）。
- **丢进会话分析。** 从 issue 详情一键把「只分析、不修改」的请求发进**当前会话**
  或**在当前工作区新建会话**——走官方 `ISession.prompt` /
  `workspaces.startSession()` 入口；图片附件以 image content part（base64）随消息
  发出，支持视觉的模型能真正看到图；指令要求 agent 用 `kanban-issue` 拉取最新
  数据、只分析不做任何修改。
- **带富渲染的工具。** 工具结果在对话里直接渲染成看板列、issue 详情、项目列表、
  同步统计。
- **双语 UI。** 所有界面跟随 harness 的语言设置（中文 / English），切换语言即时生效。

## 以 bundle 方式安装（面向用户）

```sh
dsh plugin --profile demo add /path/to/dsh-ui-kanban
# 或从 git 安装
dsh plugin --profile demo add github:you/dsh-ui-kanban
```

> pnpm ≥10 上首次 git 依赖的 `prepare` 会被拒绝；把该包加进 profile 的
> `pnpm-workspace.yaml` `allowBuilds` 后重试。

验证配置层并启动：

```sh
dsh --profile demo --dump-config     # 应能看到 "# == dsh-kanban" 配置层
dsh --profile demo
```

要使用 Web GUI 和配置卡片，用 `web` profile：

```sh
pnpm build
dsh plugin --profile web add /path/to/dsh-ui-kanban
dsh web
```

## 配置

`dsh-kanban` settings 命名空间的解析顺序：**schema 默认值 → cordis.yml base →
用户文档**。公共配置在顶层，项目嵌套在 `projects` 里。

```yaml
- insert:
    - id: dsh-kanban
      name: dsh-kanban
      config:
        dataDir: ''            # 留空 => ~/.dsh/kanban（环境变量 KANBAN_DATA_DIR 优先）
        allowSelfSigned: true  # GitLab 自签名 TLS 的公共默认值
        verbose: false
        jira:                  # 全局 Jira host + token，所有工作区继承
          baseUrl: 'https://jira.example.com'
          apiToken: ''
        gitlab:                # 全局 GitLab host + token，所有工作区继承
          baseUrl: ''          # 例如 https://gitlab.example.com
          apiToken: ''
        projects:              # 按工作区 id 的覆盖项
          - id: default        # 工作区 id
            name: Default      # 可选显示名覆盖（默认 = 工作区标题）
            jira:
              projectKey: 'PROJ'
              jql: ''          # 自动前置 `project = <key>`
            gitlab:
              project: ''      # group/repo 或完整 URL（自动归一化）
            localRepo:
              directory: ''    # 留空 => 工作区自身路径
```

看板自动派生**每个 DSH 工作区一个项目**（`id` = 工作区 id，`name` = 工作区标题，
`localRepo.directory` 默认 = 工作区路径）。所有工作区继承全局 Jira / GitLab
host + token；`projects` 只放用户改过的覆盖项。「当前项目」跟随**当前会话的工作区**，
不存在全局 `activeProject`。

Jira / GitLab token 都是 `role('secret')`；GUI 卡片只编辑全局 host/token
（密码留空 = 保留 host 侧密钥），工作区级连接覆盖用 `kanban-configure` 工具管理。

## 悬浮面板

从会话标题旁的「看板」按钮打开（`conversation.session.header.utilities` →
`shell.overlay`）。面板：

- 实时跟随**当前选中会话**的工作区（无选中时回退到打开按钮所属会话），变化时自动重载；
- 每个项目在面板打开期间自动同步一次，随后静默刷新；
- 展示按状态分组的 issue 列表：类目色条、可折叠分组、数量徽标、本地搜索
  （key / 摘要 / 负责人 / 状态名）；
- 点击卡片打开详情（Enter/Space 可键盘操作）：渲染后的描述、附件链接、流转按钮、
  支持粘贴图片的评论框，以及「丢进会话分析」操作；
- 承载 GitLab 工作区（议题/合并请求、从 Jira 创建、链接 Jira、创建 MR）和
  设置弹窗（Jira / GitLab 连接）。

## 给 agent 的能力

host 半边注册了 15 个模型可调用的工具。真实的 Jira/GitLab 操作（以及磁盘上的
issue 缓存）都在 host 半边完成——浏览器拿不到任何 Jira/GitLab 凭据，token 是
`role('secret')`，Web 侧永远不会回显。

| 工具 | 用途 |
|------|---------|
| `kanban-projects` | 列出项目（工作区）、Jira key、同步状态、当前项目。 |
| `kanban-set-active-project` | 设置工具的默认操作项目。 |
| `kanban-configure` | 设置项目的 Jira / GitLab / 本地仓库连接。 |
| `kanban-sync` | 从 Jira 拉取 issue 到本地缓存（新增/更新计数）。 |
| `kanban-issues` | 读取缓存看板，按状态列分组。 |
| `kanban-issue` | 实时详情：描述、附件、流转、评论、canDelete。 |
| `kanban-move` | 通过工作流流转移动 issue。 |
| `kanban-create` | 创建 Jira issue（并写入缓存）。 |
| `kanban-comment` | 评论 issue。 |
| `kanban-assign` | 把 issue 分配给用户（Jira 用户名），可顺带添加评论。 |
| `kanban-gitlab-issues` | GitLab 议题（含链接的 Jira key 与 MR）。 |
| `kanban-gitlab-mrs` | GitLab 合并请求（含关联 issue 与 Jira key）。 |
| `kanban-gitlab-create-issue` | 从一个或多个 Jira 事项创建 GitLab 议题。 |
| `kanban-gitlab-create-mr` | 创建 GitLab 合并请求（可选从新分支创建）。 |
| `kanban-gitlab-link-jira` | 把 Jira key 链接到 GitLab 议题。 |

## 丢进会话分析

issue 详情里有「**丢进会话分析**」操作。确认弹窗选择发送位置（当前会话 /
在当前工作区新建会话）后：

1. 面板通过官方 `ISession.prompt` 入口发送提示词（新建会话走
   `workspaces.startSession()`，在当前工作区创建并打开新会话）；
2. 消息只带 issue key + 指令：调用 `kanban-issue` 拉取最新详情、**只做分析
   不做任何修改**——agent 通过工具拿实时数据，聊天里用同一套 toolview 富渲染；
3. 图片附件经 host 代理拉取后以 image content part（base64）随消息发出，支持
   视觉的模型能直接看到；纯文本模型优雅降级（harness 会替换成文本占位提示）。

## 本地开发

在 `deepseek-harness` 源码根目录，用 overlay 直接加载本仓库源码（只有 host
半边，不用安装）：

```sh
cp dev/cordis.example.yml dev/cordis.yml   # 首次使用：模板 → 本地文件（已 gitignore）
# 编辑 dev/cordis.yml，把 name 改成本仓库的绝对路径
pnpm dsh web --patch /absolute/path/to/dsh-ui-kanban/dev/cordis.yml
```

要测试浏览器半边，请把包安装进 profile（见上）。

运行检查：

```sh
pnpm install
pnpm typecheck
pnpm build
node test/smoke.mjs
```

`test/smoke.mjs` 验证：host 模块加载并注册工具、settings 命名空间接线、后端离线
解析项目列表、浏览器 `lib/client.js` 的 `__ModuleLoader__` 握手可执行。

## 浏览器半边的工作原理

- `package.json` 声明 `dsh.client: { platform: "web" }` + `exports["./client"]`；
  dsh 的 client-modules 把 `lib/client.js` 作为浏览器插件加载。
- `src/client/index.ts` 注册各 UI 面——配置卡片（`settings.plugin.item`）、工具
  结果自定义渲染（按 kanban 工具名 keyed 的 `tool.call.toolview`）、会话标题旁
  「看板」按钮打开的悬浮面板（`conversation.session.header.utilities` →
  `shell.overlay`，交互式看板的唯一入口）。详见
  [docs/ui-surfaces.md](docs/ui-surfaces.md)。
- 看板渲染来自 host 半边在每个工具调用上输出的结构化
  `output.presentationMeta`，不需要向 host 发任意 RPC。
- 客户端运行时只依赖 `react`，其余（图标、弹窗、toast）全部内联；所有颜色走
  host 主题变量（`--dsw-alias-*`），深浅色自动适配。

## 改成你自己的插件

一致地重命名：`package.json` 的 `name`、`src/index.ts` 的 `name`/`NAMESPACE`、
`cordis.patch.yml` 的 `id`/`name`、`tsdown.config.ts` 里的客户端 bundle `id`、
`src/client/constants.ts`。在 `src/config.ts`（Config + schema）里增删字段，并在
配置卡片里镜像标量字段。

## 发布

- **npm**：`pnpm publish`
- **tarball**：`pnpm pack`，然后 `dsh plugin add ./dsh-kanban-0.1.0.tgz`
- **git**：`dsh plugin add github:you/dsh-ui-kanban`

## License

MIT
