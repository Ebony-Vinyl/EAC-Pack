import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resourcePackageDirectory, verifyResources } from './build-resources.mjs'
import { verifyAssetPackage, ASSET_PACKAGE } from '../suite/asset-package.mjs'
import { ResourceManager } from '../suite/resources.mjs'

export const root = path.resolve(import.meta.dirname, '..')
export const output = path.join(root, '.cache/cascade/artifacts')
export function npm(args, cwd) {
  const command = process.env.npm_execpath || (process.platform === 'win32'
    ? path.join(path.dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js')
    : fs.realpathSync(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim()))
  return execFileSync(process.execPath, [command, ...args], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
}
/**
 * npm <=10 prints `[{...}]` for `pack --json`; npm >=11 prints an object keyed by
 * package name. Prepack scripts may also print non-JSON to stdout first, and npm
 * may append summary lines afterwards, so scan every balanced `{...}`/`[...]`
 * candidate and keep the last one that parses to a pack result with a filename.
 */
export function parsePackJson(text) {
  const candidates = []
  for (let i = 0; i < text.length; i++) {
    const open = text[i]
    if (open !== '{' && open !== '[') continue
    let depth = 0, inString = false, escaped = false, j = i
    for (; j < text.length; j++) {
      const ch = text[j]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') { depth--; if (depth === 0) break }
    }
    if (depth === 0) candidates.push(text.slice(i, j + 1))
  }
  for (let k = candidates.length - 1; k >= 0; k--) {
    let parsed
    try { parsed = JSON.parse(candidates[k]) } catch { continue }
    const results = Array.isArray(parsed) ? parsed : Object.values(parsed)
    if (Array.isArray(results) && results.length && results[0]?.filename) return results
  }
  throw new Error('npm returned no package metadata')
}
export function pack(dir, label) {
  const destination = path.join(output, label)
  fs.mkdirSync(destination, { recursive: true })
  const text = npm(['pack', '--json', '--pack-destination', destination], dir)
  const results = parsePackJson(text)
  return { ...results[0], file: path.join(destination, results[0].filename) }
}
const fwd = (p) => String(p).replace(/\\/g, '/')
export function unpack(file, destination) {
  const listing = execFileSync('tar', ['--force-local', '-tf', fwd(file)], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
  for (const entry of listing) if (!entry.startsWith('package/') || entry.includes('..') || /[\\:]/.test(entry)) throw new Error('unsafe archive path: ' + entry)
  const verbose = execFileSync('tar', ['--force-local', '-tvf', fwd(file)], { encoding: 'utf8', windowsHide: true })
  if (verbose.split(/\r?\n/).some(line => line && !['-', 'd'].includes(line[0]))) throw new Error('archive links or special files are not allowed')
  fs.mkdirSync(destination, { recursive: true })
  execFileSync('tar', ['--force-local', '-xf', fwd(file), '-C', fwd(destination)], { windowsHide: true })
  return path.join(destination, 'package')
}
export async function verifyInstalledAssets(directory, manifest) {
  verifyAssetPackage(directory, manifest)
  const manager = new ResourceManager({ manifest, bundledDir: path.join(directory, 'payload'), cacheDir: path.join(root, '.cache/cascade/verification-cache'), validateInstall: () => verifyAssetPackage(directory, manifest) })
  const status = await manager.complete()
  if (status.state !== 'ready' || status.completed !== manifest.items.length) throw new Error('not all installed resources are ready: ' + JSON.stringify(status))
  return status
}
export async function packAssets() {
  const { version, manifest } = verifyResources(root)
  const packed = pack(resourcePackageDirectory(root), 'assets')
  const allowed = new Set(['package.json', 'LICENSE', 'SOURCES.json', 'README.md', 'assets/bootstrap.json', ...manifest.extraFiles.map(x => 'assets/' + x.file), ...manifest.items.flatMap(i => i.parts.map(p => 'assets/payload/' + p.file))])
  if (packed.files.length !== allowed.size || packed.files.some(f => !allowed.has(f.path))) throw new Error('unexpected resource package files')
  const extracted = unpack(packed.file, fs.mkdtempSync(path.join(output, 'verify-assets-')))
  await verifyInstalledAssets(path.join(extracted, 'assets'), manifest)
  return { version, resources: manifest.items.length, file: packed.file, bytes: packed.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(packed.file)).digest('hex') }
}
export async function packRelease() {
  const { manifest } = verifyResources(root)
  const stage = fs.mkdtempSync(path.join(output, 'release-stage-'))
  const original = JSON.parse(fs.readFileSync(path.join(root, 'suite/package.json')))
  for (const file of original.files) fs.cpSync(path.join(root, 'suite', file), path.join(stage, file), { recursive: true })
  const metadata = { ...original, bundleDependencies: [ASSET_PACKAGE] }
  delete metadata.devDependencies
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n')
  fs.cpSync(resourcePackageDirectory(root), path.join(stage, 'node_modules', ASSET_PACKAGE), { recursive: true })
  const packed = pack(stage, 'release')
  if (!packed.bundled?.includes(ASSET_PACKAGE)) throw new Error('npm did not bundle the required resource package')
  const extracted = unpack(packed.file, fs.mkdtempSync(path.join(output, 'verify-release-')))
  const releaseMetadata = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json')))
  if (releaseMetadata.dependencies?.[ASSET_PACKAGE] !== manifest.resourceVersion || !releaseMetadata.bundleDependencies.includes(ASSET_PACKAGE)) throw new Error('release dependency identity mismatch')
  await verifyInstalledAssets(path.join(extracted, 'node_modules', ASSET_PACKAGE, 'assets'), manifest)
  return { version: metadata.version, resources: manifest.items.length, file: packed.file, bytes: packed.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(packed.file)).digest('hex') }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(import.meta.dirname, 'pack-delivery.mjs')) {
  const assets = await packAssets()
  const git = pack(root, 'git')
  if (git.size > 1024 * 1024 || git.files.some(f => /assets\/(payload|previews|prompts|gallery\.json)/.test(f.path))) throw new Error('Git entrypoint contains heavyweight or unexpected data')
  const release = await packRelease()
  fs.writeFileSync(path.join(output, 'packed-evidence.json'), JSON.stringify({ assets, git: { file: git.file, bytes: git.size }, release }, null, 2))
  console.log(JSON.stringify({ assets, git: { file: git.file, bytes: git.size }, release }, null, 2))
}
