/**
 * Regression tests for the tracked source patches (patches/source-patches.json)
 * and the catalog decisions taken in the 2026-10-08/09 fix round.
 *
 * What these guard against
 * ------------------------
 * 1. A rebuild silently dropping a local fix. Every patched package must still be
 *    marked `locallyRepacked` in dist/index.json and its shipped file must hash to
 *    the manifest's `outputSha256`.
 * 2. The two retired/dropped surfaces coming back: the balance 价格设置 settings
 *    section (its bridge is retired by ADR 0006) and the plugin wizard.
 * 3. our-free-model silently regaining a managed distribution config, which the
 *    overlay pipeline cannot carry.
 *
 * Artifact-level tests need `dist/`, which is gitignored; they skip cleanly when
 * the pipeline has not been run in this checkout.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const asArray = (d) => (Array.isArray(d) ? d : (d.plugins ?? d.items ?? []))

const manifest = readJson(path.join(ROOT, 'patches', 'source-patches.json'))
const hasDist = fs.existsSync(path.join(ROOT, 'dist', 'index.json'))
const distIndex = hasDist ? readJson(path.join(ROOT, 'dist', 'index.json')) : []
const extract = (tgz, inner) =>
  execFileSync('tar', ['--force-local', '-xOf', String(tgz).replace(/\\/g, '/'), inner], { maxBuffer: 128 * 1024 * 1024 })

test('source-patch manifest is well formed and every diff file exists', () => {
  assert.equal(manifest.schemaVersion, 1)
  assert.ok(manifest.base?.eac?.tag, 'base.eac.tag must pin the source tag')
  assert.ok(Array.isArray(manifest.patches) && manifest.patches.length > 0)
  for (const patch of manifest.patches) {
    assert.ok(patch.name, 'patch.name required')
    assert.ok(patch.version, `patch.version required for ${patch.name}`)
    assert.ok(['eac-tag', 'npm', 'github', 'github-repo', 'github-tgz'].includes(patch.source))
    assert.ok(Array.isArray(patch.files) && patch.files.length > 0)
    for (const file of patch.files) {
      assert.ok(file.path && !file.path.includes('..') && !path.isAbsolute(file.path))
      assert.match(file.inputSha256, /^[0-9a-f]{64}$/)
      assert.match(file.outputSha256, /^[0-9a-f]{64}$/)
      assert.notEqual(file.inputSha256, file.outputSha256, `${patch.name}: patch must change the file`)
      assert.ok(file.note && file.note.length > 10, `${patch.name}: note should explain the fix`)
      const diffPath = path.join(ROOT, 'patches', ...file.diff.split('/'))
      assert.ok(fs.existsSync(diffPath), `missing diff file: ${file.diff}`)
      const diff = fs.readFileSync(diffPath, 'utf8')
      assert.match(diff, /^--- a\//m, `${file.diff}: needs -p1 compatible 'a/' header`)
      assert.match(diff, /^\+\+\+ b\//m, `${file.diff}: needs -p1 compatible 'b/' header`)
    }
  }
})

test('every patched package is recorded as locally repacked when dist exists', (t) => {
  if (!hasDist) return t.skip('dist/ absent (run the repack pipeline first)')
  for (const patch of manifest.patches) {
    const entry = distIndex.find((e) => e.name === patch.name)
    assert.ok(entry, `${patch.name} missing from dist/index.json`)
    assert.equal(entry.version, patch.version, `${patch.name}: catalog/manifest version drift`)
    assert.equal(entry.locallyRepacked, true, `${patch.name} must be marked locallyRepacked`)
    assert.ok(entry.repackNote && entry.repackNote.length > 10, `${patch.name} must carry a repackNote`)
    const tgz = path.join(ROOT, 'dist', entry.file)
    assert.ok(fs.existsSync(tgz), `missing artifact ${entry.file}`)
    assert.equal(fs.statSync(tgz).size, entry.bytes, `${entry.file}: byte count drift vs index.json`)
    assert.equal(sha256(fs.readFileSync(tgz)), entry.sha256, `${entry.file}: sha256 drift vs index.json`)
  }
})

test('shipped artifacts still contain exactly the patched bytes', (t) => {
  if (!hasDist) return t.skip('dist/ absent (run the repack pipeline first)')
  for (const patch of manifest.patches) {
    const entry = distIndex.find((e) => e.name === patch.name)
    for (const file of patch.files) {
      const buf = extract(path.join(ROOT, 'dist', entry.file), `package/${file.path}`)
      assert.equal(
        sha256(buf),
        file.outputSha256,
        `${patch.name} ${file.path}: rebuilt artifact does not match the patched output hash`,
      )
    }
  }
})

test('balance no longer registers the retired 价格设置 surface but keeps the composer dock', (t) => {
  if (!hasDist) return t.skip('dist/ absent (run the repack pipeline first)')
  const entry = distIndex.find((e) => e.name === '@deepseek-ai/dsh-balance')
  const src = extract(path.join(ROOT, 'dist', entry.file), 'package/lib/client.js').toString('utf8')
  assert.ok(src.includes('conversation.composer.dock'), 'the composer dock must stay registered')
  assert.ok(!src.includes('PricingSection'), 'the unreachable pricing component must be gone')
  for (const dead of ['priceBridge', 'useAvailableModels', 'PRICE_MODELS']) {
    assert.ok(!src.includes(dead), `${dead} belongs to the removed pricing section`)
  }
  assert.ok(src.includes('function useBalanceData()'), 'the dock data path must be preserved')
})

test('settings-groups ships the collapser fix', (t) => {
  if (!hasDist) return t.skip('dist/ absent (run the repack pipeline first)')
  const entry = distIndex.find((e) => e.name === 'dsh-settings-groups')
  const src = extract(path.join(ROOT, 'dist', entry.file), 'package/lib/client.js').toString('utf8')
  assert.ok(/generalRows|generalSlotWrappers/.test(src), 'collapser fix markers missing from the artifact')
})

test('plugin wizard is retired and no longer distributed', (t) => {
  for (const rel of ['catalog/eac.json', 'suite/catalog/eac.json']) {
    const items = asArray(readJson(path.join(ROOT, rel)))
    assert.ok(!items.some((e) => e.id === 'plugin-wizard' || e.name === 'dsh-plugin-wizard'), `${rel} still lists the wizard`)
  }
  const retired = readJson(path.join(ROOT, 'catalog', 'retired.json'))
  const items = asArray(retired)
  assert.ok(items.some((e) => e.id === 'plugin-wizard' || e.name === 'dsh-plugin-wizard'), 'wizard retirement record missing')
  const bootstrap = readJson(path.join(ROOT, 'suite/assets/bootstrap.json'))
  assert.ok(!bootstrap.items.some((i) => i.name === 'dsh-plugin-wizard' || i.file?.includes('wizard')), 'wizard still pinned in the manifest')
  if (hasDist) {
    assert.ok(!distIndex.some((e) => e.id === 'plugin-wizard'), 'wizard still present in dist/index.json')
  }
})

test('our-free-model ships default-enabled without a managed distribution config', (t) => {
  const items = asArray(readJson(path.join(ROOT, 'catalog/eac.json')))
  const ofm = items.find((e) => e.id === 'our-free-model')
  assert.ok(ofm, 'our-free-model missing from catalog/eac.json')
  assert.equal(ofm.defaultEnabled, true, 'OFM must be default-enabled (the switch must not claim otherwise)')
  // Overlay rows are only emitted for default-disabled entries, so an enabled OFM
  // must not carry a config at all (the pipeline's passthrough gate rejects it).
  assert.ok(!('config' in ofm), 'OFM must not carry a config: overlay rows only exist for default-disabled entries')
  assert.notEqual(ofm.config?.distribution, 'managed', 'OFM must not declare a managed distribution')
  const suiteItems = asArray(readJson(path.join(ROOT, 'suite/catalog/eac.json')))
  const ofmSuite = suiteItems.find((e) => e.id === 'our-free-model')
  assert.ok(ofmSuite && ofmSuite.defaultEnabled === true, 'suite catalog must mirror the OFM default-enabled state')
})

test('bootstrap manifest covers the catalog and pins the patched hashes', (t) => {
  const bootstrap = readJson(path.join(ROOT, 'suite/assets/bootstrap.json'))
  const catalogs = ['eac', 'aio', 'skins', 'community']
    .flatMap((p) => (fs.existsSync(path.join(ROOT, 'suite/catalog', `${p}.json`)) ? asArray(readJson(path.join(ROOT, 'suite/catalog', `${p}.json`))) : []))
  for (const entry of catalogs) {
    assert.ok(
      bootstrap.items.some((i) => i.name === entry.name && i.version === entry.version),
      `manifest missing catalog resource ${entry.name}@${entry.version}`,
    )
  }
  for (const patch of manifest.patches) {
    const item = bootstrap.items.find((i) => i.name === patch.name)
    assert.ok(item, `${patch.name} missing from bootstrap.json`)
    assert.equal(item.locallyRepacked, true, `${patch.name}: manifest must record locallyRepacked`)
    if (hasDist) {
      const entry = distIndex.find((e) => e.name === patch.name)
      assert.equal(item.sha256, entry.sha256, `${patch.name}: manifest hash must match dist`)
      assert.equal(item.bytes, entry.bytes, `${patch.name}: manifest bytes must match dist`)
    }
  }
})
