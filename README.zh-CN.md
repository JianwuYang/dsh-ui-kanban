# dsh-kanban

[English](README.md) | **简体中文**

一个可安装的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件，把之前做的 **ui-kanban**（Jira Server / Data Center + GitLab 看板）改造成「agent 真正能上手操作」的看板。

概念映射（按你的要求）：

- **每个工作区 ↔ 每个项目。** 「项目」就是 ui-kanban 里的单元：一套自包含的工作区，拥有自己的 **Jira** 连接、**GitLab** 连接、**本地仓库** 配置，以及自己的缓存 issue。
- **配置基于工作区。** `config.projects` 里每一项就是该工作区的连接配置。
- **公共的、方便提取的放进设置栏。** 顶层配置（`dataDir`、`allowSelfSigned`、`verbose`）加上激活项目可以放在命名空间顶层，在 设置 → 插件 → Configurable 里编辑。

插件遵循官方 [bundle 分发模型](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md)：声明 `dsh.bundle` + `cordis.patch.yml`，`dsh plugin add` 将其作为配置层激活。

## 给 agent 带来什么

host 半边注册了一组模型可调用的工具。agent 驱动看板，浏览器半边渲染结果。真正的 Jira/GitLab 调用（以及本地 issue 缓存）都在 host 半边——Jira/GitLab 数据不出 host，token 也都标了 `role('secret')`，Web 表面不会回显。

| 工具 | 作用 |
|------|------|
| `kanban-projects` | 列出项目（工作区）、Jira key、同步状态、激活的那个。 |
| `kanban-create-project` | 创建项目（可选复制另一个项目的配置）。 |
| `kanban-set-active-project` | 设置工具默认操作哪个项目。 |
| `kanban-configure` | 设置某项目的 Jira / GitLab / 本地仓库连接。 |
| `kanban-sync` | 从 Jira 拉取 issue 到本地缓存（返回新增/更新数）。 |
| `kanban-issues` | 读取缓存看板，按状态列分组。 |
| `kanban-issue` | 实时详情：描述、流转、评论、canDelete。 |
| `kanban-move` | 通过工作流流转移动一个 issue。 |
| `kanban-create` | 创建 Jira issue（并写入缓存）。 |
| `kanban-comment` | 评论 issue。 |
| `kanban-gitlab-issues` | GitLab issue（带关联的 Jira key + MR）。 |
| `kanban-gitlab-mrs` | GitLab MR（带关联 issue + Jira key）。 |
| `kanban-gitlab-create-issue` | 从多个 Jira 合并创建一个 GitLab issue。 |
| `kanban-gitlab-create-mr` | 创建 GitLab MR（可选从新分支）。 |
| `kanban-gitlab-link-jira` | 把 Jira key 关联到某个 GitLab issue。 |

## 作为 bundle 安装（给用户）

```sh
dsh plugin --profile demo add /path/to/dsh-ui-kanban
# 或从 git
dsh plugin --profile demo add github:you/dsh-ui-kanban
```

> pnpm ≥10 首次 git 依赖的 `prepare` 会被拒绝；把包名加到 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重试。

验证配置层并启动：

```sh
dsh --profile demo --dump-config     # 应显示 "== dsh-kanban" 层
dsh --profile demo
```

要 Web GUI + 配置卡片，用 web profile：

```sh
pnpm build
dsh plugin --profile web add /path/to/dsh-ui-kanban
dsh web
```

## 配置

`dsh-kanban` settings 命名空间的解析顺序：**schema 默认值 → cordis.yml base → 用户文档**。公共设置在顶层，项目嵌套在 `projects` 里。

```yaml
- insert:
    - id: dsh-kanban
      name: dsh-kanban
      config:
        dataDir: ''            # 留空 => ~/.dsh/kanban（环境变量 KANBAN_DATA_DIR 优先）
        allowSelfSigned: true  # GitLab 自签名 TLS 的公共默认值
        verbose: false
        activeProject: ''      # 留空 => 第一个项目
        projects:
          - id: default
            name: Default
            jira:
              baseUrl: 'https://jira.example.com'
              apiToken: ''
              projectKey: 'PROJ'
              jql: ''          # `project = <key>` 会自动前置
            gitlab:
              baseUrl: ''      # 例如 https://gitlab.example.com
              apiToken: ''
              project: ''      # group/repo 或完整 URL（自动归一化）
            localRepo:
              directory: ''
```

Jira 和 GitLab 的 token 都标了 `role('secret')`；GUI 卡片对它们只读，连接配置请用 `kanban-configure` 工具改。

## 本地开发

在 `deepseek-harness` 源码根目录，用 overlay 直接加载本仓库源码（只有 host 半边，不用安装）：

```sh
cp dev/cordis.example.yml dev/cordis.yml   # 首次使用：模板 → 本地文件（已 gitignore）
# 编辑 dev/cordis.yml，把 name 改成本仓库的绝对路径
pnpm dsh web --patch /absolute/path/to/dsh-ui-kanban/dev/cordis.yml
```

要测试浏览器半边的配置卡片，请安装进 profile（见上）。

运行校验：

```sh
pnpm install
pnpm typecheck
pnpm build
node test/smoke.mjs
```

`test/smoke.mjs` 会验证 host 模块加载并注册工具、settings 命名空间接线、后端离线解析项目列表，以及浏览器 `lib/client.js` 能执行它的 `__ModuleLoader__` 握手。

## 浏览器半边如何工作

- `package.json` 声明 `dsh.client: { platform: "web" }` + `exports["./client"]`；dsh 的 client-modules 会把 `lib/client.js` 作为浏览器插件加载。
- `src/client/index.ts` 注册两个表面——配置卡片（`settings.plugin.item`）和自定义工具结果视图（`tool.call.toolview`，按 kanban 工具名 keyed）。见 [docs/ui-surfaces.md](docs/ui-surfaces.md)。
- 看板由 host 半边每个工具调用输出的结构化 `output.presentationMeta` 渲染，不需要向 host 发任意 RPC。
- 运行时客户端依赖只有 `react`，其余全部内联。

## 改成你自己的插件

把下面这些保持一致地改名：`package.json` 的 `name`、`src/index.ts` 的 `name`/`NAMESPACE`、`cordis.patch.yml` 的 `id`/`name`、`tsdown.config.ts` 里 client bundle 的 `id`、`src/client/constants.ts`。在 `src/config.ts`（Config + schema）增删字段，并在配置卡片里同步新增标量字段。

## 发布

- **npm**：`pnpm publish`
- **tarball**：`pnpm pack`，然后 `dsh plugin add ./dsh-kanban-0.1.0.tgz`
- **git**：`dsh plugin add github:you/dsh-ui-kanban`

## 相关文档

- 插件开发入门： [basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/index.md)
- 插件配置： [basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/config.md)
- 工具开发： [basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/tool.md)
- 打包与安装： [basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md)
- 服务与事件： [framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/framework/index.md)
