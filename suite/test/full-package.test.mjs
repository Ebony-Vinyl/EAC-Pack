import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { buildResources, verifyResources, resourcePackageDirectory } from '../../scripts/build-resources.mjs'
import { resolveAssetPackage, readVerifiedAsset, verifyAssetPackage } from '../asset-package.mjs'
import { verifyPackage } from '../scripts/verify-package.mjs'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-cascade-build-'))
  t.after(() => { if (!root.startsWith(os.tmpdir() + path.sep)) throw new Error('unsafe cleanup'); fs.rmSync(root, { recursive: true, force: true }) })
  for (const dir of ['dist', 'suite/assets', 'suite/catalog', 'source/package', '.cache/asset-input']) fs.mkdirSync(path.join(root, dir), { recursive: true })
  const item = { id: 'fixture', name: 'fixture-plugin', version: '1.0.0', file: 'fixture-plugin-1.0.0.tgz' }
  fs.writeFileSync(path.join(root, 'source/package/package.json'), JSON.stringify({ name: item.name, version: item.version, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  fs.writeFileSync(path.join(root, 'source/package/cordis.patch.yml'), '- insert:\n    - id: fixture\n      name: fixture-plugin\n')
  execFileSync('tar', ['--force-local', '-czf', path.join(root, 'dist', item.file).replace(/\\/g, '/'), '-C', path.join(root, 'source').replace(/\\/g, '/'), 'package'], { windowsHide: true })
  const body = fs.readFileSync(path.join(root, 'dist', item.file)); Object.assign(item, { bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') })
  const version = '1.2.3', pkg = { name: 'eac-plugin-suite', version, dependencies: { 'eac-plugin-suite-assets': version }, dsh: { bundle: { patch: './cordis.patch.yml' } } }
  fs.writeFileSync(path.join(root, 'suite/package.json'), JSON.stringify(pkg))
  fs.writeFileSync(path.join(root, 'suite/cordis.patch.yml'), '- insert: []\n')
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
  fs.writeFileSync(path.join(root, 'suite/LICENSE'), 'MIT\n')
  fs.writeFileSync(path.join(root, 'dist/index.json'), JSON.stringify([item]))
  fs.writeFileSync(path.join(root, '.cache/asset-input/gallery.json'), '{"skins":[]}\n')
  for (const pack of ['eac', 'aio', 'skins', 'community']) fs.writeFileSync(path.join(root, 'suite/catalog', `${pack}.json`), JSON.stringify(pack === 'eac' ? [item] : []))
  return { root, item }
}

function installFixture(root) {
  const dest = path.join(root, 'suite/node_modules/eac-plugin-suite-assets')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(resourcePackageDirectory(root), dest, { recursive: true })
  return path.join(dest, 'assets')
}

test('cascade builder includes every artifact only in ignored registry staging', t => {
  const { root, item } = fixture(t), result = buildResources(root)
  assert.equal(result.resources, 1); assert.equal(result.version, '1.2.3')
  const payload = fs.readFileSync(path.join(result.directory, item.file))
  assert.equal(crypto.createHash('sha256').update(payload).digest('hex'), item.sha256)
  assert.equal(fs.existsSync(path.join(root, 'suite/assets/payload')), false)
  assert.equal(verifyResources(root).manifest.items[0].parts.length, 1)
})

test('cascade builder rejects corrupt resources and incomplete catalog coverage', t => {
  const { root, item } = fixture(t)
  fs.writeFileSync(path.join(root, 'suite/catalog/aio.json'), JSON.stringify([{ name: 'missing', version: '1.0.0' }]))
  assert.throws(() => buildResources(root), /missing catalog resource/)
  fs.writeFileSync(path.join(root, 'suite/catalog/aio.json'), '[]')
  fs.writeFileSync(path.join(root, 'dist', item.file), 'bad bytes')
  assert.throws(() => buildResources(root), /integrity mismatch/)
})

test('cascade builder rejects entrypoint version mismatch before writing resources', t => {
  const { root } = fixture(t)
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))); pkg.version = 'old'
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
  assert.throws(() => buildResources(root), /identity\/version mismatch/)
  assert.equal(fs.existsSync(resourcePackageDirectory(root)), false)
})

test('Git packing verifies contract before dependencies exist; resource gate rejects corruption', async t => {
  const { root } = fixture(t); buildResources(root)
  assert.equal((await verifyPackage(path.join(root, 'suite'))).resources, 1)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json')))
  const file = path.join(resourcePackageDirectory(root), 'assets/payload', manifest.items[0].parts[0].file)
  fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size, 1))
  assert.throws(() => verifyResources(root), /payload part mismatch/)
  assert.equal((await verifyPackage(path.join(root, 'suite'))).mode, 'required-registry-dependency')
})

test('asset dependency resolution handles installed layout and refuses identity/manifest mismatch', t => {
  const { root } = fixture(t); buildResources(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json')))
  assert.throws(() => resolveAssetPackage(path.join(root, 'suite'), manifest), /is missing/)
  const assets = installFixture(root)
  assert.equal(resolveAssetPackage(path.join(root, 'suite'), manifest), assets)
  verifyAssetPackage(assets, manifest)
  fs.writeFileSync(path.join(assets, 'bootstrap.json'), JSON.stringify({ ...manifest, resourceVersion: '2.0.0' }))
  assert.throws(() => resolveAssetPackage(path.join(root, 'suite'), manifest), /manifest does not match/)
  fs.writeFileSync(path.join(assets, 'bootstrap.json'), JSON.stringify(manifest))
  const meta = path.join(assets, '../package.json'), pkg = JSON.parse(fs.readFileSync(meta)); pkg.version = '2.0.0'
  fs.writeFileSync(meta, JSON.stringify(pkg))
  assert.throws(() => resolveAssetPackage(path.join(root, 'suite'), manifest), /identity\/version mismatch/)
})

test('gallery asset bytes and safe pinned paths are verified before use', t => {
  const { root } = fixture(t); buildResources(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json'))), assets = installFixture(root)
  assert.ok(readVerifiedAsset(assets, manifest, 'gallery.json').length)
  assert.throws(() => readVerifiedAsset(assets, manifest, '../package.json'), /not pinned/)
  fs.writeFileSync(path.join(assets, 'gallery.json'), '{"skins":[{}]}')
  assert.throws(() => verifyAssetPackage(assets, manifest), /integrity mismatch/)
})

test('Git and Release metadata pin identical assets and use matching documentation', () => {
  const root = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url)))
  const suite = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
  assert.ok(root.files.includes('suite/package.json')); assert.equal(root.name, suite.name); assert.equal(root.version, suite.version)
  assert.deepEqual(root.dependencies, suite.dependencies)
  assert.equal(fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'))
})

test('asset resolution follows a symlinked entrypoint to its real dependency graph', t => {
  const { root } = fixture(t); buildResources(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json')))
  const assets = installFixture(root), link = path.join(root, 'linked-entrypoint')
  fs.symlinkSync(path.join(root, 'suite'), link, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(resolveAssetPackage(link, manifest), assets)
})

test('resource dependencies cannot contain executable lifecycle hooks or plugin declarations', t => {
  const { root } = fixture(t); buildResources(root)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json'))), assets = installFixture(root)
  const file = path.join(assets, '../package.json'), pkg = JSON.parse(fs.readFileSync(file))
  for (const field of ['scripts', 'dependencies', 'optionalDependencies', 'peerDependencies', 'dsh']) {
    fs.writeFileSync(file, JSON.stringify({ ...pkg, [field]: {} }))
    assert.throws(() => verifyAssetPackage(assets, manifest), /pure publishable data/)
  }
})
