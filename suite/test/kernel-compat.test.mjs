/**
 * kernel-compat 门禁自测。
 *
 * 门禁本身必须被测试，否则它会以两种方式失效而无人在意：
 *   · 漏判（假阴性）—— 看起来绿的 CI 放行了坏包，正是本门禁要防的事故；
 *   · 误判（假阳性）—— 长期变红后被整体忽略。
 *
 * 这里用夹具 tgz 驱动真实的 collectKernelExports / scanPluginImports /
 * checkKernelCompat，断言两个方向都对。
 */
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

import {
  collectExportNames,
  collectKernelExports,
  makeClientSideExcluder,
  scanPluginImports,
  stripComments,
  checkKernelCompat,
} from '../../scripts/repack/kernel-compat.mjs'

/* ------------------------------------------------------------------ *
 * 夹具工具
 * ------------------------------------------------------------------ */

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kc-${tag}-`))
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** 造一个假内核包（ESM，含给定导出）。 */
function fakeKernelPkg(kernelRoot, pkg, exportSource) {
  const dir = path.join(kernelRoot, pkg)
  write(path.join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${pkg}`, version: '1.0.0', type: 'module' }))
  write(path.join(dir, 'lib', 'index.js'), exportSource)
}

/** 造一个插件 tgz（npm pack 形态：顶层 package/）。 */
function fakePluginTgz(distDir, name, version, files) {
  const stage = tmpdir('stage')
  const pkgDir = path.join(stage, 'package')
  for (const [rel, text] of Object.entries(files)) write(path.join(pkgDir, rel), text)
  write(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version, type: 'module' }))
  fs.mkdirSync(distDir, { recursive: true })
  const file = `${name.replace(/[/@]/g, '_')}-${version}.tgz`
  execFileSync('tar', ['-czf', path.join(distDir, file), '-C', stage, 'package'])
  fs.rmSync(stage, { recursive: true, force: true })
  return file
}

const exportOf = (src) => [...collectExportNames(stripComments(src))].sort()

/* ------------------------------------------------------------------ *
 * 单元：导出解析
 * ------------------------------------------------------------------ */

test('collectExportNames 覆盖四种导出写法', () => {
  const names = exportOf(`
    export const a = 1
    export function b() {}
    export class C {}
    export { d, e as f }
    export * as g from './x.js'
    export default {}
  `)
  assert.deepEqual(names, ['C', 'a', 'b', 'd', 'default', 'f', 'g'])
})

test('剥除注释后，注释里的示例 import 不参与判定', () => {
  const text = stripComments(`
    // import { gone } from '@deepseek-ai/x'
    /* import { alsoGone } from '@deepseek-ai/y' */
    export const real = 1
  `)
  assert.ok(!text.includes('gone'), '注释未被剥除')
  assert.deepEqual(exportOf(text), ['real'])
})

test('collectKernelExports 对 ESM 包解析出真实导出', () => {
  const kernel = tmpdir('kernel')
  fakeKernelPkg(kernel, 'dsh-settings', 'export const SettingsForms = class {}\nexport const redactSecrets = () => {}')
  const got = collectKernelExports(kernel, ['dsh-settings'])
  const info = got.get('dsh-settings')
  assert.equal(info.exists, true)
  assert.equal(info.skipped, false)
  assert.deepEqual([...info.exports].sort(), ['SettingsForms', 'redactSecrets'])
})

test('collectKernelExports 对缺失包 / CJS 包分别标记', () => {
  const kernel = tmpdir('kernel')
  fakeKernelPkg(kernel, 'esm-ok', 'export const x = 1')
  // CJS 包：无 ESM 语法、type 非 module
  write(path.join(kernel, 'cjs-pkg', 'package.json'), JSON.stringify({ name: 'cjs-pkg', version: '1.0.0' }))
  write(path.join(kernel, 'cjs-pkg', 'index.js'), 'module.exports = { y: 1 }')
  const got = collectKernelExports(kernel, ['esm-ok', 'cjs-pkg', 'nope'])
  assert.equal(got.get('cjs-pkg').skipped, true)
  assert.equal(got.get('cjs-pkg').reason, 'cjs')
  assert.equal(got.get('nope').exists, false)
  assert.equal(got.get('nope').reason, 'missing')
})

/* ------------------------------------------------------------------ *
 * 单元：客户端侧排除（这是最容易误判的边界）
 * ------------------------------------------------------------------ */

test('exports["./client"] 指向的文件被排除，服务端入口不被排除', () => {
  const dir = tmpdir('plug')
  const pkgJson = { exports: { './client': './client.js', '.': './src/index.js' } }
  const isClient = makeClientSideExcluder(dir, pkgJson)
  assert.equal(isClient(path.join(dir, 'client.js')), true, 'client 入口必须排除')
  assert.equal(isClient(path.join(dir, 'src', 'index.js')), false, '服务端入口不得排除')
})

test('client/ 子目录与 *.client.js 一律排除', () => {
  const dir = tmpdir('plug')
  const isClient = makeClientSideExcluder(dir, {})
  assert.equal(isClient(path.join(dir, 'lib', 'client', 'bundle.js')), true)
  assert.equal(isClient(path.join(dir, 'lib', 'foo.client.js')), true)
  assert.equal(isClient(path.join(dir, 'lib', 'index.js')), false)
})

test('插件根目录的 client.js 只排除该文件，不排除同目录服务端文件', () => {
  const dir = tmpdir('plug')
  const pkgJson = { exports: { './client': './client.js' } }
  const isClient = makeClientSideExcluder(dir, pkgJson)
  assert.equal(isClient(path.join(dir, 'client.js')), true)
  assert.equal(isClient(path.join(dir, 'index.js')), false, '根目录其它文件不得被连带排除')
})

/* ------------------------------------------------------------------ *
 * 单元：扫描
 * ------------------------------------------------------------------ */

test('scanPluginImports 只收集服务端侧的内核具名导入', () => {
  const dir = tmpdir('scan')
  write(path.join(dir, 'package.json'), JSON.stringify({ exports: { './client': './client.js' } }))
  write(path.join(dir, 'src', 'index.js'),
    "import { a } from '@deepseek-ai/dsh-settings'\nimport fs from 'node:fs'\n")
  // 客户端侧写错不应计数
  write(path.join(dir, 'client.js'),
    "import { alsoWrong } from '@deepseek-ai/dsh-settings'\n")
  const scan = scanPluginImports(dir)
  assert.equal(scan.refs.length, 1, `应只有 1 处服务端引用，实际 ${JSON.stringify(scan.refs)}`)
  assert.equal(scan.refs[0].symbol, 'a')
  assert.equal(scan.refs[0].pkg, 'dsh-settings')
  assert.equal(scan.clientFileCount, 1)
})

test('scanPluginImports 支持重导出与别名（取左侧原名）', () => {
  const dir = tmpdir('scan2')
  write(path.join(dir, 'package.json'), JSON.stringify({}))
  write(path.join(dir, 'index.js'),
    "export { gone } from '@deepseek-ai/dsh-settings'\nimport { real as alias } from '@deepseek-ai/dsh-settings'\n")
  const scan = scanPluginImports(dir)
  assert.deepEqual(scan.refs.map((r) => r.symbol).sort(), ['gone', 'real'])
})

/* ------------------------------------------------------------------ *
 * 集成：checkKernelCompat
 * ------------------------------------------------------------------ */

function fixture({ pluginFiles, kernelSource }) {
  const root = tmpdir('int')
  const dist = path.join(root, 'dist')
  const kernel = path.join(root, 'kernel')
  fs.mkdirSync(dist, { recursive: true })
  fs.mkdirSync(kernel, { recursive: true })
  fakeKernelPkg(kernel, 'dsh-settings', kernelSource)
  const file = fakePluginTgz(dist, 'demo-plugin', '1.0.0', pluginFiles)
  fs.writeFileSync(path.join(dist, 'index.json'), JSON.stringify([{ name: 'demo-plugin', version: '1.0.0', file }]))
  return { root, dist, kernel }
}

test('集成：导入内核不存在的导出 → 门禁失败（假阴性防线）', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const SettingsForms = class {}',
    pluginFiles: { 'src/index.js': "import { settingsNamespace } from '@deepseek-ai/dsh-settings'\nexport const ok = 1\n" },
  })
  const r = checkKernelCompat({ kernelRoot: kernel, dist })
  assert.equal(r.ok, false, '必须判为失败')
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].type, 'missing-export')
  assert.equal(r.hits[0].symbol, 'settingsNamespace')
  assert.equal(r.hits[0].plugin, 'demo-plugin')
})

test('集成：导入内核真实存在的导出 → 门禁通过（假阳性防线）', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const SettingsForms = class {}',
    pluginFiles: { 'src/index.js': "import { SettingsForms } from '@deepseek-ai/dsh-settings'\nexport const ok = 1\n" },
  })
  const r = checkKernelCompat({ kernelRoot: kernel, dist })
  assert.equal(r.ok, true, `不应有命中: ${JSON.stringify(r.hits)}`)
  assert.equal(r.hits.length, 0)
})

test('集成：客户端侧写错不判失败（避免把前端问题当链接期故障）', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const SettingsForms = class {}',
    pluginFiles: {
      'package.json.placeholder': '',
      'src/index.js': 'export const ok = 1\n',
      'client.js': "import { settingsNamespace } from '@deepseek-ai/dsh-settings'\n",
    },
  })
  // 让 exports["./client"] 指向 client.js
  const r = checkKernelCompat({ kernelRoot: kernel, dist })
  assert.equal(r.ok, true, `客户端侧不应命中: ${JSON.stringify(r.hits)}`)
})

test('集成：引用不存在的内核包 → 单独归类为 missing-package', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const x = 1',
    pluginFiles: { 'src/index.js': "import { y } from '@deepseek-ai/dsh-nonexistent'\nexport const ok = 1\n" },
  })
  const r = checkKernelCompat({ kernelRoot: kernel, dist })
  assert.equal(r.ok, false)
  assert.equal(r.hits[0].type, 'missing-package')
})

test('集成：allowlist 能豁免指定命中，其余仍报错', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const SettingsForms = class {}',
    pluginFiles: {
      'src/index.js':
        "import { settingsNamespace } from '@deepseek-ai/dsh-settings'\n" +
        "import { installSettingsSection } from '@deepseek-ai/dsh-settings'\n" +
        'export const ok = 1\n',
    },
  })
  const r = checkKernelCompat({
    kernelRoot: kernel,
    dist,
    allowlist: [{ plugin: 'demo-plugin', symbol: 'settingsNamespace', spec: '@deepseek-ai/dsh-settings' }],
  })
  assert.equal(r.ok, false, '未豁免的那条仍应失败')
  assert.equal(r.hits.length, 1)
  assert.equal(r.hits[0].symbol, 'installSettingsSection')
  assert.equal(r.waived.length, 1)
  assert.equal(r.waived[0].symbol, 'settingsNamespace')
})

test('集成：内核目录缺失时给出明确错误而不是静默通过', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const x = 1',
    pluginFiles: { 'src/index.js': 'export const ok = 1\n' },
  })
  const r = checkKernelCompat({ kernelRoot: path.join(kernel, 'does-not-exist'), dist })
  assert.equal(r.kernelExists, false)
  assert.equal(r.ok, false, '内核缺失绝不能判通过')
})

test('集成：tgz 内多文件多导入全部被覆盖', () => {
  const { dist, kernel } = fixture({
    kernelSource: 'export const onlyThis = 1',
    pluginFiles: {
      'src/index.js': "import { onlyThis } from '@deepseek-ai/dsh-settings'\n",
      'lib/deep/a.js': "import { missingA } from '@deepseek-ai/dsh-settings'\n",
      'lib/deep/b.mjs': "import { missingB } from '@deepseek-ai/dsh-settings'\n",
    },
  })
  const r = checkKernelCompat({ kernelRoot: kernel, dist })
  assert.equal(r.ok, false)
  assert.deepEqual(r.hits.map((h) => h.symbol).sort(), ['missingA', 'missingB'])
  assert.equal(r.stats.fileCount, 3)
})
