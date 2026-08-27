// 构建产物冒烟测试：验证主插件注册看板工具、配置经 settings 命名空间实时接线、
// 后端在不联网时解析项目列表，以及浏览器 client bundle 的 __ModuleLoader__ 握手可执行。
// 运行：node test/smoke.mjs（先 pnpm build）
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
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
  const clientCtx = {
    slots: {
      inject(_name, cb) { injected += 1; return cb() },
      register(opts) { assert.ok(opts && typeof opts.name === 'string', 'register should receive options.name'); return () => {} },
    },
    get() { return undefined }, // 无 settingsScope —— 各表面应优雅降级
  }
  exportsObj.apply(clientCtx)
  assert.ok(injected >= 4, `client should inject at least 4 surfaces, got ${injected}`)
}

console.log('smoke ok')
