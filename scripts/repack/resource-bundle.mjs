import { execFileSync } from 'node:child_process'

const fwd = (p) => String(p).replace(/\\/g, '/')

/** Read archive metadata without extracting or running package scripts. */
export function assertResourceBundle(file, expected) {
  const pkg = JSON.parse(execFileSync('tar', ['--force-local', '-xOf', fwd(file), 'package/package.json'], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }))
  if (pkg.name !== expected.name || pkg.version !== expected.version) throw new Error(`resource identity mismatch: ${expected.file}`)
  const patch = pkg.dsh?.bundle?.patch
  const patches = Array.isArray(patch) ? patch : [patch]
  if (!patches.length || patches.some(p => typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..') || p.includes('\\') || p.includes(':'))) {
    throw new Error(`${expected.file} declares no safe dsh.bundle.patch; run ensure-bundles.mjs and rebuild the pinned manifest`)
  }
  for (const p of patches) {
    execFileSync('tar', ['--force-local', '-xOf', fwd(file), `package/${p.replace(/^\.\//, '')}`], { stdio: 'pipe', windowsHide: true, maxBuffer: 1024 * 1024 })
  }
  return pkg
}
