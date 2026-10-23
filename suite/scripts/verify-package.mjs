import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateManifest } from '../resources.mjs'
import { ASSET_PACKAGE } from '../asset-package.mjs'

/** Git packing precedes dependency installation: validate its pinned contract, not downloaded bytes. */
export async function verifyPackage(pkgDir = path.resolve(import.meta.dirname, '..')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json')))
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(pkgDir, 'assets/bootstrap.json'))))
  if (pkg.name !== 'eac-plugin-suite' || pkg.dependencies?.[ASSET_PACKAGE] !== manifest.resourceVersion || manifest.assetPackage?.name !== ASSET_PACKAGE) throw new Error('required pinned resource dependency mismatch')
  if (Object.keys(pkg.dependencies).length !== 1 || pkg.optionalDependencies || pkg.peerDependencies || ['prepare', 'install', 'postinstall'].some(s => pkg.scripts?.[s])) throw new Error('unexpected dependencies or install lifecycle scripts')
  for (const pack of ['eac', 'aio', 'skins', 'community']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(pkgDir, 'catalog', pack + '.json')))
    for (const entry of Array.isArray(catalog) ? catalog : catalog.plugins ?? []) {
      // catalog 标 `distExclude: true` 的条目**有意不进安装包** —— 保留市场元数据，
      // 但不出现在 bootstrap/items 里（如已退役的 dsh-dafeiyu，tgz 占 160MB）。
      // 这类条目不参与「catalog 必须被 bootstrap 覆盖」的闭包断言。
      if (entry.distExclude === true) continue
      if (!manifest.items.some(i => i.name === entry.name && i.version === entry.version)) throw new Error('missing catalog resource: ' + entry.name)
    }
  }
  for (const item of manifest.items) if (!item.parts?.length) throw new Error('missing pinned resource parts: ' + item.file)
  for (const file of pkg.files ?? []) if (/assets\/(payload|previews|prompts|gallery\.json)/.test(file)) throw new Error('Git package must not include heavyweight assets')
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.includes('..') || !fs.existsSync(path.resolve(pkgDir, patch))) throw new Error('missing bundle patch')
  return { version: pkg.version, resourceVersion: manifest.resourceVersion, resources: manifest.items.length, mode: 'required-registry-dependency' }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await verifyPackage())
