# dsh-kanban

**English** | [简体中文](README.zh-CN.md)

An installable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) plugin that turns the previously-built **ui-kanban** (a Jira Server /
Data Center + GitLab board) into a kanban the **agent can actually work**.

Concept mapping, as you asked:

- **Each DSH workspace ↔ each project.** A "project" is the ~ui-kanban unit: a
  fully self-contained workspace with its own **Jira** connection, **GitLab**
  connection and **local-repo** config, plus its own cached issues.
- **Config is per-workspace.** Each entry of `config.projects` is that
  workspace's connection config, so it's "based on workspace config".
- **What's common, you can lift into the settings bar.** Top-level config
  (`dataDir`, `allowSelfSigned`, `verbose`) plus the active project live at the
  top of the namespace and are edited in Settings → Plugins → Configurable.

The plugin follows the official [bundle distribution model](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md):
it declares `dsh.bundle` + `cordis.patch.yml`, and `dsh plugin add` activates it
as a config layer.

## What it gives the agent

The host half registers a set of model-callable tools. The agent drives the
board; the browser half renders the results. Real Jira/GitLab work (and the
on-disk issue cache) stays in the host half — nothing Jira/GitLab ships to the
browser, and tokens are `role('secret')` so the web surface never echoes them.

| Tool | Purpose |
|------|---------|
| `kanban-projects` | List projects (workspaces), their Jira keys, sync state, active one. |
| `kanban-create-project` | Create a project (optionally copying another's config). |
| `kanban-set-active-project` | Set which project tools operate on by default. |
| `kanban-configure` | Set a project's Jira / GitLab / local-repo connection. |
| `kanban-sync` | Pull issues from Jira into the local cache (added/updated counts). |
| `kanban-issues` | Read the cached board, grouped by status column. |
| `kanban-issue` | Live detail: description, transitions, comments, canDelete. |
| `kanban-move` | Move an issue via a workflow transition. |
| `kanban-create` | Create a Jira issue (and cache it). |
| `kanban-comment` | Comment on an issue. |
| `kanban-gitlab-issues` | GitLab issues (with linked Jira keys + MR). |
| `kanban-gitlab-mrs` | GitLab MRs (with issues + Jira keys). |
| `kanban-gitlab-create-issue` | Create one GitLab issue from one or more Jira issues. |
| `kanban-gitlab-create-mr` | Create a GitLab MR (optionally from a new branch). |
| `kanban-gitlab-link-jira` | Link Jira keys to a GitLab issue. |

## Install as a bundle (for users)

```sh
dsh plugin --profile demo add /path/to/dsh-ui-kanban
# or from git
dsh plugin --profile demo add github:you/dsh-ui-kanban
```

> On pnpm ≥10 the first git-dependency `prepare` is refused; add the package to
> the profile's `pnpm-workspace.yaml` `allowBuilds` and retry.

Verify the config layer and boot:

```sh
dsh --profile demo --dump-config     # should show a "# == dsh-kanban" layer
dsh --profile demo
```

For the Web GUI + config card, use the `web` profile:

```sh
pnpm build
dsh plugin --profile web add /path/to/dsh-ui-kanban
dsh web
```

## Configuration

The `dsh-kanban` settings namespace resolves: **schema defaults → cordis.yml
base → user document**. Common settings are at the top; projects are nested.

```yaml
- insert:
    - id: dsh-kanban
      name: dsh-kanban
      config:
        dataDir: ''            # empty => ~/.dsh/kanban (env KANBAN_DATA_DIR wins)
        allowSelfSigned: true  # common default for GitLab self-signed TLS
        verbose: false
        jira:                  # GLOBAL Jira host + token, inherited by every workspace
          baseUrl: 'https://jira.example.com'
          apiToken: ''
        gitlab:                # GLOBAL GitLab host + token, inherited by every workspace
          baseUrl: ''          # e.g. https://gitlab.example.com
          apiToken: ''
        projects:              # per-workspace OVERRIDES (keyed by workspace id)
          - id: default        # workspace id
            name: Default      # optional display override (default = workspace title)
            jira:
              projectKey: 'PROJ'
              jql: ''          # `project = <key>` is auto-prepended
            gitlab:
              project: ''      # group/repo or full URL (auto-normalized)
            localRepo:
              directory: ''    # empty => the workspace's own path
```

The board auto-derives **one project per DSH workspace** (`id` = workspace id, `name` =
workspace title, `localRepo.directory` defaults to the workspace path). Every
workspace inherits the global Jira / GitLab host + token; `projects` only carries
the per-workspace overrides the user changes. The "current project" follows the
**current session's workspace** — there is no global `activeProject`.

Jira tokens and GitLab tokens are `role('secret')`; the GUI card is read-only
about them (edit the global host/token with `kanban-configure`, or in settings).

## Local development

From a `deepseek-harness` checkout root, load this repo's source via overlay
(host half only, no install):

```sh
cp dev/cordis.example.yml dev/cordis.yml   # 首次使用：模板 → 本地文件（已 gitignore）
# 编辑 dev/cordis.yml，把 name 改成本仓库的绝对路径
pnpm dsh web --patch /absolute/path/to/dsh-ui-kanban/dev/cordis.yml
```

To test the browser-half config card, install into a profile (see above).

Run the checks:

```sh
pnpm install
pnpm typecheck
pnpm build
node test/smoke.mjs
```

`test/smoke.mjs` verifies the host module loads and registers the tools, the
settings-namespace wiring, the backend resolving projects offline, and that the
browser `lib/client.js` executes its `__ModuleLoader__` handshake.

## How the browser half works

- `package.json` declares `dsh.client: { platform: "web" }` +
  `exports["./client"]`; dsh's client-modules loads `lib/client.js` as a browser
  plugin.
- `src/client/index.ts` registers the surfaces — the config card
  (`settings.plugin.item`), custom tool-result views
  (`tool.call.toolview` keyed by the kanban tool names), and a session-scoped
  floating Jira panel opened from the session header "看板" button
  (`conversation.session.header.utilities` → `shell.overlay`), the only entry
  to the interactive board. See [docs/ui-surfaces.md](docs/ui-surfaces.md).
- The board renders from the structured `output.presentationMeta` the host half
  emits for each tool call; no arbitrary RPC to the host is needed.
- Runtime client deps: `react` only; everything else is inlined.

## Making it your own

Rename the package consistently across `package.json` `name`, `src/index.ts`
`name`/`NAMESPACE`, `cordis.patch.yml` `id`/`name`, the client bundle `id` in
`tsdown.config.ts`, and `src/client/constants.ts`. Add/remove fields in
`src/config.ts` (Config + schema) and mirror scalar fields in the config card.

## Publishing

- **npm**: `pnpm publish`
- **tarball**: `pnpm pack`, then `dsh plugin add ./dsh-kanban-0.1.0.tgz`
- **git**: `dsh plugin add github:you/dsh-ui-kanban`

## Related docs

- Plugin intro & build: [basic/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/index.md)
- Plugin config: [basic/config.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/config.md)
- Tools: [basic/tool.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/tool.md)
- Packaging: [basic/publish.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md)
- Services & events: [framework/index.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/framework/index.md)
