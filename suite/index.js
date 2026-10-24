/**
 * eac-plugin-suite — Host half.
 *
 * One plugin that carries the whole EAC/AIO plugin suite: a built-in catalog
 * (EAC 41 active plugins, AIO 9 + third-party runtime bundles, 10 optional
 * skins), a settings-page installer UI (client half), and this host half that
 * drives the kernel's own PluginManager to install / enable / update / remove
 * catalog entries on the current profile.
 *
 * Wiring:
 * - `pluginManager` (required) — the same service the Web plugin page and the
 *   `dsh plugin` CLI use. Install/remove/enable all go through it, so every
 *   operation inherits the kernel's own pre-checks, snapshot and rollback.
 * - `webServer` (optional, lazy) — mounts the JSON API the settings tab reads
 *   at `/api/eac-plugin-suite/*` plus an SSE stream for install progress.
 *
 * Everything else is deliberately self-contained: the catalog ships inside the
 * package (`catalog/*.json`, repacked tarballs in the required registry data dependency), snapshots
 * land under `$DSH_HOME/eac-plugin-suite/`. Git installs acquire the required data dependency; complete Releases bundle it;
 * startup verifies local assets without downloading them.
 *
 * @module index.js
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { ResourceManager } from './resources.mjs'
import { resolveAssetPackage, readVerifiedAsset, verifyAssetPackage } from './asset-package.mjs'

export const name = 'eac-plugin-suite'

/** Nothing required at start: services resolve lazily so a missing one
 *  degrades a feature instead of failing the whole plugin. */
export const inject = []

/** Installed package directory — catalog, dist tarballs and locale read from here. */
const PKG_DIR = fileURLToPath(new URL('./', import.meta.url))

/** Plugin data dir resolved lazily (DSH_HOME must be read at call time). */
function dataDir() {
  const dir = path.join(resolveDshHome(), 'eac-plugin-suite')
  const legacy = path.join(resolveDshHome(), 'plugin-suite')
  // Keep the old data intact; new code writes only to its own directory.
  if (!fs.existsSync(dir) && fs.existsSync(legacy)) fs.cpSync(legacy, dir, { recursive: true, dereference: false })
  return dir
}
function snapshotDir() {
  return path.join(dataDir(), 'snapshots')
}
function logDir() {
  return path.join(dataDir(), 'logs')
}

/** Profile files captured by every snapshot. */
const PROFILE_FILES = ['package.json', 'pnpm-lock.yaml', 'compatibility.json']

/** Event ring kept in memory (and mirrored to disk) so late SSE clients catch up. */
const EVENT_RING_MAX = 500

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const PACK_IDS = ['eac', 'aio', 'skins']

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function normalizeEntries(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.plugins) ? json.plugins : []
  return list.filter((e) => e && e.id && e.name)
}

function loadCatalog() {
  const packs = {}
  for (const pack of PACK_IDS) {
    const json = readJson(path.join(PKG_DIR, 'catalog', `${pack}.json`))
    packs[pack] = normalizeEntries(json)
  }
  // Community skins (catalog/community.json) join the skins pack; a same-id
  // entry already listed in skins.json wins so the split stays predictable.
  const community = normalizeEntries(readJson(path.join(PKG_DIR, 'catalog', 'community.json')))
  if (community.length) {
    const seen = new Set(packs.skins.map((e) => e.id))
    for (const entry of community) {
      if (seen.has(entry.id)) continue
      packs.skins.push(entry)
      seen.add(entry.id)
    }
  }
  const retired = normalizeEntries(readJson(path.join(PKG_DIR, 'catalog', 'retired.json')))
  return { packs, retired }
}

/** `dist/index.json` from the repack pipeline: [{id,name,version,packs,file,sha256,bytes}] */
function loadDistIndex() {
  const json = readJson(path.join(PKG_DIR, 'assets', 'dist', 'index.json'))
  if (!Array.isArray(json)) return []
  return json.filter((e) => e && e.file)
}

/**
 * Install target for a catalog entry: a bundled tarball when we have one
 * (offline, version-pinned), otherwise the entry's registry/git spec.
 */
function resolveTarget(entry, distIndex) {
  // Channel-updated tarballs live in the download cache, not assets/dist.
  if (entry.cacheFile && fs.existsSync(entry.cacheFile)) return entry.cacheFile
  const hit =
    distIndex.find((d) => d.name === entry.name && d.version === entry.version) ??
    distIndex.find((d) => d.id === entry.id && d.version === entry.version)
  if (hit) {
    const file = path.join(PKG_DIR, 'assets', 'dist', hit.file)
    if (fs.existsSync(file)) return file
  }
  if (entry.tgz) {
    const file = path.join(PKG_DIR, 'assets', 'dist', entry.tgz)
    if (fs.existsSync(file)) return file
  }
  return entry.spec ?? entry.name
}

// ---------------------------------------------------------------------------
// Versions (small semver compare, prerelease aware)
// ---------------------------------------------------------------------------

function parseVersion(v) {
  const m = String(v ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
}

function cmpVersions(a, b) {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va && !vb) return 0
  if (!va) return -1
  if (!vb) return 1
  for (const k of ['major', 'minor', 'patch']) {
    if (va[k] !== vb[k]) return va[k] < vb[k] ? -1 : 1
  }
  // A release outranks any prerelease of the same triple; otherwise dot-split
  // identifier comparison (numeric identifiers compare numerically, ASCII otherwise).
  if (va.pre !== vb.pre) {
    if (va.pre === null) return 1
    if (vb.pre === null) return -1
    const pa = va.pre.split('.')
    const pb = vb.pre.split('.')
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i]
      const y = pb[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      const nx = /^\d+$/.test(x)
      const ny = /^\d+$/.test(y)
      if (nx && ny) {
        if (+x !== +y) return +x < +y ? -1 : 1
      } else if (nx !== ny) {
        return nx ? -1 : 1
      } else if (x !== y) {
        return x < y ? -1 : 1
      }
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// PluginManager adapter — defensive so a signature drift degrades one feature,
// never the plugin.
// ---------------------------------------------------------------------------

function pmCall(pm, method, ...args) {
  const fn = pm?.[method]
  if (typeof fn !== 'function') {
    throw new Error(`pluginManager.${method} is unavailable on this kernel`)
  }
  return pm[method](...args)
}

function assertManagementResult(result) {
  if (result?.application !== 'failed' && !result?.error) return result
  const detail = result.error?.diagnostic ?? result.packageResult?.output ?? ''
  const error = new Error([result.error?.code ?? 'operation-error', detail].filter(Boolean).join(': '))
  error.management = result.error
  throw error
}

function normalizeBundle(b) {
  const pkg = b?.pkg ?? b?.package ?? {}
  const name = pkg.name ?? b?.name ?? b?.id
  if (!name) return null
  return {
    name,
    version: pkg.version ?? b?.version ?? '',
    enabled: b?.enabled ?? b?.state?.enabled ?? null,
    state: b?.state?.state ?? b?.state ?? null,
    kind: b?.kind ?? null,
    source: b?.source ?? null,
    raw: undefined,
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const state = {
  events: [],
  listeners: new Set(),
  currentJob: null,
  queueTail: Promise.resolve(),
  catalog: null,
  distIndex: [],
  gallery: undefined,
  channel: null,
  channelCfg: null,
  fetchImpl: null,
  timers: [],
  lastAutoApply: { channelVersion: null, at: 0 },
}

function emit(event) {
  const e = { ts: Date.now(), ...event }
  state.events.push(e)
  if (state.events.length > EVENT_RING_MAX) state.events.splice(0, state.events.length - EVENT_RING_MAX)
  persistEvent(e)
  for (const listener of state.listeners) {
    try {
      listener(e)
    } catch {
      /* a dead SSE client must never break the queue */
    }
  }
}

function persistEvent(e) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.appendFileSync(path.join(dataDir(), "events.jsonl"), JSON.stringify(e) + '\n')
  } catch {
    /* disk problems must not break installs */
  }
}

function appendJobLog(jobId, line) {
  try {
    fs.mkdirSync(logDir(), { recursive: true })
    fs.appendFileSync(path.join(logDir(), `${jobId}.log`), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Snapshot / restore (belt and braces on top of the kernel's own rollback)
// ---------------------------------------------------------------------------

function snapshotProfile(label = 'manual') {
  const profile = path.join(resolveDshHome(), 'profiles', activeProfileName())
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(snapshotDir(), `${stamp}-${label}`)
  const taken = []
  fs.mkdirSync(dir, { recursive: true })
  for (const file of PROFILE_FILES) {
    const src = path.join(profile, file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, file))
      taken.push(file)
    }
  }
  pruneSnapshots(10)
  return { name: path.basename(dir), files: taken }
}

function pruneSnapshots(keep) {
  try {
    const dirs = fs
      .readdirSync(snapshotDir())
      .filter((d) => fs.statSync(path.join(snapshotDir(), d)).isDirectory())
      .sort()
    for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
      fs.rmSync(path.join(snapshotDir(), d), { recursive: true, force: true })
    }
  } catch {
    /* ignore */
  }
}

function listSnapshots() {
  try {
    return fs
      .readdirSync(snapshotDir())
      .filter((d) => fs.statSync(path.join(snapshotDir(), d)).isDirectory())
      .sort()
      .reverse()
      .map((name) => ({ name, files: fs.readdirSync(path.join(snapshotDir(), name)) }))
  } catch {
    return []
  }
}

/**
 * Restore is only safe while the app is quit; the API answers with
 * `restartRequired: true` so the UI can say so.
 */
function restoreSnapshot(name) {
  const safe = String(name ?? '').replace(/[^0-9A-Za-z-]/g, '')
  const dir = path.join(snapshotDir(), safe)
  if (!safe || !fs.existsSync(dir)) return { ok: false, error: 'snapshot not found' }
  const profile = path.join(resolveDshHome(), 'profiles', activeProfileName())
  for (const file of PROFILE_FILES) {
    const src = path.join(dir, file)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(profile, file))
  }
  return { ok: true, restartRequired: true }
}

/** The suite manages the profile it runs in; overridable for tests. */
function activeProfileName() {
  return process.env.DSH_SUITE_PROFILE ?? 'desktop'
}

function resolveDshHome() {
  if (process.env.DSH_HOME) return path.resolve(process.env.DSH_HOME)
  return path.join(os.homedir(), '.dsh')
}

// ---------------------------------------------------------------------------
// Job engine — serial install / update / uninstall queue with progress events
// ---------------------------------------------------------------------------

function enqueue(job) {
  const run = state.queueTail.then(() => executeJob(job))
  state.queueTail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function executeJob(job) {
  state.currentJob = { id: job.id, type: job.type, pack: job.pack }
  const entries = job.type === 'channel-update' ? job.entries : selectEntries(job.pack, job.ids)
  // Updates must not flip the enabled state the user chose: the kernel defaults
  // to activating bundles, which would surprise on an update — capture it up front.
  if (job.type === 'update' || job.type === 'channel-update') {
    job.enabledMap = new Map()
    try {
      const bundles = await pmCall(job.pm ?? state.pm, 'listBundles')
      for (const bundle of bundles.map(normalizeBundle).filter(Boolean)) {
        job.enabledMap.set(bundle.name, bundle.enabled)
      }
    } catch {
      /* falls back to defaultEnabled at step time */
    }
  }
  const snapshot = entries.length ? snapshotProfile(`pre-${job.type}`) : null
  emit({ type: 'job-start', jobId: job.id, jobType: job.type, pack: job.pack, total: entries.length, snapshot: snapshot?.name ?? null })
  appendJobLog(job.id, `start ${job.type} pack=${job.pack} ids=${entries.map((e) => e.id).join(',') || '*'}`)
  const results = []
  for (const entry of entries) {
    results.push(await runStep(job, entry))
  }
  // Verification pass: back-to-back pnpm operations can silently drop one
  // operation's manifest effect (observed on the real kernel). Re-check every
  // claimed-ok install against listBundles and retry the missing once. Update
  // jobs must verify the version actually moved, not just that the name exists.
  if (job.type === 'install' || job.type === 'channel-update') {
    let installed = new Map()
    try {
      const bundles = await pmCall(job.pm ?? state.pm, 'listBundles')
      installed = new Map(bundles.map((b) => normalizeBundle(b)).filter(Boolean).map((b) => [b.name, b.version]))
    } catch {
      /* no verification possible this round */
    }
    const persisted = (entry) =>
      job.type === 'channel-update'
        ? installed.get(entry.name) === entry.version
        : installed.has(entry.name)
    const persistedAfterRetry = (entry, map) =>
      job.type === 'channel-update' ? map.get(entry.name) === entry.version : map.has(entry.name)
    for (let i = 0; i < results.length; i++) {
      if (!results[i].ok || results[i].skipped) continue
      const entry = entries[i]
      if (installed.size && persisted(entry)) continue
      emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: 'install did not persist, retrying once' })
      results[i] = await runStep(job, entry)
      // After the retry, verify honestly: a kernel that still reports the old
      // state means the install never landed (e.g. a delete-pending stale
      // directory in node_modules blocks rematerialization) — surface it.
      try {
        const after = await pmCall(job.pm ?? state.pm, 'listBundles')
        const afterMap = new Map(after.map((b) => normalizeBundle(b)).filter(Boolean).map((b) => [b.name, b.version]))
        if (!persistedAfterRetry(entry, afterMap)) {
          const seen = afterMap.get(entry.name) ?? 'nothing'
          results[i] = {
            id: entry.id,
            ok: false,
            error: `install still not persisted after retry (kernel reports ${seen}); restart the app to release stale file handles, then retry`,
          }
          emit({ type: 'step-fail', jobId: job.id, id: entry.id, message: results[i].error })
        }
      } catch {
        /* verification unavailable — keep the optimistic result */
      }
    }
  }
  const ok = results.filter((r) => r.ok).length
  // Ghost sweep: install jobs must never leave undeclared residue behind —
  // a package directory in <profile>/node_modules that is in no manifest
  // (dependencies, dsh.profile.bundles, pnpm-lock, listBundles, or the shell's
  // .dsh-builtin-plugins.json marker) shadows the kernel's own copy of the
  // same name (issue #1 defect 2).
  try {
    const removed = await sweepGhosts(`post-${job.type}`, job.id)
    if (removed.length) {
      emit({ type: 'step-warn', jobId: job.id, id: 'ghost-sweep', message: `removed undeclared node_modules residue: ${removed.join(', ')}` })
      appendJobLog(job.id, `ghost-sweep removed: ${removed.join(', ')}`)
    }
  } catch (err) {
    trace('ghost-sweep-error', String(err?.stack ?? err))
  }
  emit({ type: 'job-done', jobId: job.id, jobType: job.type, pack: job.pack, ok, failed: results.length - ok })
  appendJobLog(job.id, `done ok=${ok} failed=${results.length - ok}`)
  state.currentJob = null
  return { jobId: job.id, snapshot: snapshot?.name ?? null, results }
}

function selectEntries(pack, ids) {
  const catalog = state.catalog ?? loadCatalog()
  const list = pack ? catalog.packs[pack] ?? [] : [...catalog.packs.eac, ...catalog.packs.aio, ...catalog.packs.skins]
  if (!ids?.length) return list
  const wanted = new Set(ids)
  return list.filter((e) => wanted.has(e.id))
}

/**
 * Why an install/update step must not run for this entry, if so.
 *
 * - `compat: 'eac-fork'` entries need a service only the EAC fork kernel
 *   provides (`settingsScope`); on the official kernel the row stays pending
 *   forever and web boot refuses to start (issue #1 defect 1). `defaultEnabled:
 *   false` proved not enough — the wizard/enhancement toggles can still flip
 *   them on, so the installer refuses unless the caller forces it.
 * - `kernelProvided` entries duplicate a package the kernel ships itself
 *   (app.asar/dsh/node_modules). Installing the repackaged copy drops files
 *   into `<profile>/node_modules` that shadow the official one; module
 *   resolution never falls back through, so kernel rows pointing at a
 *   subpath the repack lacks (dsh-plugin-manager `./tools`) never start and
 *   every session fails to resume (issue #1 defect 2).
 */
function installSkipReason(entry, job) {
  if (job?.force === true || job?.type === 'uninstall') return null
  if (entry.compat === 'eac-fork') {
    return {
      reason: 'compat-eac-fork',
      message: `skipped: ${entry.name} needs the EAC fork kernel (settingsScope service) — enabling it on the official kernel blocks app boot`,
    }
  }
  if (entry.kernelProvided) {
    return {
      reason: 'kernel-provided',
      message: `skipped: ${entry.name} is built into the kernel — installing a repackaged copy would shadow the official one and break session resume`,
    }
  }
  return null
}

async function runStep(job, entry) {
  const pm = job.pm ?? state.pm
  emit({ type: 'step-start', jobId: job.id, id: entry.id, name: entry.name, version: entry.version })
  let assetFailure = false
  try {
    if (job.type === 'uninstall') {
      assertManagementResult(await pmCall(pm, 'removeBundle', entry.name))
    } else {
      const skip = installSkipReason(entry, job)
      if (skip) {
        emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: skip.message })
        appendJobLog(job.id, `skip ${entry.name}: ${skip.reason}`)
        return { id: entry.id, ok: true, skipped: skip.reason }
      }
      try {
        if (job.type === 'channel-update' && entry.channelItem) {
          emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: `fetching ${entry.channelItem.file} from channel` })
          entry.cacheFile = await downloadItem(entry.channelItem, job.id)
        }
        if (job.type !== 'channel-update' && state.resources) {
          emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: 'checking pinned resource' })
          entry.cacheFile = await state.resources.ensure(entry)
        }
      } catch (err) {
        assetFailure = true
        throw err
      }
      const target = resolveTarget(entry, state.distIndex)
      const options = {}
      if (job.type === 'install') {
        // Explicit is important: the kernel defaults to activating the bundle,
        // so a user's setEnabled:false must reach the kernel as enabled:false.
        options.enabled = job.setEnabled === false ? false : entry.defaultEnabled !== false
      } else if (job.type === 'update' || job.type === 'channel-update') {
        const current = job.enabledMap?.get(entry.name)
        options.enabled = typeof current === 'boolean' ? current : entry.defaultEnabled !== false
      }
      let result = await pmCall(pm, 'installBundle', target, options)
      // pnpm blocked build scripts: approve exactly what was reported and retry once
      const pending = result?.pendingBuilds ?? []
      if (pending.length) {
        emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: `approving build scripts: ${pending.join(', ')}` })
        result = await pmCall(pm, 'installBundle', target, { ...options, approvedBuilds: pending })
      }
      assertManagementResult(result)
      if ((job.type === 'update' || job.type === 'channel-update') && typeof entry.defaultEnabled === 'boolean') {
        const current = job.enabledMap?.get(entry.name)
        await syncEnabled(pm, entry, typeof current === 'boolean' ? current : entry.defaultEnabled !== false, job.id)
      }
    }
    emit({ type: 'step-ok', jobId: job.id, id: entry.id })
    appendJobLog(job.id, `ok ${entry.name}@${entry.version}`)
    return { id: entry.id, ok: true }
  } catch (err) {
    // Incompatible peer on this kernel: grant an exact-version exemption
    // (acceptRisk) and retry once — matches the kernel's own escape hatch.
    const message = String(err?.message ?? err)
    if (!assetFailure && job.type !== 'uninstall' && job.exempt !== false && /incompat|peer|version/i.test(message)) {
      const runtime = (message.match(/\d+\.\d+\.\d+-(?:rc|alpha|beta)[.\w]*/) ?? [SUITE_RUNTIME])[0]
      try {
        emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: `granting version exemption for ${entry.name}@${entry.version} on ${runtime}` })
        await pmCall(pm, 'setVersionExemption', `${entry.name}@${entry.version}`, runtime, true, true)
        const target = resolveTarget(entry, state.distIndex)
        const options =
          job.type === 'install'
            ? { enabled: job.setEnabled !== false && entry.defaultEnabled !== false }
            : {
                enabled:
                  typeof job.enabledMap?.get(entry.name) === 'boolean'
                    ? job.enabledMap.get(entry.name)
                    : entry.defaultEnabled !== false,
              }
        assertManagementResult(await pmCall(pm, 'installBundle', target, options))
        emit({ type: 'step-ok', jobId: job.id, id: entry.id, message: 'installed with version exemption' })
        appendJobLog(job.id, `ok(exempt) ${entry.name}@${entry.version}`)
        return { id: entry.id, ok: true, exempt: true }
      } catch (err2) {
        const message2 = String(err2?.message ?? err2)
        emit({ type: 'step-fail', jobId: job.id, id: entry.id, message: message2 })
        appendJobLog(job.id, `FAIL ${entry.name}@${entry.version}: ${message2}`)
        return { id: entry.id, ok: false, error: message2 }
      }
    }
    // The kernel refuses a duplicate install with ManagementFailure
    // ("already-installed"). That is the normal steady state of a pack whose
    // items are all present — reporting it as a red failure made every
    // back-to-back pack run look like a mass outage ("ok=5 failed=43" with
    // zero real failures). Count it as a skipped success instead, matching the
    // compat/kernel-provided skips above.
    if (job.type !== 'uninstall' && /already-installed/i.test(message)) {
      emit({ type: 'step-warn', jobId: job.id, id: entry.id, message: 'already installed' })
      appendJobLog(job.id, `skip ${entry.name}: already-installed`)
      return { id: entry.id, ok: true, skipped: 'already-installed' }
    }
    emit({ type: 'step-fail', jobId: job.id, id: entry.id, message })
    appendJobLog(job.id, `FAIL ${entry.name}@${entry.version}: ${message}`)
    return { id: entry.id, ok: false, error: message }
  }
}

/** Kernel runtime the catalog targets; used as the exemption fallback. */
const SUITE_RUNTIME = '0.2.0-rc.2'

/**
 * Names of the desktop-side built-in plugins, taken from the marker the EAC
 * desktop shell writes into the profile (`.dsh-builtin-plugins.json`).
 *
 * The shell copies those packages into `<profile>/node_modules` on every boot
 * (companion sync) and deliberately keeps them out of the profile manifests,
 * so they satisfy none of the declaration guards below. Without this guard the
 * sweep would treat them as residue and delete them on every boot, which
 * silently drops the whole built-in plugin set.
 *
 * Fails safe: a missing or malformed marker yields an empty set, which is
 * exactly the previous behaviour (such packages get swept) rather than a
 * blanket exemption.
 */
function readBuiltinPluginNames(profile) {
  const marker = readJson(path.join(profile, '.dsh-builtin-plugins.json'))
  const names = marker?.names
  if (!Array.isArray(names)) return new Set()
  return new Set(names.filter((name) => typeof name === 'string' && name))
}

/**
 * Remove "ghost" packages from `<profile>/node_modules`: directories (or
 * links) named after a catalog entry that appear in NO manifest — not in the
 * profile's package.json dependencies, not in `dsh.profile.bundles`, not in
 * pnpm-lock.yaml, not reported by listBundles, and not declared as a desktop
 * built-in plugin by the shell's marker file.
 *
 * Such residue is exactly how issue #1 defect 2 poisoned profiles: the
 * repackaged `@deepseek-ai/dsh-plugin-manager@0.1.0` was left on disk without
 * any declaration, shadowed the kernel's official package, and broke session
 * resume profile-wide. Sweeping at boot and after every job makes affected
 * installs self-heal on the next suite start.
 */
async function sweepGhosts(reason = 'boot', jobId = null) {
  const catalog = state.catalog ?? loadCatalog()
  const names = new Set()
  for (const list of [...Object.values(catalog.packs), catalog.retired ?? []]) {
    for (const entry of list ?? []) {
      if (entry?.name) names.add(entry.name)
    }
  }
  if (!names.size) return []
  const profile = path.join(resolveDshHome(), 'profiles', activeProfileName())
  const nmDir = path.join(profile, 'node_modules')
  if (!fs.existsSync(nmDir)) return []
  const pkg = readJson(path.join(profile, 'package.json')) ?? {}
  const deps = pkg.dependencies ?? {}
  const bundleList = pkg?.dsh?.profile?.bundles ?? []
  const declaredBundles = new Set(Array.isArray(bundleList) ? bundleList : [])
  const lockText = readFileOrNull(path.join(profile, 'pnpm-lock.yaml')) ?? ''
  const builtinNames = readBuiltinPluginNames(profile)
  let installed = new Set()
  try {
    for (const bundle of await pmCall(state.pm, 'listBundles')) {
      const normalized = normalizeBundle(bundle)
      if (normalized?.name) installed.add(normalized.name)
    }
  } catch {
    /* listBundles unavailable — manifest guards below still apply */
  }
  const removed = []
  for (const name of names) {
    const dir = path.join(nmDir, ...name.split('/'))
    let stat
    try {
      stat = fs.lstatSync(dir)
    } catch {
      continue
    }
    const guards = [
      [name in deps, 'dependencies'],
      [declaredBundles.has(name), 'dsh.profile.bundles'],
      [lockText.includes(`${name}@`), 'pnpm-lock.yaml'],
      [installed.has(name), 'listBundles'],
      [builtinNames.has(name), '.dsh-builtin-plugins.json'],
    ].filter(([hit]) => hit)
    if (guards.length) {
      trace('ghost-sweep-keep', `${name} declared via ${guards.map(([, via]) => via).join('+')} (${reason})`)
      continue
    }
    try {
      if (stat.isSymbolicLink() || stat.isFile()) fs.rmSync(dir, { force: true, maxRetries: 5, retryDelay: 200 })
      else fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      if (fs.existsSync(dir)) throw new Error('directory still present after removal (file handles held?)')
      removed.push(name)
      trace('ghost-sweep-remove', `${name} (${reason}, ${stat.isDirectory() ? 'dir' : 'link'})`)
      if (jobId) appendJobLog(jobId, `ghost-sweep removed ${name}`)
    } catch (err) {
      trace('ghost-sweep-fail', `${name}: ${String(err?.message ?? err)}`)
    }
  }
  return removed
}

/**
 * Uninstall any INSTALLED `kernelProvided` entries, however they got there.
 *
 * Runs OFFLINE at apply-start — deliberately not waiting for the pluginManager
 * binding: a present repackaged copy shadows the kernel's own package, which
 * kills the pluginManager service itself (real-machine finding, issue #1
 * defect 2), so a pm-dependent cleanup would deadlock on exactly the state it
 * exists to fix. The profile edit is a plain manifest rewrite; the kernel's
 * profile watcher reconciles pnpm-lock/node_modules from it. Any still-held
 * file handles simply fail the rm and retry on the next boot.
 */
async function retireKernelProvided(jobId = null) {
  const catalog = state.catalog ?? loadCatalog()
  const entries = [...Object.values(catalog.packs).flat(), ...(catalog.retired ?? [])].filter(
    (e) => e?.kernelProvided,
  )
  if (!entries.length) return []
  const profile = path.join(resolveDshHome(), 'profiles', activeProfileName())
  const nmDir = path.join(profile, 'node_modules')
  const pkgFile = path.join(profile, 'package.json')
  const pkg = readJson(pkgFile)
  if (!pkg) return []
  let manifestDirty = false
  const removed = []
  for (const entry of entries) {
    const dir = path.join(nmDir, ...entry.name.split('/'))
    let stat
    try {
      stat = fs.lstatSync(dir)
    } catch {
      continue
    }
    // Manifest first: drop the dependency and any bundle row, so the kernel's
    // profile watcher (and every later pnpm run) sees a clean declaration.
    if (pkg.dependencies && ObjectOwn(pkg.dependencies, entry.name)) {
      delete pkg.dependencies[entry.name]
      manifestDirty = true
    }
    const bundles = pkg?.dsh?.profile?.bundles
    if (Array.isArray(bundles) && bundles.includes(entry.name)) {
      pkg.dsh.profile.bundles = bundles.filter((n) => n !== entry.name)
      manifestDirty = true
    }
    try {
      if (stat.isSymbolicLink() || stat.isFile()) fs.rmSync(dir, { force: true, maxRetries: 5, retryDelay: 200 })
      else fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      if (fs.existsSync(dir)) throw new Error('still present (file handles held?)')
      removed.push(entry.name)
      trace('retire-kernel-provided', `${entry.name} (${stat.isDirectory() ? 'dir' : 'link'}, declared=${manifestDirty})`)
      if (jobId) appendJobLog(jobId, `retire ${entry.name} (kernel-provided)`)
      emit({
        type: 'step-warn',
        jobId: jobId ?? 'retire',
        id: entry.id,
        message: `${entry.name} uninstalled: the kernel ships its own official copy (issue #1 defect 2)`,
      })
    } catch (err) {
      trace('retire-kernel-provided-fail', `${entry.name}: ${String(err?.message ?? err)}`)
    }
  }
  if (manifestDirty) {
    try {
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
      trace('retire-kernel-provided', 'profile package.json rewritten')
    } catch (err) {
      trace('retire-kernel-provided-fail', `manifest rewrite failed: ${String(err?.message ?? err)}`)
    }
  }
  if (removed.length) {
    try {
      const leftovers = await sweepGhosts('post-retire', jobId)
      if (leftovers.length) trace('retire-swept', leftovers.join(', '))
    } catch {
      /* best effort */
    }
  }
  return removed
}

function ObjectOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

async function syncEnabled(pm, entry, enabled, jobId = 'n/a') {
  try {
    await pmCall(pm, 'setBundleEnabled', entry.name, enabled)
  } catch {
    try {
      await pmCall(pm, 'setBundleEnabled', entry.id, enabled)
    } catch (err) {
      emit({ type: 'step-warn', jobId, id: entry.id, message: `could not set enabled=${enabled}: ${String(err?.message ?? err)}` })
    }
  }
}

// ---------------------------------------------------------------------------
// Status — installed state projected onto the catalog
// ---------------------------------------------------------------------------

async function buildStatus() {
  const catalog = state.catalog
  let bundles = []
  try {
    bundles = (await pmCall(state.pm, 'listBundles')).map(normalizeBundle).filter(Boolean)
  } catch (err) {
    return { error: `listBundles failed: ${String(err?.message ?? err)}`, packs: catalog.packs, retired: catalog.retired }
  }
  const installed = new Map(bundles.map((b) => [b.name, b]))
  const project = (entries) =>
    entries.map((entry) => {
      const found = installed.get(entry.name)
      const updateAvailable = found ? cmpVersions(entry.version, found.version) > 0 : false
      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        installedVersion: found?.version ?? null,
        installed: Boolean(found),
        enabled: found?.enabled ?? null,
        updateAvailable,
        tier: entry.tier ?? 'core',
        defaultEnabled: entry.defaultEnabled !== false,
        compat: entry.compat ?? null,
        kernelProvided: Boolean(entry.kernelProvided),
        titleZh: entry.titleZh ?? entry.name,
        titleEn: entry.titleEn ?? entry.name,
        descZh: entry.descZh ?? '',
        descEn: entry.descEn ?? '',
        source: entry.source ?? null,
        license: entry.license ?? null,
        notes: entry.notes ?? '',
      }
    })
  const packs = {}
  for (const pack of PACK_IDS) packs[pack] = project(catalog.packs[pack])
  return {
    suiteVersion: SUITE_VERSION,
    resources: state.resources?.snapshot() ?? null,
    packs,
    retired: catalog.retired,
    bundles,
    currentJob: state.currentJob,
  }
}

// ---------------------------------------------------------------------------
// Channel — online update engine (probe → download → sha256 → install)
// ---------------------------------------------------------------------------

const CHANNEL_INDEX_URLS = [
  // jsDelivr first: it serves the same repo file and is reachable from more
  // networks (raw.githubusercontent TLS fails on some CN setups).
  'https://cdn.jsdelivr.net/gh/DSH-EAC/EAC-Pack@main/channel/channel.json',
  'https://raw.githubusercontent.com/DSH-EAC/EAC-Pack/main/channel/channel.json',
]
const CHANNEL_ASSET_BASE = 'https://github.com/DSH-EAC/EAC-Pack/releases/download/channel'
const PROBE_TIMEOUT_MS = 8000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const DOWNLOAD_PROGRESS_TICK = 256 * 1024

function cacheDir() {
  return path.join(dataDir(), 'cache')
}

function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function defaultChannelConfig() {
  return {
    autoUpdate: true,
    autoUpdateHeavy: false,
    mirror: null,
    intervalHours: 6,
    lastCheckedAt: null,
    channelState: 'never',
    channel: null,
  }
}

function loadChannelConfig() {
  const cfg = { ...defaultChannelConfig(), ...readJson(path.join(dataDir(), 'config.json')) }
  const hours = Number(cfg.intervalHours)
  cfg.intervalHours = hours >= 1 ? hours : 6
  if (typeof cfg.mirror === 'string') cfg.mirror = cfg.mirror.replace(/\/+$/, '') || null
  return cfg
}

function saveChannelConfig(patch) {
  const clean = {}
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value !== undefined) clean[key] = value
  }
  if (typeof clean.mirror === 'string') clean.mirror = clean.mirror.replace(/\/+$/, '') || null
  const cfg = { ...loadChannelConfig(), ...clean }
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(path.join(dataDir(), 'config.json'), JSON.stringify(cfg, null, 2) + '\n')
  } catch {
    /* disk problems must not break the updater */
  }
  return cfg
}

async function fetchJson(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const fetchImpl = state.fetchImpl ?? globalThis.fetch
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Probe the channel manifest; on total failure degrade to offline (never throw). */
async function probeChannel() {
  const cfg = state.channelCfg ?? (state.channelCfg = loadChannelConfig())
  const urls = []
  if (cfg.mirror) urls.push(`${String(cfg.mirror).replace(/\/+$/, '')}/${CHANNEL_INDEX_URLS[0]}`)
  urls.push(...CHANNEL_INDEX_URLS)
  let lastError = null
  for (const url of urls) {
    try {
      const manifest = await fetchJson(url)
      if (!manifest || typeof manifest.channelVersion !== 'number' || !Array.isArray(manifest.items)) {
        throw new Error('channel manifest malformed')
      }
      state.channel = manifest
      state.channelCfg = saveChannelConfig({
        channelState: 'online',
        lastCheckedAt: new Date().toISOString(),
        channel: {
          channelVersion: manifest.channelVersion,
          generatedAt: manifest.generatedAt ?? null,
          suiteVersion: manifest.suiteVersion ?? null,
          notesZh: manifest.notesZh ?? null,
          notesEn: manifest.notesEn ?? null,
        },
      })
      emit({ type: 'channel', state: 'online', channelVersion: manifest.channelVersion })
      trace('channel-probe', `online v${manifest.channelVersion} items=${manifest.items.length} via ${url}`)
      return manifest
    } catch (err) {
      lastError = err
      trace('channel-probe', `miss ${url}: ${String(err?.message ?? err)}`)
    }
  }
  state.channel = null
  state.channelCfg = saveChannelConfig({ channelState: 'offline', lastCheckedAt: new Date().toISOString() })
  emit({ type: 'channel', state: 'offline' })
  trace('channel-probe', `offline: ${String(lastError?.message ?? lastError)}`)
  return null
}

function assetUrl(file) {
  const mirror = state.channelCfg?.mirror
  const base = mirror ? `${String(mirror).replace(/\/+$/, '')}/${CHANNEL_ASSET_BASE}` : CHANNEL_ASSET_BASE
  return `${base}/${file}`
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

async function streamDownload(url, dest, onProgress) {
  const fetchImpl = state.fetchImpl ?? globalThis.fetch
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
  const total = Number(res.headers?.get?.('content-length') ?? -1)
  let received = 0
  let lastTick = 0
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        received += chunk.length
        if (received - lastTick >= DOWNLOAD_PROGRESS_TICK) {
          lastTick = received
          onProgress?.(received, total)
        }
        yield chunk
      }
    },
    fs.createWriteStream(dest),
  )
  onProgress?.(received, total)
  return received
}

/** Download a channel tarball into the cache; verifies sha256, retries once. */
async function downloadItem(item, jobId = 'n/a') {
  fs.mkdirSync(cacheDir(), { recursive: true })
  const file = path.join(cacheDir(), item.file)
  if (fs.existsSync(file)) {
    const hash = await sha256File(file)
    if (!item.sha256 || hash === item.sha256) return file
    fs.rmSync(file, { force: true })
  }
  const url = assetUrl(item.file)
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const tmp = `${file}.part`
    try {
      appendJobLog(jobId, `download ${item.file} (attempt ${attempt})`)
      const received = await streamDownload(url, tmp, (rec, total) =>
        emit({ type: 'download-progress', id: item.id ?? item.name, received: rec, total }),
      )
      const hash = await sha256File(tmp)
      if (item.sha256 && hash !== item.sha256) throw new Error(`sha256 mismatch for ${item.file}: got ${hash}`)
      fs.renameSync(tmp, file)
      appendJobLog(jobId, `download ok ${item.file} bytes=${received}`)
      return file
    } catch (err) {
      lastError = err
      fs.rmSync(tmp, { force: true })
      if (attempt < 2) {
        emit({
          type: 'step-warn',
          jobId,
          id: item.id ?? item.name,
          message: `download failed (${String(err?.message ?? err)}), retrying once`,
        })
      }
    }
  }
  throw lastError
}

async function buildChannelStatus() {
  const cfg = state.channelCfg ?? loadChannelConfig()
  const hours = Number(cfg.intervalHours) >= 1 ? Number(cfg.intervalHours) : 6
  const status = {
    state: cfg.channelState ?? 'never',
    autoUpdate: cfg.autoUpdate !== false,
    autoUpdateHeavy: Boolean(cfg.autoUpdateHeavy),
    mirror: cfg.mirror ?? null,
    intervalHours: hours,
    lastCheckedAt: cfg.lastCheckedAt ?? null,
    nextCheckAt:
      state.timers.length && cfg.lastCheckedAt && !Number.isNaN(Date.parse(cfg.lastCheckedAt))
        ? new Date(Date.parse(cfg.lastCheckedAt) + hours * 3_600_000).toISOString()
        : null,
    channelVersion: state.channel?.channelVersion ?? cfg.channel?.channelVersion ?? null,
    channelGeneratedAt: state.channel?.generatedAt ?? cfg.channel?.generatedAt ?? null,
    notesZh: state.channel?.notesZh ?? cfg.channel?.notesZh ?? null,
    notesEn: state.channel?.notesEn ?? cfg.channel?.notesEn ?? null,
    updates: [],
    suiteUpdate: null,
    error: null,
  }
  if (!state.channel) return status
  const catalog = state.catalog ?? loadCatalog()
  const byName = new Map()
  const byId = new Map()
  for (const list of Object.values(catalog.packs)) {
    for (const entry of list) {
      byName.set(entry.name, entry)
      byId.set(entry.id, entry)
    }
  }
  const installedMap = new Map()
  try {
    for (const bundle of await pmCall(state.pm, 'listBundles')) {
      const normalized = normalizeBundle(bundle)
      if (normalized) installedMap.set(normalized.name, normalized)
    }
  } catch (err) {
    status.error = `listBundles failed: ${String(err?.message ?? err)}`
  }
  status.updates = state.channel.items
    .map((item) => {
      const cat = byName.get(item.name) ?? byId.get(item.id)
      return { item, cat, inst: installedMap.get(item.name) }
    })
    .filter(({ item, cat, inst }) => {
      // compat/kernelProvided entries never update via the channel — install
      // steps skip them, so listing them as updatable would only mislead.
      if (cat?.compat || cat?.kernelProvided) return false
      const reference = inst?.version ?? cat?.version ?? null
      return reference ? cmpVersions(item.version, reference) > 0 : false
    })
    .map(({ item, cat, inst }) => ({
      id: cat?.id ?? item.id ?? item.name,
      name: item.name,
      installedVersion: inst?.version ?? null,
      channelVersion: item.version,
      tier: cat?.tier ?? 'visual',
      packs: item.packs ?? cat?.packs ?? [],
      installed: Boolean(inst),
      compat: cat?.compat ?? null,
      kernelProvided: Boolean(cat?.kernelProvided),
      titleZh: cat?.titleZh ?? item.name,
      titleEn: cat?.titleEn ?? item.name,
    }))
  const suite = state.channel.suite
  if (suite?.version && cmpVersions(suite.version, SUITE_VERSION) > 0) {
    status.suiteUpdate = {
      version: suite.version,
      file: suite.file ?? null,
      sha256: suite.sha256 ?? null,
      downloadUrl: suite.downloadUrl ?? (suite.file ? `https://github.com/DSH-EAC/EAC-Pack/releases/download/v${suite.version}/${suite.file}` : null),
    }
  }
  return status
}

/** Channel items → job entries (catalog metadata merged, cacheFile filled at step time). */
function buildChannelEntries(ids) {
  const items = state.channel?.items ?? []
  const catalog = state.catalog ?? loadCatalog()
  const byName = new Map()
  const byId = new Map()
  for (const list of Object.values(catalog.packs)) {
    for (const entry of list) {
      byName.set(entry.name, entry)
      byId.set(entry.id, entry)
    }
  }
  const entries = []
  for (const key of (ids ?? []).map(String)) {
    const item = items.find((i) => i.name === key || i.id === key)
    if (!item) continue
    const cat = byName.get(item.name) ?? byId.get(item.id)
    entries.push({
      ...(cat ?? {}),
      id: cat?.id ?? item.id ?? item.name,
      name: item.name,
      version: item.version,
      tier: cat?.tier ?? 'visual',
      defaultEnabled: cat?.defaultEnabled ?? false,
      channelItem: item,
    })
  }
  return entries
}

function enqueueChannelUpdate(ids) {
  if (!state.channel) throw new Error('channel manifest not loaded — run /channel/check first')
  const entries = buildChannelEntries(ids)
  if (!entries.length) throw new Error('no channel items matched the requested ids')
  const job = { id: `chan-${Date.now()}`, type: 'channel-update', pm: state.pm, entries }
  enqueue(job)
  return job.id
}

function rescheduleAutoCheck() {
  for (const timer of state.timers) {
    clearTimeout(timer)
    clearInterval(timer)
  }
  state.timers = []
  if (process.env.DSH_SUITE_NO_AUTOCHECK === '1') return
  const cfg = state.channelCfg ?? loadChannelConfig()
  const hours = Number(cfg.intervalHours) >= 1 ? Number(cfg.intervalHours) : 6
  const first = setTimeout(() => void autoCheck(), 60_000)
  const repeat = setInterval(() => void autoCheck(), hours * 3_600_000)
  for (const timer of [first, repeat]) timer.unref?.()
  state.timers = [first, repeat]
}

/** Startup + periodic check. Auto-applies installed-item updates when enabled. */
async function autoCheck() {
  try {
    const manifest = await probeChannel()
    if (!manifest) return
    const cfg = state.channelCfg ?? loadChannelConfig()
    if (cfg.autoUpdate === false) return
    if (state.lastAutoApply.channelVersion === manifest.channelVersion) return
    const status = await buildChannelStatus()
    const ids = status.updates
      .filter((u) => u.installed && (u.tier !== 'heavy' || cfg.autoUpdateHeavy))
      .map((u) => u.name)
    if (!ids.length) return
    state.lastAutoApply = { channelVersion: manifest.channelVersion, at: Date.now() }
    const jobId = enqueueChannelUpdate(ids)
    trace('auto-update', `channel v${manifest.channelVersion}: ${ids.join(',')} job=${jobId}`)
    emit({ type: 'step-start', jobId, id: 'auto-update', message: `auto-update to channel v${manifest.channelVersion}` })
  } catch (err) {
    trace('auto-check-error', String(err?.stack ?? err))
  }
}

function loadGallery() {
  if (state.gallery !== undefined) return state.gallery
  state.gallery = JSON.parse(readVerifiedAsset(assetDirectory(), resourceManifest(), 'gallery.json').toString('utf8'))
  return state.gallery
}

function loadPrompt(id) {
  const safe = String(id ?? '').replace(/[^a-z0-9-]/g, '')
  const assets = assetDirectory(), manifest = resourceManifest()
  const read = file => manifest.extraFiles.some(i => i.file === file) ? readVerifiedAsset(assets, manifest, file).toString('utf8') : null
  const metadata = read(`prompts/${safe}/manifest.json`)
  return { id: safe, manifest: metadata ? JSON.parse(metadata) : null, prompt: read(`prompts/${safe}/prompt.md`) }
}

function servePreview(res, id, theme) {
  const file = `previews/${id}/${theme}.png`
  // Buffer + single res.end(): the dsh-app fetch bridge captures the body from
  // res.end (streamed pipes never reach it and surface as empty/failed fetches).
  let data
  try {
    data = readVerifiedAsset(assetDirectory(), resourceManifest(), file)
  } catch {
    return json(res, 404, { error: 'preview not found' })
  }
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' })
  res.end(data)
}



// ---------------------------------------------------------------------------
// HTTP API (mounted lazily on webServer)
// ---------------------------------------------------------------------------

// Git packages keep their manifest at the root; Release packages are flat.
const PACKAGE_INFO = readJson(path.join(PKG_DIR, 'package.json')) ?? readJson(path.join(PKG_DIR, '..', 'package.json'))
const SUITE_VERSION = PACKAGE_INFO?.version ?? ''

function resourceManifest() { return readJson(path.join(PKG_DIR, 'assets', 'bootstrap.json')) }
function assetDirectory(pkgDir = PKG_DIR, manifest = resourceManifest()) { return resolveAssetPackage(pkgDir, manifest) }
function resourceDirectory(pkgDir = PKG_DIR, manifest = resourceManifest()) { return path.join(assetDirectory(pkgDir, manifest), 'payload') }

function createResources(manifest = resourceManifest()) {
  let assets, resolutionError
  try { assets = assetDirectory(PKG_DIR, manifest) } catch (error) { resolutionError = error }
  return new ResourceManager({
    manifest,
    cacheDir: path.join(dataDir(), 'resources'),
    bundledDir: assets ? path.join(assets, 'payload') : '',
    validateInstall() { if (resolutionError) throw resolutionError; verifyAssetPackage(assets, manifest) },
    onProgress: resources => emit({ type: 'resources', resources }),
  })
}

function completeResources() {
  if (!state.resources) return null
  const manager = state.resources
  return manager.hydrate().catch(err => {
    trace('resources-error', String(err?.message ?? err))
    return manager.snapshot()
  })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`))
      }
    })
    req.on('error', reject)
  })
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

/**
 * Enable/disable one catalog entry with the guards the HTTP route enforces.
 *
 * Skin mutual exclusion lives here (and only here): the catalogs declare it on
 * every skins-pack row (`mutexZh`/`mutexEn` — "client-ui skins are mutually
 * exclusive, do not stack"), but nothing used to enforce it, so enabling a
 * second skin stacked two global stylesheets and two decoration layers on top
 * of each other and garbled the official web UI. Enabling a skins-pack entry
 * now switches: every other enabled skins-pack bundle is disabled first and
 * reported in `switchedOff`. `force: true` keeps the old stacking behavior for
 * debugging. Non-skin entries are untouched by the sweep.
 */
async function enableEntry(body) {
  const catalog = state.catalog
  const all = [...catalog.packs.eac, ...catalog.packs.aio, ...catalog.packs.skins]
  const entry = all.find((e) => e.id === body.id || e.name === body.id)
  if (!entry) return { status: 404, payload: { error: 'unknown id' } }
  // Enable-time guard (issue #1): install-time skips are not enough —
  // the kernel's own plugin page can still flip these on. The suite at
  // least refuses to be the one that bricks the app.
  if (entry.compat === 'eac-fork' && body.force !== true) {
    return {
      status: 409,
      payload: {
        error: `${entry.name} requires the EAC fork kernel (service settingsScope) — enabling it on the official kernel blocks app boot (issue #1 defect 1)`,
        compat: 'eac-fork',
      },
    }
  }
  if (entry.kernelProvided && body.force !== true) {
    return {
      status: 409,
      payload: {
        error: `${entry.name} is built into the kernel — enabling a repackaged copy shadows the official one and breaks session resume (issue #1 defect 2); uninstall it instead`,
        kernelProvided: true,
      },
    }
  }
  const enabling = body.enabled !== false
  const switchedOff = []
  if (enabling && body.force !== true && entry.packs?.includes('skins')) {
    const status = await buildStatus()
    const others = (status.bundles ?? []).filter(
      (b) => b.enabled === true && b.name !== entry.name && catalog.packs.skins.some((s) => s.name === b.name),
    )
    for (const bundle of others) {
      const other = catalog.packs.skins.find((s) => s.name === bundle.name)
      await syncEnabled(state.pm, other, false)
      switchedOff.push(other.name)
    }
  }
  await syncEnabled(state.pm, entry, enabling)
  return { status: 200, payload: { ok: true, ...(switchedOff.length ? { switchedOff } : {}) } }
}

function createApiHandler(ctx) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const routePath = url.pathname.replace(/^\/api\/eac-plugin-suite/, '').replace(/\/+$/, '') || '/'
    const method = String(req.method ?? 'GET').toUpperCase()
    try {
      if (routePath === '/events' && method === 'GET') return sse(req, res)
      if (routePath === '/catalog' && method === 'GET') {
        return json(res, 200, { suiteVersion: SUITE_VERSION, ...state.catalog, dist: state.distIndex.map(({ id, name, version, file, bytes }) => ({ id, name, version, file, bytes })) })
      }
      if (routePath === '/status' && method === 'GET') return json(res, 200, await buildStatus())
      if (routePath === '/events-ring' && method === 'GET') return json(res, 200, { events: state.events })
      if (routePath === '/snapshots' && method === 'GET') return json(res, 200, { snapshots: listSnapshots() })
      if (routePath === '/channel/status' && method === 'GET') return json(res, 200, await buildChannelStatus())
      if (routePath === '/skins/gallery' && method === 'GET') {
        const gallery = loadGallery()
        return gallery ? json(res, 200, gallery) : json(res, 404, { error: 'gallery not bundled in this build' })
      }
      if (routePath === '/prompts' && method === 'GET') {
        const gallery = loadGallery()
        return json(res, 200, { prompts: (gallery?.skins ?? []).map((s) => ({ id: s.id, name: s.name, hasPrompt: Boolean(s.prompt) })) })
      }
      const promptMatch = routePath.match(/^\/prompts\/([a-z0-9-]+)$/)
      if (promptMatch && method === 'GET') return json(res, 200, loadPrompt(promptMatch[1]))
      const previewMatch = routePath.match(/^\/asset\/previews\/([a-z0-9-]+)\/(light|dark)\.png$/)
      if (previewMatch && method === 'GET') return servePreview(res, previewMatch[1], previewMatch[2])
      if (method === 'POST') {
        const body = await readBody(req)
        if (routePath === '/resources/retry') {
          if (!state.resources) return json(res, 409, { error: 'local resource verification unavailable' })
          completeResources()
          return json(res, 202, state.resources.snapshot())
        }
        if (routePath === '/install') {
          const job = { id: `job-${Date.now()}`, type: 'install', pm: state.pm, pack: body.pack ?? null, ids: body.ids ?? null, setEnabled: body.setEnabled !== false, force: body.force === true }
          if (!job.pack && !job.ids?.length) return json(res, 400, { error: 'pack or ids required' })
          enqueue(job)
          return json(res, 202, { jobId: job.id, poll: '/api/eac-plugin-suite/events', note: 'a profile snapshot is taken automatically when the job starts' })
        }
        if (routePath === '/update') {
          const job = { id: `job-${Date.now()}`, type: 'update', pm: state.pm, pack: body.pack ?? null, ids: body.ids ?? null }
          enqueue(job)
          return json(res, 202, { jobId: job.id })
        }
        if (routePath === '/uninstall') {
          if (!body.ids?.length) return json(res, 400, { error: 'ids required' })
          const job = { id: `job-${Date.now()}`, type: 'uninstall', pm: state.pm, pack: body.pack ?? null, ids: body.ids }
          enqueue(job)
          return json(res, 202, { jobId: job.id })
        }
        if (routePath === '/enable') {
          const result = await enableEntry(body)
          return json(res, result.status, result.payload)
        }
        if (routePath === '/skins/reset') {
          // Escape hatch for a wedged skin stack: disable every enabled
          // skins-pack bundle at once and report the names, so the official
          // default look is one click away even when the settings page itself
          // is buried under stacked skin chrome (see the mutex guard above).
          const catalog = state.catalog
          const skins = catalog.packs.skins
          const status = await buildStatus()
          const enabled = (status.bundles ?? []).filter((b) => b.enabled === true && skins.some((s) => s.name === b.name))
          const switchedOff = []
          for (const bundle of enabled) {
            const entry = skins.find((s) => s.name === bundle.name)
            await syncEnabled(state.pm, entry, false)
            switchedOff.push(entry.name)
          }
          return json(res, 200, { ok: true, switchedOff })
        }
        if (routePath === '/channel/check') {
          await probeChannel()
          return json(res, 200, await buildChannelStatus())
        }
        if (routePath === '/channel/config') {
          const cfg = saveChannelConfig({
            autoUpdate: typeof body.autoUpdate === 'boolean' ? body.autoUpdate : undefined,
            autoUpdateHeavy: typeof body.autoUpdateHeavy === 'boolean' ? body.autoUpdateHeavy : undefined,
            mirror: body.mirror !== undefined ? (body.mirror ? String(body.mirror) : null) : undefined,
            intervalHours: body.intervalHours !== undefined ? Number(body.intervalHours) : undefined,
          })
          rescheduleAutoCheck()
          return json(res, 200, cfg)
        }
        if (routePath === '/channel/apply') {
          if (!state.channel) return json(res, 409, { error: 'channel offline — run POST /channel/check first' })
          if (!Array.isArray(body.ids) || !body.ids.length) return json(res, 400, { error: 'ids required' })
          let jobId
          try {
            jobId = enqueueChannelUpdate(body.ids)
          } catch (err) {
            return json(res, 400, { error: String(err?.message ?? err) })
          }
          return json(res, 202, { jobId })
        }
        if (routePath === '/snapshot') return json(res, 200, snapshotProfile(String(body.label ?? 'manual')))
        if (routePath === '/restore') return json(res, 200, restoreSnapshot(body.snapshot))
      }
      return json(res, 404, { error: `no route ${method} ${routePath}` })
    } catch (err) {
      return json(res, 500, { error: String(err?.message ?? err) })
    }
  }
}

function sse(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  for (const e of state.events) res.write(`data: ${JSON.stringify(e)}\n\n`)
  const listener = (e) => {
    try {
      res.write(`data: ${JSON.stringify(e)}\n\n`)
    } catch {
      /* socket died */
    }
  }
  state.listeners.add(listener)
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* socket died */
    }
  }, 15000)
  req.on('close', () => {
    clearInterval(heartbeat)
    state.listeners.delete(listener)
  })
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

/** Persist a diagnostic trace line so a headless host can be debugged later. */
function trace(tag, detail = '') {
  try {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.appendFileSync(path.join(dataDir(), 'trace.log'), `[${new Date().toISOString()}] ${tag} ${detail}\n`)
  } catch {
    /* ignore */
  }
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? {}
  trace('apply-start')
  try {
    state.ctx = ctx
    state.gallery = undefined
    state.catalog = loadCatalog()
    state.distIndex = loadDistIndex()
    state.channelCfg = loadChannelConfig()
    state.resources?.dispose()
    state.resources = null
    if (process.env.DSH_SUITE_NO_RESOURCES !== '1') {
      const resources = createResources()
      state.resources = resources
      ctx.effect?.(() => () => resources.dispose(), 'eac-plugin-suite: resource lifecycle')
      completeResources()
    }
    rescheduleAutoCheck()

    // Boot self-heal runs BEFORE any service dependency: a plugin-manager
    // ghost in <profile>/node_modules blocks the pluginManager service itself
    // from ever being delivered (issue #1 defect 2, real-machine finding), so
    // waiting for that binding would deadlock the cleanup. The manifest
    // guards (dependencies / dsh.profile.bundles / pnpm-lock) need no kernel.
    sweepGhosts('boot')
      .then((removed) => {
        if (removed.length) logger.info?.(`[eac-plugin-suite] ghost sweep removed: ${removed.join(', ')}`)
      })
      .catch((err) => trace('ghost-sweep-boot-error', String(err?.stack ?? err)))
    retireKernelProvided('boot')
      .then((removed) => {
        if (removed.length) logger.info?.(`[eac-plugin-suite] retired kernel-provided duplicates: ${removed.join(', ')}`)
      })
      .catch((err) => trace('retire-boot-error', String(err?.stack ?? err)))

    const counts = Object.entries(state.catalog.packs)
      .map(([pack, list]) => `${pack}=${list.length}`)
      .join(' ')
    logger.info?.(`[eac-plugin-suite] catalog loaded (${counts}), dist tarballs: ${state.distIndex.length}`)

    // pluginManager resolves lazily: the installer API reports a clear error
    // until the service shows up instead of failing the plugin start.
    ctx.inject?.(['pluginManager'], (scoped) => {
      state.pm = scoped.pluginManager
      trace('pluginManager', state.pm ? 'resolved' : 'null')
      logger.info?.('[eac-plugin-suite] pluginManager service bound')
      // pm is bound: run a second sweep pass that also honors the listBundles
      // guard. The retire of kernel-provided duplicates already ran offline at
      // apply-start (it must not wait for this binding — see its doc).
      if (state.pm) {
        sweepGhosts('boot-pm')
          .then((removed) => {
            if (removed.length) logger.info?.(`[eac-plugin-suite] ghost sweep (pm pass) removed: ${removed.join(', ')}`)
          })
          .catch(() => { /* trace already recorded inside */ })
      }
    })

    // webServer is optional: without it the settings tab has no data source,
    // so degrade loudly instead of silently.
    ctx.inject?.(['webServer'], (scoped) => {
      const server = scoped.webServer
      if (!server || typeof server.register !== 'function') {
        trace('webServer', `unexpected shape: ${Object.keys(server ?? {}).join(',')}`)
        return
      }
      const effect = scoped.effect ?? ctx.effect
      effect?.(() => {
        try {
          const dispose = server.register({ kind: 'prefix', path: '/api/eac-plugin-suite', handler: createApiHandler(ctx) })
          trace('webServer', 'mounted /api/eac-plugin-suite')
          logger.info?.('[eac-plugin-suite] API mounted at /api/eac-plugin-suite')
          return typeof dispose === 'function' ? dispose : undefined
        } catch (err) {
          trace('webServer-register-error', String(err?.stack ?? err))
          return undefined
        }
      }, 'eac-plugin-suite: api routes')
    })
  } catch (err) {
    trace('apply-error', String(err?.stack ?? err))
    logger.warn?.(`[eac-plugin-suite] apply failed: ${String(err?.message ?? err)}`)
  }
}

/** Test hooks — the channel engine is unit-tested with a mocked fetch. */
export const __test = {
  state,
  resourceDirectory,
  assetDirectory,
  createResources,
  completeResources,
  dataDir,
  resolveTarget,
  assertManagementResult,
  cmpVersions,
  parseVersion,
  loadCatalog,
  loadChannelConfig,
  saveChannelConfig,
  probeChannel,
  buildChannelStatus,
  buildChannelEntries,
  downloadItem,
  assetUrl,
  loadGallery,
  loadPrompt,
  sweepGhosts,
  retireKernelProvided,
  installSkipReason,
}
