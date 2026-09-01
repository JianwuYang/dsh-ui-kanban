// 构建产物冒烟测试：验证主插件注册看板工具、配置经 settings 命名空间实时接线、
// 后端在不联网时解析项目列表，以及浏览器 client bundle 的 __ModuleLoader__ 握手可执行。
// 运行：node test/smoke.mjs（先 pnpm build）
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { name, inject, apply, registerKanbanApi } from '../lib/index.js'
import { KanbanBackend } from '../lib/index.js'

// Workspace provider used by the backend (no harness registry in the smoke).
const WS = [{ id: 'default', title: 'Default', path: '/tmp/ws-default' }]
const workspaces = () => ({ list: () => WS, resolveByPath: (p) => WS.find((w) => w.path === p) })

const config = {
  dataDir: path.join(os.tmpdir(), `dsh-kanban-smoke-${process.pid}`),
  allowSelfSigned: true,
  verbose: false,
  jira: { baseUrl: 'https://jira.example.com', apiToken: 'tok' },
  gitlab: { baseUrl: '', apiToken: '' },
  projects: [{ id: 'default', jira: { projectKey: 'PROJ', jql: '' } }],
}

// ---- 最小 ctx（无 settings 服务）：配置回退到 composition entry ----
const registeredTools = []
const ctx = {
  tools: { register(definition) { registeredTools.push(definition) } },
  inject() { return () => {} },
  get() { return undefined },
}
apply(ctx, config)

assert.equal(name, 'dsh-kanban')
assert.deepEqual(inject, ['tools'])

const names = registeredTools.map((t) => t.name)
for (const tool of ['kanban-projects', 'kanban-issues', 'kanban-sync', 'kanban-issue', 'kanban-move', 'kanban-create', 'kanban-comment', 'kanban-gitlab-issues', 'kanban-gitlab-mrs']) {
  assert.ok(names.includes(tool), `tool ${tool} should be registered`)
}

// ---- settings 接线：settings 服务存在时，命名空间注册、配置实时读取 ----
{
  let liveValue = { ...config }
  const settingsCtx = {
    settings: {
      register(ns, _schema, options) {
        assert.equal(ns, 'dsh-kanban')
        assert.deepEqual(options.base, config, 'composition entry 应作为 base 层传入')
        return { get: () => liveValue, watch: () => () => {}, update: async (patch) => { liveValue = { ...liveValue, ...patch } } }
      },
    },
    effect: () => () => {},
  }
  const liveTools = []
  const liveCtx = {
    tools: { register(definition) { liveTools.push(definition) } },
    inject(names2, cb) {
      if (names2.includes('settings')) cb(settingsCtx)
      return () => {}
    },
    get() { return undefined },
  }
  apply(liveCtx, config)
  assert.ok(liveTools.some((t) => t.name === 'kanban-projects'), 'kanban-projects should register under live settings')
  assert.ok(liveTools.every((t) => typeof t.presentResult === 'function'), 'all tools should define presentResult')
}

// ---- 后端：不联网解析项目列表（由工作区派生） ----
const backend = new KanbanBackend(() => config, workspaces)
const projects = await backend.listProjects()
assert.equal(projects.length, 1)
assert.equal(projects[0].name, 'Default')
assert.equal(projects[0].issueCount, 0)
assert.equal(backend.dataDir(), config.dataDir)
assert.equal(backend.activeProject()?.id, 'default')
assert.equal(backend.activeProject()?.jira?.projectKey, 'PROJ')
assert.equal(backend.activeProject()?.jira?.baseUrl, 'https://jira.example.com')
assert.equal(backend.activeProject()?.localRepo?.directory, '/tmp/ws-default')
const active = backend.activeProject()
const meta = await backend.syncMeta(active)
assert.equal(meta.issueCount, 0)
assert.deepEqual(await backend.listIssues(active), [])

// ---- /kanban-api 桥：webServer 组合时注册前缀路由 ----
{
  let registered = null
  const wsCtx = { webServer: { register(route) { registered = route; return () => {} } } }
  const injectCtx = { inject(names, cb) { if (names.includes('webServer')) cb(wsCtx); return () => {} } }
  registerKanbanApi(injectCtx, backend, async () => {})
  assert.ok(registered, 'webServer route should be registered')
  assert.equal(registered.kind, 'prefix')
  assert.equal(registered.path, '/kanban-api')
  assert.equal(typeof registered.handler, 'function')
}

// ---- 配置 schema 规则（经由工具输出 schema 间接验证 defineTool 编译） ----
const boardTool = registeredTools.find((t) => t.name === 'kanban-issues')
assert.ok(boardTool, 'kanban-issues should be registered')
assert.ok(boardTool.output && typeof boardTool.output.render === 'function', 'output.render required')
assert.equal(typeof boardTool.execute, 'function')

// ---- 浏览器 client bundle：__ModuleLoader__ 握手可执行 ----
{
  let captured
  globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg } } }
  await import('../lib/client.js')
  assert.ok(captured, 'client bundle should call __ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-kanban')
  assert.equal(typeof captured.factory, 'function', 'client bundle should expose a factory')
  const React = (await import('react')).default
  const jsxRuntime = (await import('react/jsx-runtime'))
  const exportsObj = captured.factory((id) => {
    if (id === 'react') return React
    // The bundle externalizes react/jsx-runtime; the browser module table provides it too.
    if (id === 'react/jsx-runtime') return jsxRuntime
    throw new Error(`unexpected require ${id}`)
  })
  assert.equal(typeof exportsObj.apply, 'function', 'client half should export apply')
  assert.ok(Array.isArray(exportsObj.inject) && exportsObj.inject.includes('slots'), 'client half should inject slots')

  // 用最小 ctx 触发 client apply，验证各表面能注册而不抛错。
  let injected = 0
  const registeredSlotNames = []
  const clientCtx = {
    slots: {
      inject(_name, cb) { injected += 1; return cb() },
      register(opts) { assert.ok(opts && typeof opts.name === 'string', 'register should receive options.name'); registeredSlotNames.push(opts.name); return () => {} },
    },
    get() { return undefined }, // 无 settingsScope —— 各表面应优雅降级
  }
  exportsObj.apply(clientCtx)
  assert.ok(injected >= 4, `client should inject at least 4 surfaces, got ${injected}`)
  assert.ok(registeredSlotNames.includes('conversation.input.left'), 'branch chip should register into conversation.input.left')
}

// ---- host git 路由：在真实临时 git 仓库上验证 current-branch / branches ----
{
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-kanban-git-'))
  const emptyDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-kanban-git-empty-'))
  const plainDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-kanban-git-plain-'))
  const g = (dir, args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  g(repoDir, ['init', '-q', '-b', 'main'])
  g(repoDir, ['config', 'user.email', 'smoke@example.com'])
  g(repoDir, ['config', 'user.name', 'smoke'])
  g(repoDir, ['commit', '--allow-empty', '-q', '-m', 'init'])
  g(repoDir, ['branch', 'feature/x'])
  // 直接造一个远程跟踪 ref（无网络）：验证 origin/ 前缀剥离。
  g(repoDir, ['update-ref', 'refs/remotes/origin/remote-only', 'main'])
  g(emptyDir, ['init', '-q', '-b', 'main'])

  const gitWsList = [
    { id: 'gitws', title: 'GitWS', path: repoDir },
    { id: 'emptyws', title: 'EmptyWS', path: emptyDir },
    { id: 'plainws', title: 'PlainWS', path: plainDir },
  ]
  const gitBackend = new KanbanBackend(() => config, () => ({ list: () => gitWsList, resolveByPath: (p) => gitWsList.find((w) => w.path === p) }))
  let gitRegistered = null
  registerKanbanApi({ inject(names, cb) { if (names.includes('webServer')) cb({ webServer: { register(route) { gitRegistered = route; return () => {} } } }); return () => {} } }, gitBackend, async () => {})
  assert.ok(gitRegistered, 'git backend route should be registered')
  const call = async (url) => {
    let body = ''
    const res = { writeHead() {}, end(b) { body = b } }
    await gitRegistered.handler({ url, method: 'GET' }, res)
    return JSON.parse(body)
  }

  const cur = await call(`/kanban-api/git/current-branch?cwd=${encodeURIComponent(repoDir)}`)
  assert.equal(cur.branch, 'main')
  assert.equal(cur.detached, false)

  const list = await call(`/kanban-api/git/branches?cwd=${encodeURIComponent(repoDir)}`)
  // current 排最前；feature/x 的 '/' 是本地分支名的一部分，origin/remote-only 剥离为 remote-only。
  assert.deepEqual(list.branches, ['main', 'feature/x', 'remote-only'], 'branch list should strip origin/ prefixes')
  assert.equal(list.current, 'main')

  g(repoDir, ['checkout', '-q', '--detach'])
  const det = await call(`/kanban-api/git/current-branch?cwd=${encodeURIComponent(repoDir)}`)
  assert.equal(det.branch, null)
  assert.equal(det.detached, true)
  g(repoDir, ['checkout', '-q', 'main'])

  const plain = await call(`/kanban-api/git/current-branch?cwd=${encodeURIComponent(plainDir)}`)
  assert.equal(plain.branch, null)
  assert.equal(plain.detached, false)
  assert.ok(plain.error, 'non-git dir should report an error')

  const empty = await call(`/kanban-api/git/current-branch?cwd=${encodeURIComponent(emptyDir)}`)
  assert.equal(empty.branch, 'main', 'unborn branch name should be readable')
  const emptyList = await call(`/kanban-api/git/branches?cwd=${encodeURIComponent(emptyDir)}`)
  assert.deepEqual(emptyList.branches, [])
  assert.equal(emptyList.current, 'main')
}

console.log('smoke ok')
