import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { root, output, npm, unpack, verifyInstalledAssets, parsePackJson } from './pack-delivery.mjs'
import { verifyResources } from './build-resources.mjs'
import { ASSET_PACKAGE } from '../suite/asset-package.mjs'

/** Cold production fetch, separate from local fixture-registry tests. */
export async function verifyPublishedResources() {
  const { version, manifest } = verifyResources(root)
  const spec = `${ASSET_PACKAGE}@${version}`, registry = 'https://registry.npmjs.org/'
  fs.mkdirSync(output, { recursive: true })
  const cold = fs.mkdtempSync(path.join(output, 'production-fetch-'))
  const metadata = JSON.parse(npm(['view', spec, '--json', `--registry=${registry}`, '--fetch-retries=0', '--fetch-timeout=30000'], root))
  if (metadata.name !== ASSET_PACKAGE || metadata.version !== version || metadata.scripts || metadata.dependencies || metadata.optionalDependencies || metadata.dsh) throw new Error('production registry resource identity/structure mismatch')
  const text = npm(['pack', spec, '--json', '--ignore-scripts', '--cache', path.join(cold, 'cache'), '--pack-destination', cold, `--registry=${registry}`, '--fetch-retries=1', '--fetch-timeout=120000'], root)
  const packed = parsePackJson(text)[0]
  const file = path.join(cold, packed.filename), bytes = fs.readFileSync(file)
  const integrity = 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64')
  if (integrity !== metadata.dist.integrity) throw new Error('production tarball registry integrity mismatch')
  const directory = unpack(file, path.join(cold, 'extracted'))
  const status = await verifyInstalledAssets(path.join(directory, 'assets'), manifest)
  const evidence = { name: ASSET_PACKAGE, version, registry, file, bytes: bytes.length, integrity, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), status, verifiedAt: new Date().toISOString() }
  fs.writeFileSync(path.join(output, 'production-registry-evidence.json'), JSON.stringify(evidence, null, 2))
  return evidence
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(import.meta.dirname, 'verify-published-resources.mjs')) console.log(JSON.stringify(await verifyPublishedResources(), null, 2))
