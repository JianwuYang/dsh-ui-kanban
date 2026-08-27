import { defineConfig } from 'tsdown'

// tsdown 只做转译与打包，不做类型检查（类型检查由 `pnpm typecheck` 负责）。
// prepare 脚本在 git 安装后由 pnpm 执行，因此构建必须自包含、不依赖 monorepo。
// fixedExtension: false —— 包声明 "type": "module"，保持 .js/.d.ts 扩展名，
// 与 package.json 的 exports 映射一致。

/** Host 半边：Node 库，输出 lib/，供 cordis.yml 插件行按包名加载。
 *  单一入口把 index + 后端 + tools 打包成一个自包含的 lib/index.js，
 *  避免 rolldown 为多入口分割出 hash 命名的共享 chunk（不在 files 白名单里，
 *  会破坏 npm tarball）。 */
const lib = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  fixedExtension: false,
}

// Client 半边：浏览器 bundle，交给 dsh 的 client-modules 分发。
// 产物必须是 __ModuleLoader__.load 握手格式（banner/footer），并以 CJS 输出
// （工厂通过注入的 require 从浏览器模块表解析 externals）。
// externals 只允许浏览器平台模块表里有的包（见 dsh client/web 的
// PLATFORM_MODULES：react, react/jsx-runtime, react-dom, ...）。react 是唯一的
// 运行时外部依赖；JSX（react-jsx 自动运行时）会 import react/jsx-runtime，必须一并
// external，否则会把插件 node_modules 里那份不同版本的 react/jsx-runtime 打进 bundle
//（其元素 $$typeof 与 harness 用的 React 不一致，React 18 会报 #31 "not a valid child"）。
// 其余依赖一律内联（noExternal），防止 require 到模块表回答不了的 specifier。
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']

/** Client 半边：浏览器配置卡片 + 看板 toolview bundle，输出 lib/client.js。 */
const client = {
  name: 'dsh-kanban/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    // 固定产物名 lib/client.js，与 package.json exports["./client"] 对应。
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-kanban", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

// 数组形式：先构建 Node 库（clean），再产出 client bundle（clean 关闭，避免互相清掉）。
export default defineConfig([lib, client])
