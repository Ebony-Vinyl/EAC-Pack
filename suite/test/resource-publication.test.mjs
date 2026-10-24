import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { assertResourceBundle } from '../../scripts/repack/resource-bundle.mjs'

test('publication rejects plain plugin tarballs and requires the declared patch to exist', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-bundle-gate-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'package')
  fs.mkdirSync(dir)
  const expected = { name: 'fixture-plugin', version: '1.0.0', file: 'fixture-plugin-1.0.0.tgz' }
  const pkg = { name: expected.name, version: expected.version }
  const file = path.join(root, expected.file)
  const pack = () => { fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg)); execFileSync('tar', ['--force-local', '-czf', file.replace(/\\/g, '/'), '-C', root.replace(/\\/g, '/'), 'package'], { windowsHide: true }) }
  pack()
  assert.throws(() => assertResourceBundle(file, expected), /declares no safe dsh.bundle.patch/)
  pkg.dsh = { bundle: { patch: './cordis.patch.yml' } }
  pack()
  assert.throws(() => assertResourceBundle(file, expected))
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '- insert: []\n')
  pack()
  assert.equal(assertResourceBundle(file, expected).name, expected.name)
  assert.throws(() => assertResourceBundle(file, { ...expected, version: '2.0.0' }), /identity mismatch/)
  pkg.dsh.bundle.patch = '../escape.yml'
  pack()
  assert.throws(() => assertResourceBundle(file, expected), /safe/)
})
