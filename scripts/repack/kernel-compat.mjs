#!/usr/bin/env node
/**
 * 插件 ↔ 内核导出兼容门禁（Pack 侧）。
 *
 * 为什么需要这个门禁
 * -----------------
 * Desktop 仓的 `scripts/plugin-kernel-compat.mjs` 只在 CI 里扫
 * `dsh-desktop/assets/plugins`（11 个 EAC 自有内置插件）。但 EAC 发行版里
 * 用户真正用到的插件是 **Pack 装配的 72 个**，走 catalog → repack → dist
 * 这条完全不同的路径，从来没被任何门禁覆盖过。
 *
 * 这个缺口的代价是实测出来的，不是假设：
 *   · `computer-user` 0.3.6 顶层 `import { settingsNamespace } from
 *     '@deepseek-ai/dsh-settings'`，该导出在 0.1.3 起被移除。ESM 具名导入在
 *     链接期解析，缺导出让整个模块图抛 SyntaxError → 插件完全无法加载。
 *   · `picturereader` 3.3.1 同款。
 *   · `dsh-conversation-tweaks` / `dsh-openclaw-bridge` / `dsh-prompt-custom`
 *     同款（且 prompt-custom 还 import 了已改名的 PERSONA_SECTION /
 *     PERSONA_ORDER）。
 * 这 6 个都在发布包里，且都不在 Desktop 门禁的扫描范围内。
 *
 * 和 Desktop 门禁的分工
 * --------------------
 * Desktop 门禁判「内置插件的源码」；本门禁判「Pack 真正要发出去的产物」。
 * 后者更严格也更准确：catalog 可以把第三方包固定到任意 npm 版本，源码在
 * 本仓根本不存在，只有 dist/*.tgz 才是用户拿到的东西 —— 所以本门禁直接
 * 校验 tgz 内容，而不是 `.cache/` 里的中间产物。
 *
 * 判定规则
 * -------
 * 对每个 tgz 的**服务端侧**源码（排除 package.json exports["./client"] 指向
 * 的浏览器 bundle、`client/**`、`*.client.js` —— 它们不经 Node 的 ESM
 * 链接期，写错只影响前端渲染，不拖垮插件树）：
 *   1. 扫 `import { a, b } from '@deepseek-ai/<pkg>'` 与重导出；
 *   2. 从内核安装目录静态解析该包真实导出的超集；
 *   3. 引用了不存在的导出 → 失败（fail-closed）。
 *
 * 防假阳性取舍（宁可漏判、绝不误判，否则门禁会被绕过）：
 *   · 导出集合 = 包目录下所有 JS 文件导出声明的并集（真实导出的超集）；
 *   · 静态枚举不出导出的包（CJS / 解析结果为空）整包跳过并计数；
 *   · 注释里的示例 import 先剥除再判定；
 *   · 只判具名导入；default / 命名空间导入与运行时 API 语义差异不在范围内。
 *
 * 用法
 * ----
 *   node scripts/repack/kernel-compat.mjs
 *   node scripts/repack/kernel-compat.mjs --json
 *   node scripts/repack/kernel-compat.mjs --kernel <@deepseek-ai 目录>
 *   node scripts/repack/kernel-compat.mjs --allowlist   # 打印当前已知豁免
 * 退出码：0 = 通过；1 = 命中不兼容；2 = 环境不满足（内核或 dist 缺失）。
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DIST = path.join(ROOT, 'dist')

const KERNEL_SCOPE = '@deepseek-ai/'
const CODE_EXT = /\.(?:c|m)?js$/i
// 与 Desktop 门禁一致的跳过目录
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'releases', '.git', '.pnpm'])

/**
 * 已知且**有意保留**的不兼容项。
 *
 * 加条目必须同时满足：① 该插件在 EAC 里默认不启用，或缺失的功能对用户不可见；
 * ② 写明为什么不能升版本 / 不能打补丁；③ 写明跟踪去向。
 * 引擎只报告不在本表里的新问题，避免门禁长期变红后被整体忽略。
 */
export const DEFAULT_ALLOWLIST = [
  // `@ha-na-bi/dsh-client-ui-custom` 引用了 3 个 0.2.x 已移除的旧图标名
  // （…16 后缀），拿到 undefined 后会 React #130。
  //
  // 为什么**不修**而是豁免：
  //   1. 该包 catalog 标 `compat: "eac-fork"`、`defaultEnabled: false` ——
  //      运行时由 companion-sync 的 stripIncompatibleProfileBundles() 从
  //      profile 剥离，永远不激活（实测：注入后启动会被剥回，依赖同步移除）；
  //   2. 它的源码不在 `.cache/eac-src` / `.cache/aio-src`，只能从已打包的 tgz
  //      反向修补 —— 属于对上游实现做 fork，违反 patches/README.md 的红线；
  //   3. 它依赖 EAC 分叉内核的专有服务（settingsScope 等），本身与官方 0.2.x
  //      不兼容，图标只是冰山一角。
  //
  // 因此这三个符号豁免；若将来把它改造成官方内核可用，必须先修掉这些图标。
  { plugin: '@ha-na-bi/dsh-client-ui-custom', symbol: 'IconChevronDownOutline14', spec: '@deepseek-ai/dsh-client-ui-primitives' },
  { plugin: '@ha-na-bi/dsh-client-ui-custom', symbol: 'IconCheckOutline16', spec: '@deepseek-ai/dsh-client-ui-primitives' },
  { plugin: '@ha-na-bi/dsh-client-ui-custom', symbol: 'IconCopyOutline16', spec: '@deepseek-ai/dsh-client-ui-primitives' },
]

/* ------------------------------------------------------------------ *
 * 内核导出解析
 * ------------------------------------------------------------------ */

function readTextSafe(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 剥除块注释与行注释（保守：字符串里的 // 可能被一并剥掉 → 最多漏判）。 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1')
}

const RE_EXPORT_LIST = /export\s*\{([^}]*)\}/g
const RE_EXPORT_DECL = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
const RE_EXPORT_STAR_AS = /export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s*from/g
const RE_NAMED_FROM = /(?:^|[^\w$.])(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g

/**
 * 客户端 bundle 里对 primitives 的成员访问。
 *
 * 打平后的 client bundle 有两种形态：
 *   1. `_deepseek_ai_dsh_client_ui_primitives.IconX16`
 *      —— 打包器给 `import * as … from '@deepseek-ai/dsh-client-ui-primitives'` 生成的默认名；
 *   2. `<alias>.IconX16` —— 作者手写时的短别名（如 `P`）。
 *
 * 形态 2 的别名**必须从同一文件里的 import 语句动态提取**，不能用固定别名表：
 * 否则 `primitives.X` / `prims.X` 这种猜测既可能漏掉真实别名，
 * 又可能把别的对象同名属性误当成 primitives 符号（误报会让门禁噪音化）。
 */
const PRIMITIVES_LONG_RE = /(?:^|[^\w$])_deepseek_ai_dsh_client_ui_primitives\.([A-Za-z_$][\w$]*)/g
/** 捕获 `import * as P from '<...>/dsh-client-ui-primitives'` 的别名。 */
const RE_PRIM_NAMESPACE_IMPORT = /import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]*dsh-client-ui-primitives['"]/g
/** 捕获 `const P = require('…/dsh-client-ui-primitives')` 的别名。 */
const RE_PRIM_REQUIRE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"][^'"]*dsh-client-ui-primitives['"]\s*\)/g

/** 从源码文本收集导出名（包目录内所有文件求并集 = 真实导出的超集）。 */
export function collectExportNames(text, into = new Set()) {
  for (const m of text.matchAll(RE_EXPORT_LIST)) {
    for (const piece of m[1].split(',')) {
      const raw = piece.trim().replace(/^type\s+/, '')
      if (!raw) continue
      const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(raw)
      into.add(as ? as[1] : raw)
    }
  }
  for (const m of text.matchAll(RE_EXPORT_DECL)) into.add(m[1])
  for (const m of text.matchAll(RE_EXPORT_STAR_AS)) into.add(m[1])
  if (/\bexport\s+default\b/.test(text)) into.add('default')
  return into
}

/** 递归收集目录下的源码文件（不跟随符号链接，避免目录闭环）。 */
function walkFiles(root, out = []) {
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkFiles(full, out)
    } else if (entry.isFile() && CODE_EXT.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** 解析「具名 from」语句里被引用的符号：`a` / `a as b` 都要求被导入方导出 `a`。 */
function symbolOf(piece) {
  const raw = piece.trim().replace(/^type\s+/, '')
  if (!raw) return ''
  const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(raw)
  const symbol = (as ? raw.slice(0, raw.length - as[0].length) : raw).trim()
  return /^[A-Za-z_$][\w$]*$/.test(symbol) ? symbol : ''
}

/** 解析指定内核包的导出集合。 */
export function collectKernelExports(kernelRoot, packageNames) {
  const result = new Map()
  for (const pkg of packageNames) {
    const dir = path.join(kernelRoot, pkg)
    const dirExists = fs.existsSync(dir)
    const pkgJson = readJsonSafe(path.join(dir, 'package.json'))
    const names = new Set()
    let hasEsmSyntax = false
    if (dirExists) {
      for (const file of walkFiles(dir)) {
        const text = stripComments(readTextSafe(file))
        if (/(?:^|\n)\s*(?:import|export)\s/m.test(text) || /\bexport\s*[[{*]/.test(text)) hasEsmSyntax = true
        collectExportNames(text, names)
      }
    }
    const isEsm = pkgJson?.type === 'module' || hasEsmSyntax
    let reason = ''
    if (!dirExists) reason = 'missing'
    else if (!isEsm) reason = 'cjs'
    else if (names.size === 0) reason = 'no-static-exports'
    result.set(pkg, {
      dir,
      exists: dirExists,
      exports: names,
      skipped: dirExists && reason !== '' && reason !== 'missing',
      reason,
    })
  }
  return result
}

/* ------------------------------------------------------------------ *
 * tgz 展开与源码扫描
 * ------------------------------------------------------------------ */

/** 把一个 tgz 解到临时目录（相对路径 + cwd，避免 GNU tar 把 "D:" 当远程主机）。 */
function extractTgz(tgzFile, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const file = path.basename(tgzFile)
  // 单个 tgz 可能含大量文件，用系统 tar 一次展开比逐条 -xO 快得多。
  execFileSync('tar', ['-xzf', file, '-C', dest], { cwd: path.dirname(tgzFile), stdio: ['ignore', 'pipe', 'pipe'] })
  const pkgDir = path.join(dest, 'package')
  return fs.existsSync(pkgDir) ? pkgDir : dest
}

/**
 * 判定某个文件是否属于「浏览器侧」，不进 Node ESM 链接期。
 * 与 Desktop 门禁同规则：package.json exports["./client"] 指向的入口，
 * 以及 client/ 目录、*.client.js、独立命名的 client.js。
 *
 * 注意 `*.client.js`（如 window.client.js）与 `client.js` 是两种不同拼写，
 * 早期版本只匹配后者，会让形如 `foo.client.js` 的前端 bundle 被当成服务端
 * 源码误报 —— 由 suite/test/kernel-compat.test.mjs 钉死。
 */
export function makeClientSideExcluder(pluginDir, pkgJson) {
  const dirs = new Set()
  const files = new Set()
  const toPosix = (p) => p.replace(/\\/g, '/')
  const clientExport = pkgJson && pkgJson.exports && pkgJson.exports['./client']
  const spec = typeof clientExport === 'string'
    ? clientExport
    : (clientExport && (clientExport.default || clientExport.import || clientExport.require))
  if (typeof spec === 'string' && spec) {
    const abs = toPosix(path.join(pluginDir, spec))
    files.add(abs)
    const dir = abs.slice(0, abs.lastIndexOf('/'))
    if (dir && dir !== toPosix(pluginDir)) dirs.add(dir + '/')
  }
  return (file) => {
    const p = toPosix(file)
    if (files.has(p)) return true
    for (const d of dirs) if (p.startsWith(d)) return true
    if (p.includes('/client/')) return true
    // `client.js` / `client.cjs` / `client.mjs`（独占文件名）
    // 以及任意 `*.client.js`（如 `window.client.js`）
    return /(^|\/)client\.(?:c|m)?js$/i.test(p) || /\.client\.(?:c|m)?js$/i.test(p)
  }
}

/** 扫一个已展开插件目录的内核符号引用。
 *
 * 两类引用都要扫：
 *   1. **服务端具名导入**：`import { A, B } from '@deepseek-ai/x'` —— 缺失会在 ESM
 *      链接期抛 SyntaxError。
 *   2. **客户端成员访问**：浏览器侧 bundle 常写成 `_deepseek_ai_dsh_client_ui_primitives.X`
 *      或 `P.X`。这类**不在链接期检查**，但运行时拿到 `undefined` 后 `jsx(undefined)`
 *      就是 React #130 —— 整个 slot 渲染成空 div，无任何报错文案。
 *
 * 第 2 类此前被整体跳过（「不经 Node ESM 链接期」），实测是错的：
 * better-sidebar / session-manager / prompt-optimizer 三个插件都因此静默缺一块 UI，
 * 其中一个修了三轮才定位到。见 patches/README.md 的图标命名一节。
 */
export function scanPluginImports(pluginDir) {
  const pkgJson = readJsonSafe(path.join(pluginDir, 'package.json'))
  const isClientSide = makeClientSideExcluder(pluginDir, pkgJson)
  const refs = []
  let fileCount = 0
  let clientFileCount = 0
  for (const file of walkFiles(pluginDir)) {
    const clientSide = isClientSide(file)
    if (clientSide) clientFileCount += 1
    else fileCount += 1
    const raw = readTextSafe(file)
    const text = stripComments(raw)

    // (1) 服务端具名导入
    if (!clientSide && text.includes(KERNEL_SCOPE)) {
      for (const m of text.matchAll(RE_NAMED_FROM)) {
        const spec = m[2]
        if (!spec.startsWith(KERNEL_SCOPE)) continue
        const pkg = spec.slice(KERNEL_SCOPE.length).split('/')[0]
        for (const piece of m[1].split(',')) {
          const symbol = symbolOf(piece)
          if (!symbol) continue
          refs.push({ file: path.relative(pluginDir, file), spec, pkg, symbol })
        }
      }
    }

    // (2) 客户端对 primitives 的成员访问
    if (clientSide) {
      const seen = new Set()
      // 形态 1：打包器默认名
      for (const m of text.matchAll(PRIMITIVES_LONG_RE)) seen.add(m[1])
      // 形态 2：本文件里 `import * as P from '…/primitives'` 或 require 的别名
      const aliases = new Set()
      for (const m of text.matchAll(RE_PRIM_NAMESPACE_IMPORT)) aliases.add(m[1])
      for (const m of text.matchAll(RE_PRIM_REQUIRE)) aliases.add(m[1])
      for (const alias of aliases) {
        const re = new RegExp(`(?:^|[^\\w$.])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.([A-Za-z_$][\\w$]*)`, 'g')
        for (const m of text.matchAll(re)) seen.add(m[1])
      }
      for (const symbol of seen) {
        refs.push({
          file: path.relative(pluginDir, file),
          spec: `${KERNEL_SCOPE}dsh-client-ui-primitives`,
          pkg: 'dsh-client-ui-primitives',
          symbol,
          kind: 'member-access',
        })
      }
    }
  }
  return { refs, pkgJson, fileCount, clientFileCount }
}

/* ------------------------------------------------------------------ *
 * 门禁主体
 * ------------------------------------------------------------------ */

export function checkKernelCompat(opts = {}) {
  const kernelRoot = opts.kernelRoot
  const dist = opts.dist || DIST
  const allowlist = opts.allowlist || DEFAULT_ALLOWLIST

  const kernelExists = Boolean(kernelRoot) && fs.existsSync(kernelRoot)
  const indexPath = path.join(dist, 'index.json')
  const distExists = fs.existsSync(indexPath)

  const hits = []
  const skipped = []
  const stats = { packageCount: 0, fileCount: 0, clientFileCount: 0, refCount: 0, referencedPackages: 0, checkedPackages: 0 }
  if (!kernelExists || !distExists) {
    return { ok: false, kernelRoot, dist, kernelExists, distExists, hits, skipped, stats }
  }

  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  stats.packageCount = index.length

  // 一次解包一个 tgz，扫完即删，峰值磁盘占用与单个包等大。
  const scratchRoot = fs.mkdtempSync(path.join(path.dirname(dist), '.kernel-compat-'))
  const allRefs = []
  try {
    for (const entry of index) {
      const tgz = path.join(dist, entry.file)
      if (!fs.existsSync(tgz)) {
        skipped.push({ plugin: entry.name, reason: 'tgz-missing' })
        continue
      }
      const dest = path.join(scratchRoot, entry.name.replace(/[/@]/g, '_'))
      let pluginDir
      try {
        pluginDir = extractTgz(tgz, dest)
      } catch (err) {
        skipped.push({ plugin: entry.name, reason: `tar-failed: ${err.message.split('\n')[0]}` })
        continue
      }
      const scan = scanPluginImports(pluginDir)
      stats.fileCount += scan.fileCount
      stats.clientFileCount += scan.clientFileCount
      for (const ref of scan.refs) allRefs.push({ plugin: entry.name, version: entry.version, ...ref })
      fs.rmSync(dest, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  }

  stats.refCount = allRefs.length
  const packages = [...new Set(allRefs.map((r) => r.pkg))].sort()
  stats.referencedPackages = packages.length
  const kernel = collectKernelExports(kernelRoot, packages)
  for (const [pkg, info] of kernel) {
    if (info.skipped) skipped.push({ plugin: null, reason: `${pkg}: ${info.reason}` })
    else stats.checkedPackages += 1
  }

  const allowSet = new Set(allowlist.map((a) => `${a.plugin}\u0000${a.symbol}\u0000${a.spec}`))
  const waived = []
  for (const ref of allRefs) {
    const info = kernel.get(ref.pkg)
    if (!info) continue
    let hit = null
    if (!info.exists) hit = { ...ref, type: 'missing-package', available: [] }
    else if (info.skipped) continue
    else if (!info.exports.has(ref.symbol)) hit = { ...ref, type: 'missing-export', available: [...info.exports].sort().slice(0, 12) }
    if (!hit) continue
    const key = `${hit.plugin}\u0000${hit.symbol}\u0000${hit.spec}`
    if (allowSet.has(key)) { waived.push(hit); continue }
    hits.push(hit)
  }

  return { ok: hits.length === 0, kernelRoot, dist, kernelExists, distExists, hits, waived, skipped, stats }
}

export function formatReport(result) {
  const lines = ['[kernel-compat] Pack 产物 ↔ 内核导出兼容校验']
  if (!result.kernelExists) {
    lines.push(`  ✗ 内核目录不存在: ${result.kernelRoot ?? '(未指定)'}`)
    lines.push('    用 --kernel <dsh-desktop/node_modules/@deepseek-ai> 指定，或先装 Desktop 依赖。')
    return lines.join('\n')
  }
  if (!result.distExists) {
    lines.push(`  ✗ dist/index.json 不存在: ${result.dist}`)
    lines.push('    先跑 scripts/repack/repack.mjs 生成产物。')
    return lines.join('\n')
  }
  const s = result.stats
  lines.push(`  产物 ${s.packageCount} 个 / 服务端源码 ${s.fileCount} 个文件 / 具名导入 ${s.refCount} 处`)
  if (s.clientFileCount) {
    lines.push(`  客户端（浏览器侧）bundle ${s.clientFileCount} 个文件 —— 查 primitives 成员访问（运行时 undefined → React #130）`)
  }
  lines.push(`  引用内核包 ${s.referencedPackages} 个（已静态解析导出 ${s.checkedPackages} 个）`)
  if (result.waived?.length) lines.push(`  已豁免（allowlist）${result.waived.length} 处`)
  if (result.ok) {
    lines.push('  ✓ 通过：未发现「导入内核不存在的导出」。')
    return lines.join('\n')
  }
  lines.push(`  ✗ 命中 ${result.hits.length} 处不兼容 —— ESM 链接期即失败，会拖垮整棵插件树：`)
  for (const h of result.hits) {
    const what = h.type === 'missing-package'
      ? `内核中不存在包 ${h.spec}`
      : `内核 ${h.spec} 不导出 "${h.symbol}"（现有示例：${h.available.join(', ')}）`
    lines.push(`    · ${h.plugin}@${h.version}  ${h.file}`)
    lines.push(`        import { ${h.symbol} } from '${h.spec}'  →  ${what}`)
  }
  lines.push('    修复方向：升到适配当前内核的上游版本，或在本仓 patches/ 下加 source patch')
  lines.push('    （见 patches/README.md）；确认无法修复时才能进 DEFAULT_ALLOWLIST，并写明原因。')
  return lines.join('\n')
}

function readArg(argv, name) {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : undefined
}

/** 猜默认内核目录：Desktop 与 Pack 常并排检出。 */
export function guessKernelRoot() {
  const candidates = [
    process.env.DSH_KERNEL_ROOT,
    path.join(ROOT, '..', 'EAC-Desktop', 'dsh-desktop', 'node_modules', '@deepseek-ai'),
    path.join(ROOT, 'node_modules', '@deepseek-ai'),
  ].filter(Boolean)
  return candidates.find((c) => fs.existsSync(c))
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--allowlist')) {
    console.log(JSON.stringify(DEFAULT_ALLOWLIST, null, 2))
    return 0
  }
  const json = argv.includes('--json')
  const result = checkKernelCompat({ kernelRoot: readArg(argv, '--kernel') || guessKernelRoot() })
  if (json) {
    process.stdout.write(JSON.stringify(result, (_k, v) => (v instanceof Set ? [...v] : v), 2) + '\n')
  } else if (result.ok) {
    console.log(formatReport(result))
  } else {
    console.error(formatReport(result))
  }
  if (!result.kernelExists) return 2
  return result.ok ? 0 : 1
}

// 直接执行时跑门禁；被 test/verify import 时不执行（那些方只拿导出函数）。
const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
if (invokedDirectly) process.exitCode = main()
