import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { validateManifest } from '../suite/resources.mjs'
import { ASSET_PACKAGE, verifyAssetPackage } from '../suite/asset-package.mjs'
import { assertResourceBundle } from './repack/resource-bundle.mjs'

export const CHUNK_BYTES = 40 * 1024 * 1024
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
export function resourcePackageDirectory(root) { return path.join(root, '.cache', 'resource-package', 'package') }

/** Build registry data outside Git; both entrypoints pin the generated manifest. */
export function buildResources(root) {
  const suitePkg = JSON.parse(fs.readFileSync(path.join(root, 'suite/package.json')))
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const version = suitePkg.dependencies?.[ASSET_PACKAGE]
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '') || rootPkg.name !== 'eac-plugin-suite' || suitePkg.name !== rootPkg.name || rootPkg.version !== suitePkg.version || rootPkg.dependencies?.[ASSET_PACKAGE] !== version) throw new Error('cascade package identity/version mismatch')
  const items = JSON.parse(fs.readFileSync(path.join(root, 'dist/index.json')))
  validateManifest({ schemaVersion: 1, resourceVersion: version, items })
  const catalogs = new Map()
  for (const pack of ['eac', 'aio', 'skins', 'community']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'suite/catalog', `${pack}.json`)))
    const entries = Array.isArray(catalog) ? catalog : catalog.plugins ?? []
    for (const entry of entries) {
      // catalog 标 `distExclude: true` 的条目有意不进安装包（保留市场元数据，
      // 但不出现在 items 里）—— 不参与闭包断言。
      if (entry.distExclude !== true && !items.some(i => i.name === entry.name && i.version === entry.version)) throw new Error(`missing catalog resource: ${entry.name}@${entry.version}`)
      if (pack === 'skins' || pack === 'community') catalogs.set(entry.id, entry)
    }
  }
  const input = path.join(root, '.cache', 'asset-input')
  const gallery = JSON.parse(fs.readFileSync(path.join(input, 'gallery.json'), 'utf8'))
  if (!Array.isArray(gallery.skins) || gallery.skins.length !== catalogs.size) throw new Error('gallery catalog coverage mismatch')
  const seen = new Set()
  for (const skin of gallery.skins) {
    const entry = catalogs.get(skin.id)
    if (!entry || seen.has(skin.id) || skin.pkgName !== entry.name || skin.pkgVersion !== entry.version) throw new Error('gallery catalog identity mismatch: ' + skin.id)
    seen.add(skin.id)
    for (const file of [...Object.values(skin.previews ?? {}), ...(skin.prompt ? [skin.prompt] : [])]) {
      if (!/^(previews|prompts)\/[a-z0-9-]+\/[a-zA-Z0-9.-]+$/.test(file) || !fs.existsSync(path.join(input, file))) throw new Error('missing/unsafe gallery asset: ' + file)
    }
  }
  for (const item of items) {
    const file = path.join(root, 'dist', item.file), body = fs.readFileSync(file)
    if (body.length !== item.bytes || hash(body) !== item.sha256) throw new Error(`resource integrity mismatch: ${item.file}`)
    assertResourceBundle(file, item)
  }
  const parent = path.join(root, '.cache', 'resource-package'); fs.mkdirSync(parent, { recursive: true })
  const stage = fs.mkdtempSync(path.join(parent, 'build-'))
  try {
    const assets = path.join(stage, 'assets'), payload = path.join(assets, 'payload'); fs.mkdirSync(payload, { recursive: true })
    fs.copyFileSync(path.join(input, 'gallery.json'), path.join(assets, 'gallery.json'))
    for (const dir of ['previews', 'prompts']) if (fs.existsSync(path.join(input, dir))) fs.cpSync(path.join(input, dir), path.join(assets, dir), { recursive: true, dereference: false })
    const extraFiles = []
    function scan(dir, prefix = '') {
      for (const name of fs.readdirSync(dir).sort()) {
        const file = prefix + name, target = path.join(dir, name), stat = fs.lstatSync(target)
        if (stat.isSymbolicLink()) throw new Error('asset links are not allowed')
        if (stat.isDirectory()) { if (name !== 'payload') scan(target, file + '/'); continue }
        const bytes = fs.readFileSync(target); extraFiles.push({ file, bytes: bytes.length, sha256: hash(bytes) })
      }
    }
    scan(assets)
    const output = items.map(item => {
      const body = fs.readFileSync(path.join(root, 'dist', item.file)), parts = []
      for (let offset = 0, n = 0; offset < body.length; offset += CHUNK_BYTES, n++) {
        const chunk = body.subarray(offset, offset + CHUNK_BYTES), file = body.length <= CHUNK_BYTES ? item.file : `${item.file}.chunk-${String(n).padStart(3, '0')}.bin`
        fs.writeFileSync(path.join(payload, file), chunk)
        parts.push({ file, bytes: chunk.length, sha256: hash(chunk) })
      }
      return { ...item, parts }
    })
    const manifest = validateManifest({ schemaVersion: 1, resourceVersion: version, assetPackage: { name: ASSET_PACKAGE, version }, extraFiles, items: output })
    fs.writeFileSync(path.join(assets, 'bootstrap.json'), JSON.stringify(manifest, null, 2) + '\n')
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: ASSET_PACKAGE, version, description: 'Pinned EAC plugin suite baseline data, previews and prompts; no executable install scripts.', license: 'SEE LICENSE IN LICENSE', exports: { './package.json': './package.json' }, files: ['assets', 'LICENSE', 'SOURCES.json', 'README.md'], publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' } }, null, 2) + '\n')
    fs.writeFileSync(path.join(stage, 'LICENSE'), fs.readFileSync(path.join(root, 'suite/LICENSE'), 'utf8') + '\nThird-party archives retain their own licenses and notices. See SOURCES.json and each archive. This package does not relicense those assets.\n')
    fs.writeFileSync(path.join(stage, 'SOURCES.json'), JSON.stringify({ resources: items, catalog: ['eac', 'aio', 'skins', 'community'].flatMap(pack => JSON.parse(fs.readFileSync(path.join(root, 'suite/catalog', pack + '.json')))) }, null, 2) + '\n')
    fs.writeFileSync(path.join(stage, 'README.md'), '# eac-plugin-suite-assets\n\nFixed baseline data used as a required dependency by eac-plugin-suite. No activation, runtime dependencies or lifecycle scripts. Archives keep upstream licensing, including non-commercial restrictions.\n')
    verifyAssetPackage(assets, manifest)
    const dest = resourcePackageDirectory(root)
    if (fs.existsSync(dest)) {
      if (path.resolve(dest) !== path.join(path.resolve(root), '.cache/resource-package/package')) throw new Error('unsafe output path')
      fs.rmSync(dest, { recursive: true, force: true })
    }
    fs.renameSync(stage, dest)
    fs.mkdirSync(path.join(root, 'suite/assets'), { recursive: true })
    fs.writeFileSync(path.join(root, 'suite/assets/bootstrap.json'), JSON.stringify(manifest, null, 2) + '\n')
    return { version, resources: output.length, files: output.reduce((n, i) => n + i.parts.length, 0), bytes: output.reduce((n, i) => n + i.bytes, 0), directory: path.join(dest, 'assets/payload'), packageDirectory: dest }
  } finally { if (fs.existsSync(stage) && path.resolve(stage).startsWith(parent + path.sep)) fs.rmSync(stage, { recursive: true, force: true }) }
}

export function verifyResources(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(root, 'suite/assets/bootstrap.json'))))
  if (manifest.resourceVersion !== pkg.dependencies?.[ASSET_PACKAGE]) throw new Error('cascade payload version mismatch; build resources first')
  const dir = resourcePackageDirectory(root), assets = path.join(dir, 'assets')
  verifyAssetPackage(assets, manifest)
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')))
  if (metadata.scripts || metadata.dependencies || metadata.optionalDependencies || metadata.private || metadata.dsh) throw new Error('resource package must be pure publishable data')
  for (const item of manifest.items) {
    if (!item.parts?.length) throw new Error(`missing installed payload parts: ${item.file}`)
    const digest = crypto.createHash('sha256'); let bytes = 0
    for (const part of item.parts) {
      const file = path.join(assets, 'payload', part.file), stat = fs.lstatSync(file)
      const body = fs.readFileSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || body.length > CHUNK_BYTES || body.length !== part.bytes || hash(body) !== part.sha256) throw new Error(`payload part mismatch: ${part.file}`)
      bytes += body.length; digest.update(body)
    }
    if (bytes !== item.bytes || digest.digest('hex') !== item.sha256) throw new Error(`payload mismatch: ${item.file}`)
  }
  return { version: manifest.resourceVersion, manifest, directory: dir }
}
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) console.log(JSON.stringify(process.argv.includes('--verify') ? { ...verifyResources(path.resolve(import.meta.dirname, '..')), manifest: undefined } : buildResources(path.resolve(import.meta.dirname, '..')), null, 2))
