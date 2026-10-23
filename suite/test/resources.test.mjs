import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { ResourceManager, __test } from '../resources.mjs'
import { apply, __test as host } from '../index.js'

process.env.DSH_SUITE_NO_AUTOCHECK = '1'
process.env.DSH_SUITE_NO_RESOURCES = '1'
function fixture(t, { count = 2, installed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-full-resources-'))
  const bodies = new Map()
  const items = Array.from({ length: count }, (_, n) => {
    const body = Buffer.from(`pinned resource ${n}`)
    const item = { id: `fixture-${n}`, name: `fixture-${n}`, version: '1.0.0', file: `fixture-${n}-1.0.0.tgz`, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') }
    bodies.set(item.file, body)
    return item
  })
  const manifest = { schemaVersion: 1, resourceVersion: '1.0.0', items }
  const manager = new ResourceManager({ manifest, cacheDir: path.join(dir, 'resources'), bundledDir: path.join(dir, 'bundled') })
  if (installed) {
    fs.mkdirSync(manager.bundledDir)
    for (const item of items) fs.writeFileSync(path.join(manager.bundledDir, item.file), bodies.get(item.file))
  }
  t.after(async () => { manager.dispose(); await manager.run; if (!path.resolve(dir).startsWith(os.tmpdir() + path.sep)) throw new Error('unsafe test cleanup'); fs.rmSync(dir, { recursive: true, force: true }) })
  return { dir, bodies, manifest, manager }
}

test('manifest covers current catalog and rejects unsafe filenames, zero hashes and duplicates', t => {
  const current = JSON.parse(fs.readFileSync(new URL('../assets/bootstrap.json', import.meta.url)))
  __test.validateManifest(current)
  // catalog 标 `distExclude: true` 的条目有意不进安装包（保留市场元数据，
  // 但不出现在 bootstrap/items 里）—— 不参与闭包断言。
  for (const entry of Object.values(host.loadCatalog().packs).flat()) {
    if (entry.distExclude === true) continue
    assert.ok(current.items.some(i => i.name === entry.name && i.version === entry.version))
  }
  const { manifest } = fixture(t)
  for (const file of ['../escape.tgz', '/escape.tgz', 'C:\\escape.tgz', 'a/escape.tgz', 'a..tgz']) assert.throws(() => __test.validateManifest({ ...manifest, items: [{ ...manifest.items[0], file }] }))
  for (const change of [{ bytes: 0 }, { sha256: '0'.repeat(64) }]) assert.throws(() => __test.validateManifest({ ...manifest, items: [{ ...manifest.items[0], ...change }] }))
  assert.throws(() => __test.validateManifest({ ...manifest, items: [manifest.items[0], manifest.items[0]] }), /duplicate/)
})

test('complete installed payload verifies offline without fetch or creating a resource cache', async t => {
  const { manager } = fixture(t)
  const fetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('must not fetch baseline') }
  try {
    const status = await manager.hydrate()
    assert.equal(status.state, 'ready')
    assert.equal(status.mode, 'installed')
    assert.equal(status.completed, status.total)
    assert.equal(status.receivedBytes, status.totalBytes)
    assert.deepEqual(status.active, [])
    assert.equal(fs.existsSync(manager.cacheDir), false)
  } finally { globalThis.fetch = fetch }
})

test('missing installed files fail locally instead of downloading or trusting a previous cache', async t => {
  const { manager, manifest, bodies } = fixture(t, { installed: false })
  const item = manifest.items[0], cached = manager.cachedPath(item)
  fs.mkdirSync(path.dirname(cached), { recursive: true }); fs.writeFileSync(cached, bodies.get(item.file))
  assert.equal((await manager.hydrate()).state, 'failed')
  assert.match(manager.snapshot().error, /reinstall the complete/)
  await assert.rejects(manager.ensure(item), /installed resource missing/)
})

test('corruption fails closed; repaired installed files pass explicit verification', async t => {
  const { manager, manifest, bodies } = fixture(t)
  const item = manifest.items[0], file = path.join(manager.bundledDir, item.file)
  fs.writeFileSync(file, Buffer.alloc(item.bytes, 42))
  assert.equal((await manager.hydrate()).state, 'failed')
  await assert.rejects(manager.ensure(item), /integrity mismatch/)
  fs.writeFileSync(file, bodies.get(item.file))
  assert.equal((await manager.hydrate()).state, 'ready')
})

test('install copies verified targets outside node_modules and concurrent users share the copy', async t => {
  const { manager, manifest, bodies } = fixture(t)
  const item = manifest.items[0]
  const files = await Promise.all(Array.from({ length: 4 }, () => manager.ensure(item)))
  assert.equal(new Set(files).size, 1)
  assert.equal(files[0], manager.cachedPath(item))
  assert.deepEqual(fs.readFileSync(files[0]), bodies.get(item.file))
  assert.deepEqual(fs.readdirSync(path.dirname(files[0])), [item.file])
  fs.writeFileSync(files[0], 'damaged')
  assert.deepEqual(fs.readFileSync(await manager.ensure(item)), bodies.get(item.file))
})

test('disposing verification never downloads or marks incomplete resources ready', async t => {
  const { manager } = fixture(t)
  manager.dispose()
  assert.equal((await manager.hydrate()).state, 'cancelled')
  assert.equal(fs.existsSync(manager.cacheDir), false)
})

test('real HTTP API verifies installed files and installs only pinned targets without enabling them', async t => {
  const { manifest, bodies, dir, manager } = fixture(t, { count: 1 })
  const prev = process.env.DSH_HOME; process.env.DSH_HOME = dir
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })
  const installed = []; let handler
  const pm = { async listBundles() { return installed.map(row => ({ name: row.name, version: '1.0.0', enabled: row.enabled })) },
    async installBundle(target, options) { assert.deepEqual(fs.readFileSync(target), bodies.get(manifest.items[0].file)); installed.push({ target, name: manifest.items[0].name, enabled: options.enabled }); return { application: 'applied' } } }
  apply({ logger: {}, effect: fn => fn(), inject(deps, fn) { fn({ pluginManager: pm, webServer: { register(def) { handler = def.handler } } }) } }, {})
  host.state.catalog = { packs: { eac: manifest.items, aio: [], skins: [] }, retired: [] }; host.state.resources = manager
  t.after(async () => { await host.state.queueTail; host.state.resources = null })
  const server = http.createServer((req, res) => handler(req, res).catch(error => res.writeHead(500).end(error.message)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}/api/eac-plugin-suite`
  assert.equal((await fetch(`${base}/resources/retry`, { method: 'POST', body: '{}' })).status, 202)
  await manager.run
  assert.equal((await (await fetch(`${base}/status`)).json()).resources.state, 'ready')
  assert.equal((await fetch(`${base}/install`, { method: 'POST', body: JSON.stringify({ ids: ['fixture-0'], setEnabled: false }) })).status, 202)
  await host.state.queueTail
  assert.equal(installed.length, 1); assert.equal(installed[0].enabled, false)
  assert.ok(installed[0].target.startsWith(manager.cacheDir))
})

test('Git and Release pin the same required registry resource dependency without install-time scripts', () => {
  const root = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url)))
  const suite = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
  assert.equal(root.name, 'eac-plugin-suite'); assert.equal(root.name, suite.name); assert.equal(root.version, suite.version)
  assert.deepEqual(root.dependencies, suite.dependencies)
  // The assets dependency tracks the suite version (cascade identity rule enforced by
  // scripts/build-resources.mjs). Assert the invariant, not a literal: the previous
  // hard-coded '0.2.3' went stale the moment the suite was bumped to 0.2.4 and made
  // this gate fail for a reason unrelated to what it is meant to protect.
  assert.equal(root.dependencies['eac-plugin-suite-assets'], root.version)
  assert.ok(!root.files.includes('suite/assets/payload'))
  assert.ok(!suite.files.includes('assets/previews'))
  for (const phase of ['preinstall', 'install', 'postinstall', 'prepare']) assert.equal(root.scripts[phase], undefined)
  assert.ok(!suite.files.includes('assets/payload')); assert.deepEqual(suite.dependencies, root.dependencies)
  for (const file of [root.main, root.exports['./client'], root.dsh.bundle.patch]) assert.ok(fs.existsSync(new URL(`../../${file}`, import.meta.url)))
})

test('resource resolver refuses missing registry dependencies instead of using local payload', t => {
  const { dir } = fixture(t)
  assert.throws(() => host.resourceDirectory(dir), /required .* is missing/)
})

test('host starts local verification without UI and reports missing payload without fetch', async t => {
  const { dir } = fixture(t); const prev = process.env.DSH_HOME; process.env.DSH_HOME = dir
  delete process.env.DSH_SUITE_NO_RESOURCES
  const disposers = []; apply({ logger: {}, effect(fn) { disposers.push(fn()) }, inject() {} }, {})
  const manager = host.state.resources; assert.ok(manager)
  t.after(async () => { manager.dispose(); await manager.run; host.state.resources = null; process.env.DSH_SUITE_NO_RESOURCES = '1'; if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })
  await manager.run
  assert.ok(['ready','failed'].includes(manager.snapshot().state))
  assert.equal(manager.snapshot().mode, 'installed'); disposers.forEach(fn => fn?.())
})

test('missing pinned version never falls back to upstream or grants a version exemption', async t => {
  const { manifest, dir, manager } = fixture(t, { count: 1 }); const prev = process.env.DSH_HOME; process.env.DSH_HOME = dir
  t.after(() => { if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev })
  let handler, installs = 0, exemptions = 0
  apply({ logger: {}, effect: fn => fn(), inject(deps, fn) { fn({ pluginManager: { async listBundles() { return [] }, async installBundle() { installs++ }, async setVersionExemption() { exemptions++ } }, webServer: { register(def) { handler = def.handler } } }) } }, {})
  host.state.resources = manager; host.state.catalog = { packs: { eac: [{ ...manifest.items[0], version: '2.0.0', spec: 'upstream@latest' }], aio: [], skins: [] }, retired: [] }
  t.after(() => { host.state.resources = null })
  const req = { url: '/api/eac-plugin-suite/install', method: 'POST', on(event, fn) { if (event === 'data') fn(Buffer.from('{"ids":["fixture-0"]}')); if (event === 'end') fn() } }
  await handler(req, { writeHead() {}, end() {} }); await host.state.queueTail
  assert.equal(installs, 0); assert.equal(exemptions, 0)
})

test('structured host failures are not mistaken for successful operations', () => {
  assert.throws(() => host.assertManagementResult({ application: 'failed', error: { code: 'not-bundle' }, packageResult: { exitCode: 0, output: 'pnpm completed' } }), /not-bundle.*pnpm completed/)
  assert.doesNotThrow(() => host.assertManagementResult({ application: 'restart-required' }))
})


test('split resources assemble locally and corrupted/missing installed chunks cannot use an old cache', async t => {
  const { manager, manifest, bodies } = fixture(t, { count: 1 })
  const item = manifest.items[0], body = bodies.get(item.file), a = body.subarray(0, 4), b = body.subarray(4)
  item.parts = [a, b].map((bytes, n) => ({ file: `chunk-${n}.bin`, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }))
  for (let n = 0; n < 2; n++) fs.writeFileSync(path.join(manager.bundledDir, item.parts[n].file), [a, b][n])
  fs.unlinkSync(path.join(manager.bundledDir, item.file))
  assert.equal((await manager.hydrate()).state, 'ready')
  const file = await manager.ensure(item)
  assert.deepEqual(fs.readFileSync(file), body)
  fs.unlinkSync(path.join(manager.bundledDir, item.parts[1].file))
  assert.equal((await manager.hydrate()).state, 'failed')
  await assert.rejects(manager.ensure(item), /reinstall the complete/)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [item.file])
})

test('part manifest rejects traversal and inconsistent assembled sizes', t => {
  const { manifest } = fixture(t, { count: 1 }), item = manifest.items[0]
  item.parts = [{ file: '../escape.bin', bytes: item.bytes, sha256: item.sha256 }]
  assert.throws(() => __test.validateManifest(manifest), /unsafe resource part/)
  item.parts[0].file = 'safe.bin'; item.parts[0].bytes++
  assert.throws(() => __test.validateManifest(manifest), /invalid resource parts/)
})
