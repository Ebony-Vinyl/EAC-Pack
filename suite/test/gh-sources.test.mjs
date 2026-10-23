/**
 * GH_SOURCES / GH_TGZ_SOURCES 与 catalog 的一致性回归。
 *
 * 为什么需要
 * ----------
 * `repack.mjs` 里这两张映射表是「catalog 说用什么源」与「实际怎么取」之间的唯一
 * 连接点，但它们是**硬编码**的：catalog 写 `source: github` 而映射表没有该包，
 * 构建会 die；反过来映射表有包但 catalog 改了版本，产物会静默漂移。
 *
 * 真实踩过两次：
 *   1. `dsh-our-free-model` 在 catalog 记 `source=github-repo`，但 GH_SOURCES 无
 *      该包映射 —— 全量 repack 走到它必 die。这个洞长期存在且无人发现，因为
 *      平时都按 --only 局部重建。
 *   2. `@nagi-ovo/dsh-visualize` 的 catalog 要 0.1.4，而 .cache 里的克隆是
 *      0.1.7 —— 产物取决于本机缓存的运气。为此给 GH_SOURCES 加了可选 `ref`，
 *      钉住 commit/tag。本文件同时钉住「谁已经钉了、谁还没钉」。
 *
 * 这些测试是纯静态的（读源码 + catalog），不需要 dist/。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const asArray = (d) => (Array.isArray(d) ? d : (d.plugins ?? d.items ?? []))

const REPACK_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'repack', 'repack.mjs'), 'utf8')

/** 从 repack.mjs 抽出一张 `const NAME = { ... }` 映射表的键。 */
function extractMapKeys(constName) {
  const start = REPACK_SRC.indexOf(`const ${constName} = {`)
  assert.ok(start !== -1, `找不到 ${constName} 定义`)
  // 从 { 起按括号配平找到表尾（字符串里的括号极少，够用）
  let depth = 0
  let i = REPACK_SRC.indexOf('{', start)
  const begin = i
  for (; i < REPACK_SRC.length; i++) {
    if (REPACK_SRC[i] === '{') depth++
    else if (REPACK_SRC[i] === '}') { depth--; if (depth === 0) break }
  }
  const body = REPACK_SRC.slice(begin, i + 1)
  const keys = new Set()
  // 键形态：'quoted-name': { 或 plainName: {
  for (const m of body.matchAll(/(?:^|[{\s,])(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*\{/g)) {
    const key = m[1] ?? m[2] ?? m[3]
    if (key && key !== 'url' && key !== 'dir' && key !== 'ref') keys.add(key)
  }
  return keys
}

const ghSources = extractMapKeys('GH_SOURCES')
const ghTgzSources = extractMapKeys('GH_TGZ_SOURCES')

const catalog = ['eac', 'aio', 'skins', 'community']
  .flatMap((p) => (fs.existsSync(path.join(ROOT, 'catalog', `${p}.json`)) ? asArray(readJson(path.join(ROOT, 'catalog', `${p}.json`))) : []))

test('每张源映射表的包名都能在 catalog 里找到（防孤儿映射）', () => {
  const names = new Set(catalog.map((e) => e.name))
  for (const [label, keys] of [['GH_SOURCES', ghSources], ['GH_TGZ_SOURCES', ghTgzSources]]) {
    for (const key of keys) {
      assert.ok(names.has(key), `${label} 里的 ${key} 不在任何 catalog 中（孤儿映射）`)
    }
  }
})

/**
 * 已知豁免：catalog 声明了 git 源、但 repack.mjs 里没有对应映射的包。
 *
 * 加条目必须写明为什么现在不能修 + 跟踪去向。空表表示「一个都不许漏」。
 */
const KNOWN_MISSING_SOURCE_MAP = {
  // 此前豁免的 dsh-our-free-model 已随 catalog 升版到 2.5.6 并补上
  // GH_TGZ_SOURCES 映射（source=github-tgz），问题已解决，豁免随之移除。
}

test('catalog 声明 github / github-repo / github-tgz 的包都有对应映射（防构建期 die）', () => {
  const problems = []
  for (const entry of catalog) {
    if (entry.source === 'github' || entry.source === 'github-repo') {
      if (!ghSources.has(entry.name)) problems.push(`${entry.name} (source=${entry.source}) 缺 GH_SOURCES`)
    }
    if (entry.source === 'github-tgz') {
      if (!ghTgzSources.has(entry.name)) problems.push(`${entry.name} (source=github-tgz) 缺 GH_TGZ_SOURCES`)
    }
  }
  const unexpected = problems.filter((p) => !Object.keys(KNOWN_MISSING_SOURCE_MAP).some((n) => p.startsWith(n)))
  assert.deepEqual(unexpected, [],
    `以下包在 catalog 声明了 git 源但 repack 无映射，构建会 die：\n  ${unexpected.join('\n  ')}`)
})

test('已知豁免表里的条目仍然是真问题（修好后必须删掉豁免）', () => {
  // 防止豁免表变成永久垃圾桶：如果某个包已经补上了映射，这里会失败并提醒删除豁免。
  for (const [name, reason] of Object.entries(KNOWN_MISSING_SOURCE_MAP)) {
    const entry = catalog.find((e) => e.name === name)
    assert.ok(entry, `${name} 已不在 catalog 中，请删除 KNOWN_MISSING_SOURCE_MAP 条目`)
    const hasMap = ghSources.has(name) || ghTgzSources.has(name)
    assert.equal(hasMap, false,
      `${name} 已经补上了源映射（${reason} 的问题已解决）—— 请从 KNOWN_MISSING_SOURCE_MAP 删除该条目`)
  }
})

test('已钉 ref 的 github 源必须是完整 40 位 commit SHA 或 tag（防漂移）', () => {
  // 逐个条目取 ref 值
  const start = REPACK_SRC.indexOf('const GH_SOURCES = {')
  let depth = 0
  let i = REPACK_SRC.indexOf('{', start)
  const begin = i
  for (; i < REPACK_SRC.length; i++) {
    if (REPACK_SRC[i] === '{') depth++
    else if (REPACK_SRC[i] === '}') { depth--; if (depth === 0) break }
  }
  const body = REPACK_SRC.slice(begin, i + 1)
  const refs = [...body.matchAll(/ref:\s*'([^']+)'/g)].map((m) => m[1])
  for (const ref of refs) {
    // 允许 40 位 SHA 或 vX.Y.Z 形态 tag
    assert.ok(/^[0-9a-f]{40}$/.test(ref) || /^v?\d+\.\d+\.\d+/.test(ref),
      `ref "${ref}" 不是完整 commit SHA 也不是 tag —— 短 SHA 或分支名都会漂移`)
  }
})

test('picturereader 钉在 3.5.0 的 commit，且 catalog 版本一致', () => {
  const entry = catalog.find((e) => e.name === 'picturereader')
  assert.ok(entry, 'catalog 缺 picturereader')
  assert.equal(entry.version, '3.5.0')
  assert.ok(['github', 'github-repo'].includes(entry.source),
    `picturereader 3.5.0 无 npm 发布，必须走 git 源，实际 ${entry.source}`)
  // 3.5.0 的钉点（上游 main 唯一全适配 0.2.x 的版本）
  assert.match(REPACK_SRC, /picturereader:\s*\{[\s\S]{0,400}?ref:\s*'ebbb2f098ecf3fe18a47eaaa361ae157d31272cc'/,
    'picturereader 必须钉 ref=ebbb2f098ecf3fe18a47eaaa361ae157d31272cc（3.5.0）')
})

test('picturereader 3.5.0 的 catalog spec 遵循 github 源惯例', () => {
  // docs/DISTRIBUTION.md 规定：source=github 的 spec 必须是 `git+https://…`，
  // 而 source=github-repo / github-tgz 才是 `file:dist/<tgz>`。picturereader 走
  // github（要钉 ref），所以 spec 也必须是 git+https，并在 fragment 里带上同一个
  // commit —— 否则 catalog 记的和 repack 实际克隆的可能不是同一个东西。
  const entry = catalog.find((e) => e.name === 'picturereader')
  assert.equal(entry.source, 'github')
  assert.match(entry.spec, /^git\+https:\/\/github\.com\/jing-hy\/picturereader\.git(#.+)?$/,
    `source=github 的 spec 应为 git+https://…，实际 ${entry.spec}`)
  assert.match(entry.spec, /#ebbb2f098ecf3fe18a47eaaa361ae157d31272cc$/,
    `spec 的 fragment 应与 GH_SOURCES 的 ref 一致，实际 ${entry.spec}`)
})

/**
 * 既有的 source/spec 形态不一致（不是本 PR 引入的）。
 *
 * 背景：docs/DISTRIBUTION.md 规定 source=npm 的 spec 为 `name@version`，但实测有
 * 11 个条目写成 `file:dist/<tgz>`。它们是历史上把「npm 取源」与「本地重打包产物」
 * 混用留下的，运行期无害：suite/index.js 的 resolvePluginSource 先按 distIndex 命中
 * file，spec 只是找不到时的回退值。
 *
 * 这里显式列出而不是放宽断言，是为了让「新条目写错」立刻变红（新条目不会自动进这
 * 张表），同时不把历史债混进本次改动的判定。
 */
const KNOWN_SPEC_DRIFT = new Set([
  'dsh-session-manager',
  'dsh-plugin-wallpaper-engine',
  '@linxin666/dsh-client-ui-skin-blue-fantasy',
  '@linxin666/dsh-client-ui-skin-dragon-heir',
  '@linxin666/dsh-client-ui-skin-miku',
  '@linxin666/dsh-client-ui-skin-minecraft',
  '@linxin666/dsh-client-ui-skin-qq98',
  '@linxin666/dsh-client-ui-skin-ths',
  '@linxin666/dsh-client-ui-skin-trading',
  '@linxin666/dsh-client-ui-skin-whale-song',
  '@linxin666/dsh-client-ui-skin-xp',
])

test('每条 catalog 的 spec 形态与其 source 匹配（防字段错配）', () => {
  const problems = []
  for (const entry of catalog) {
    if (KNOWN_SPEC_DRIFT.has(entry.name)) continue
    const spec = String(entry.spec ?? '')
    if (entry.source === 'github') {
      if (!spec.startsWith('git+')) problems.push(`${entry.name}: source=github 但 spec=${spec}`)
    } else if (entry.source === 'npm') {
      if (!spec.startsWith(`${entry.name}@`)) problems.push(`${entry.name}: source=npm 但 spec=${spec}`)
    } else if (entry.source === 'github-tgz' || entry.source === 'eac-tag') {
      if (!spec.startsWith('file:dist/')) problems.push(`${entry.name}: source=${entry.source} 但 spec=${spec}`)
    }
  }
  assert.deepEqual(problems, [], `source/spec 形态不符：\n  ${problems.join('\n  ')}`)
})

test('已知 spec 漂移表不会无意义地膨胀（条目必须仍在 catalog 且仍真的不一致）', () => {
  for (const name of KNOWN_SPEC_DRIFT) {
    const entry = catalog.find((e) => e.name === name)
    assert.ok(entry, `${name} 已不在 catalog（或已退役）—— 请从 KNOWN_SPEC_DRIFT 删除`)
    const spec = String(entry.spec ?? '')
    const consistent = entry.source === 'npm' ? spec.startsWith(`${entry.name}@`) : true
    assert.equal(consistent, false,
      `${name} 的 spec 已修正为 name@version —— 请从 KNOWN_SPEC_DRIFT 删除该条目`)
  }
})

test('两个 catalog 副本对同一包给出一致的 version/source/spec', () => {
  const mainCat = asArray(readJson(path.join(ROOT, 'catalog', 'eac.json')))
  const suiteCat = asArray(readJson(path.join(ROOT, 'suite', 'catalog', 'eac.json')))
  const byName = new Map(suiteCat.map((e) => [e.name, e]))
  for (const entry of mainCat) {
    const mirror = byName.get(entry.name)
    if (!mirror) continue
    assert.equal(mirror.version, entry.version, `${entry.name}: suite/catalog 版本与 catalog 不一致`)
    assert.equal(mirror.source, entry.source, `${entry.name}: suite/catalog source 不一致`)
    assert.equal(mirror.spec, entry.spec, `${entry.name}: suite/catalog spec 不一致`)
  }
})
