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
const workspaces = () => ({ list: () => WS })

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

// ---- 工作区归属：sessionId 是权威来源，cwd 只是兜底 ----
{
  const twoWs = () => ({
    list: () => [
      { id: 'ws-a', title: 'A', path: '/tmp/ws-a', sessionIds: ['sess-a'] },
      { id: 'ws-b', title: 'B', path: '/tmp/ws-b', sessionIds: ['sess-b'] },
    ],
  })
  const b = new KanbanBackend(() => config, twoWs)
  assert.equal(b.workspaceForSession('sess-b')?.id, 'ws-b')
  assert.equal(b.workspaceForSession('nope'), undefined)
  // 会话归属优先于 cwd：cwd 指错（或非规范路径）也不会串到别的工作区。
  assert.equal(b.requireProject(undefined, '/tmp/ws-a', 'sess-b').id, 'ws-b')
  // 没有 session 时才按 cwd，最后才回退第一个工作区。
  assert.equal(b.requireProject(undefined, '/tmp/ws-b').id, 'ws-b')
  assert.equal(b.requireProject(undefined, '/tmp/unknown').id, 'ws-a')
  assert.equal(b.requireProject(undefined, undefined, 'sess-b').id, 'ws-b')
}

// ---- /kanban-api 桥：webServer 组合时注册前缀路由 ----
{
  let registered = null
  const wsCtx = {
    webServer: { register(route) { registered = route; return () => {} } },
    // cordis 的 Context.effect 收集 register() 返回的 disposer；最小 ctx 里同样收下。
    effect(body) { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  const injectCtx = { inject(names, cb) { if (names.includes('webServer')) cb(wsCtx); return () => {} } }
  registerKanbanApi(injectCtx, backend, async () => {})
  assert.ok(registered, 'webServer route should be registered')
  assert.equal(registered.kind, 'prefix')
  assert.equal(registered.path, '/kanban-api')
  assert.equal(typeof registered.handler, 'function')
}

// ---- /kanban-api 信任围栏：connection 拒绝时原样转发 401/403 ----
{
  let registered = null
  const wsCtx = {
    webServer: { register(route) { registered = route; return () => {} } },
    effect(body) { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  const forbiddenCtx = {
    inject(names, cb) { if (names.includes('webServer')) cb(wsCtx); return () => {} },
    get(name) { return name === 'connection' ? { requestRejection: () => 403 } : undefined },
  }
  registerKanbanApi(forbiddenCtx, backend, async () => {})
  let status = 0
  let body = ''
  const res = { writeHead(code) { status = code }, end(b) { body = b } }
  await registered.handler({ url: '/kanban-api/state', method: 'GET', headers: { host: 'evil.example' } }, res)
  assert.equal(status, 403, 'a rejected request must not reach the route body')
  assert.equal(body, 'forbidden')
}

// ---- /kanban-api 信任围栏：connection 放行时正常响应 ----
{
  let registered = null
  const wsCtx = {
    webServer: { register(route) { registered = route; return () => {} } },
    effect(body) { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  const allowedCtx = {
    inject(names, cb) { if (names.includes('webServer')) cb(wsCtx); return () => {} },
    get(name) { return name === 'connection' ? { requestRejection: () => undefined } : undefined },
  }
  registerKanbanApi(allowedCtx, backend, async () => {})
  let status = 0
  let body = ''
  const res = { writeHead(code) { status = code }, end(b) { body = b } }
  await registered.handler({ url: '/kanban-api/state', method: 'GET', headers: { host: '127.0.0.1:3080' } }, res)
  assert.equal(status, 200, 'an accepted request must reach the route body')
  assert.equal(JSON.parse(body).projects.length, 1)
}

// ---- /kanban-api：?session= 选择工作区，已删除的手工项目端点返回 404 ----
{
  let registered = null
  const wsCtx = {
    webServer: { register(route) { registered = route; return () => {} } },
    effect(body) { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
  }
  const twoWs = () => ({
    list: () => [
      { id: 'ws-a', title: 'A', path: '/tmp/ws-a', sessionIds: ['sess-a'] },
      { id: 'ws-b', title: 'B', path: '/tmp/ws-b', sessionIds: ['sess-b'] },
    ],
  })
  const twoBackend = new KanbanBackend(() => config, twoWs)
  registerKanbanApi(
    { inject(names, cb) { if (names.includes('webServer')) cb(wsCtx); return () => {} }, get() { return undefined } },
    twoBackend,
    async () => {},
  )
  const call = async (url, method = 'GET') => {
    let status = 0
    let raw = ''
    const res = { writeHead(code) { status = code }, end(b) { raw = b } }
    // Minimal IncomingMessage: an empty async-iterable body lets readJson() run.
    const req = { url, method, headers: { host: '127.0.0.1:3080' }, async *[Symbol.asyncIterator]() {} }
    await registered.handler(req, res)
    return { status, body: raw ? JSON.parse(raw) : undefined }
  }
  assert.equal((await call('/kanban-api/projects')).body.currentProjectId, 'ws-a', 'no target => first workspace')
  assert.equal((await call('/kanban-api/projects?session=sess-b')).body.currentProjectId, 'ws-b', 'session selects its workspace')
  assert.equal((await call('/kanban-api/projects?cwd=%2Ftmp%2Fws-b')).body.currentProjectId, 'ws-b', 'cwd still selects by path')
  assert.equal((await call('/kanban-api/projects', 'POST')).status, 404, 'manual project create is gone')
  assert.equal((await call('/kanban-api/issues/AIPS-1/transitions')).status, 404, 'the separate transitions endpoint is gone')
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
    // cordis 的 ctx.inject(deps, cb)：本插件用它在 locale 就绪后绑定（无 locale 时优雅降级）。
    inject(names, cb) { if (names.includes('locale')) cb({ get: () => undefined }); return () => {} },
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
  const gitBackend = new KanbanBackend(() => config, () => ({ list: () => gitWsList }))
  let gitRegistered = null
  registerKanbanApi({
    inject(names, cb) {
      if (names.includes('webServer')) {
        cb({
          webServer: { register(route) { gitRegistered = route; return () => {} } },
          effect(body) { const dispose = body(); return () => { if (typeof dispose === 'function') dispose() } },
        })
      }
      return () => {}
    },
    // 无 connection 服务 = 不做信任围栏（与组合里没有 connection 时一致）。
    get() { return undefined },
  }, gitBackend, async () => {})
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
