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
  execFileSync('tar', ['-xOf', tgz, inner], { maxBuffer: 128 * 1024 * 1024 })

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
      assert.match(file.outputSha256, /^[0-9a-f]{64}$/)
      assert.ok(file.note && file.note.length > 10, `${patch.name}: note should explain the fix`)
      const diffPath = path.join(ROOT, 'patches', ...file.diff.split('/'))
      assert.ok(fs.existsSync(diffPath), `missing diff file: ${file.diff}`)
      const diff = fs.readFileSync(diffPath, 'utf8')
      assert.match(diff, /^\+\+\+ b\//m, `${file.diff}: needs -p1 compatible 'b/' header`)
      if (file.create === true) {
        // Create mode adds a file the upstream package does not ship: there is no
        // input to hash, so pinning one would be a contradiction. The diff must
        // come from /dev/null.
        assert.equal(file.inputSha256, undefined, `${patch.name} ${file.path}: create entry must not pin inputSha256`)
        assert.match(diff, /^--- \/dev\/null$/m, `${file.diff}: create diffs must originate from /dev/null`)
      } else {
        assert.match(file.inputSha256, /^[0-9a-f]{64}$/, `${patch.name} ${file.path}: inputSha256 required`)
        assert.notEqual(file.inputSha256, file.outputSha256, `${patch.name}: patch must change the file`)
        assert.match(diff, /^--- a\//m, `${file.diff}: needs -p1 compatible 'a/' header`)
      }
    }
  }
})

test('create-mode replay materializes a new file byte-exactly', async (t) => {
  const { applySourcePatches } = await import('../../scripts/repack/source-patches.mjs')
  const os = await import('node:os')

  // Build a throwaway package staging dir and an in-memory manifest whose single
  // create entry adds lib/new-file.js. Nothing here touches the tracked manifest
  // or dist/, so this test is meaningful on a clean clone.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-create-stage-'))
  const diffAbs = path.join(ROOT, 'patches', 'files', 'dsh-conversation-tweaks', 'lib', 'settings-compat.js.diff')
  const shipped = fs.readFileSync(path.join(ROOT, 'patches', 'files', '_shared', 'settings-compat.js'))
  const shippedSha = sha256(shipped)
  try {
    const manifest = {
      schemaVersion: 1,
      patches: [
        {
          name: 'create-probe',
          version: '1.0.0',
          source: 'eac-tag',
          files: [
            {
              path: 'lib/settings-compat.js',
              diff: 'files/dsh-conversation-tweaks/lib/settings-compat.js.diff',
              create: true,
              outputSha256: shippedSha,
              note: 'in-memory probe entry',
            },
          ],
        },
      ],
    }
    assert.ok(fs.existsSync(diffAbs), 'the tracked create diff must exist for this probe')
    const applied = applySourcePatches({ name: 'create-probe', version: '1.0.0' }, staging, () => {}, manifest)
    assert.equal(applied.length, 1)
    assert.equal(applied[0].path, 'lib/settings-compat.js')
    const written = fs.readFileSync(path.join(staging, 'lib', 'settings-compat.js'))
    assert.equal(sha256(written), shippedSha, 'created file must match outputSha256 byte-for-byte')

    // Re-running must fail closed: the target now exists, so create mode is invalid.
    assert.throws(
      () => applySourcePatches({ name: 'create-probe', version: '1.0.0' }, staging, () => {}, manifest),
      /create target already exists/,
    )
    // A pinned inputSha256 contradicts create mode and must be rejected too.
    const contradicting = JSON.parse(JSON.stringify(manifest))
    contradicting.patches[0].files[0].inputSha256 = shippedSha
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-create-stage2-'))
    try {
      assert.throws(
        () => applySourcePatches({ name: 'create-probe', version: '1.0.0' }, other, () => {}, contradicting),
        /must not pin inputSha256/,
      )
    } finally {
      fs.rmSync(other, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
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
  const suiteItems = asArray(readJson(path.join(ROOT, 'suite/catalog/eac.json')))
  const ofmSuite = suiteItems.find((e) => e.id === 'our-free-model')
  assert.ok(ofmSuite, 'our-free-model missing from suite/catalog/eac.json')
  assert.equal(ofmSuite.defaultEnabled, true, 'suite catalog must mirror the OFM default-enabled state')
  // 原先这里是 `assert.notEqual(ofm.config?.distribution, 'managed')` —— 但那行**恒真**：
  // 上一行已断言 ofm 根本没有 config，可选链必然得到 undefined。它守不住任何东西。
  //
  // 真正要守的是「两个 catalog 都不得声明 managed 分发」：一旦有人给 OFM 补上
  // config（尤其在 suite catalog 那份里），上面的 `!('config' in ofm)` 只覆盖
  // catalog/eac.json，suite 那份会漏网。所以这里对**两份**都做显式检查。
  for (const [label, entry] of [['catalog/eac.json', ofm], ['suite/catalog/eac.json', ofmSuite]]) {
    assert.ok(
      !entry.config || entry.config.distribution !== 'managed',
      `${label}: OFM must not declare a managed distribution (overlay rows only exist for default-disabled entries)`,
    )
  }
})

test('bootstrap manifest covers the catalog and pins the patched hashes', (t) => {
  const bootstrap = readJson(path.join(ROOT, 'suite/assets/bootstrap.json'))
  const catalogs = ['eac', 'aio', 'skins', 'community']
    .flatMap((p) => (fs.existsSync(path.join(ROOT, 'suite/catalog', `${p}.json`)) ? asArray(readJson(path.join(ROOT, 'suite/catalog', `${p}.json`))) : []))
  for (const entry of catalogs) {
    // catalog 标 `distExclude: true` 的条目有意不进安装包（保留市场元数据，
    // 但不出现在 bootstrap/items 里）—— 不参与「catalog 必须被 manifest 覆盖」的闭包断言。
    if (entry.distExclude === true) continue
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

/**
 * 多文件补丁失败必须回滚已写入的 staging 目标。
 *
 * 为什么需要这条（2026-10-21 对抗审查发现的真漏洞）
 * --------------------------------------------------
 * 原实现直接 `writeFileSync(target, after)` 落 staging，而 `finally` 只删 scratchRoot。
 * 多文件补丁在第 N 个失败时，前 N-1 个已永久留在 staging，且异常路径下调用方拿不到
 * `applied`，**无从知道 staging 已被改了一半** —— 构建随即用半应用的包去打 tgz。
 *
 * create 场景更糟：残留的新文件会让第二次运行报「create target already exists」，
 * 即使把 diff 修好也无法自愈，必须人工清暂存目录。
 *
 * 这条测试用真实 applySourcePatches + 注入式 staging，在干净 clone 上也能跑。
 */
test('multi-file patch failure rolls back every already-written staging file', async () => {
  const { applySourcePatches } = await import('../../scripts/repack/source-patches.mjs')
  const os = await import('node:os')

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-rollback-stage-'))
  const shipped = fs.readFileSync(path.join(ROOT, 'patches', 'files', '_shared', 'settings-compat.js'))
  const shippedSha = sha256(shipped)

  // 造一个已存在的目标文件，模拟「modify 模式下补丁前的内容」。
  fs.mkdirSync(path.join(staging, 'lib'), { recursive: true })
  const victim = path.join(staging, 'lib', 'victim.js')
  const originalBytes = Buffer.from('// original content before patching\n', 'utf8')
  fs.writeFileSync(victim, originalBytes)

  // 两条目：第 1 条 create（会成功写入），第 2 条 modify 但 inputSha256 故意写错 → 必失败。
  // 失败点在第 2 条，此时第 1 条已落盘，正好检验回滚。
  const manifest = {
    schemaVersion: 1,
    patches: [
      {
        name: 'rollback-probe',
        version: '1.0.0',
        source: 'eac-tag',
        files: [
          {
            path: 'lib/settings-compat.js',
            diff: 'files/dsh-conversation-tweaks/lib/settings-compat.js.diff',
            create: true,
            outputSha256: shippedSha,
            note: 'in-memory probe entry (create, succeeds first)',
          },
          {
            path: 'lib/victim.js',
            diff: 'files/dsh-conversation-tweaks/lib/settings-compat.js.diff',
            inputSha256: '0'.repeat(64),
            outputSha256: shippedSha,
            note: 'in-memory probe entry (modify, must fail on input hash)',
          },
        ],
      },
    ],
  }

  try {
    // 记录失败前的目录快照
    const before = fs.existsSync(path.join(staging, 'lib', 'settings-compat.js'))

    assert.throws(
      () => applySourcePatches({ name: 'rollback-probe', version: '1.0.0' }, staging, () => {}, manifest),
      /input mismatch/,
      '第二个文件的 inputSha256 不符必须抛错',
    )

    // ① create 成功的那个文件必须被删除（回滚），不能残留
    assert.equal(
      fs.existsSync(path.join(staging, 'lib', 'settings-compat.js')), before,
      '回滚必须删除本函数 create 出来的文件，否则下次运行会误报 "create target already exists"',
    )
    // ② modify 目标必须保持原字节（本例它在失败前未被改动，作为一致性断言）
    assert.equal(
      fs.readFileSync(victim, 'utf8'), originalBytes.toString('utf8'),
      '回滚后 modify 目标必须保持补丁前的字节',
    )
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
})

/**
 * modify 分支的**成功路径**：从真实上游字节出发，跑真实补丁，产出必须等于
 * manifest 的 `outputSha256`。
 *
 * 为什么需要这条
 * --------------
 * 上面那条回滚测试里所有 modify 用例都以 `inputSha256` 不匹配**失败**收场
 * （第 2 个条目故意写错哈希）。也就是说：modify 的成功分支在整个测试套件里
 * 从未被执行过。能覆盖它的地方只有两类：
 *   - `fetch-eac-src.mjs` 只校验 `inputSha256`（补丁**前**），不跑 diff；
 *   - dist 级测试在干净 clone 上 skip（需要 dist/）。
 * 于是「diff 能应用、结果等于 outputSha256」全靠一次真跑 repack 来证明，
 * 而那是几百 MB 的流程，没人会为改一行测试去跑。
 *
 * 失败方向是**致命**的：modify 分支若静默产出与 manifest 不符的字节，
 * outputSha256 校验会抛错（好），但若校验逻辑本身写错（比如比错了字段），
 * 就会打出「repack 全绿、装出来的插件行为不对」的包。
 *
 * fixture 来源
 * ------------
 * 用 `.cache/eac-src`（fetch-eac-src.mjs 物化的 pinned tag 源码）。这是
 * **真实**上游字节，不是手搓的。cache 不在就跳过 —— 跳过必须可见，不能让
 * 绿条掩盖「没验」。
 *
 * 覆盖范围
 * --------
 * manifest 共 21 个 modify 条目，本测试覆盖其中 16 个（所有 `source: eac-tag`
 * 的）。剩下 5 个属于 `source: npm`（dsh-plugin-wallpaper-engine、
 * dsh-session-manager），上游是 npm tarball，不在 `.cache/eac-src` 里 —— 要覆盖
 * 它们得先落一份 npm tarball 缓存。这是已知边界，不是遗漏。
 */
test('modify 补丁成功路径：真实上游字节 + 真实 diff → outputSha256', async (t) => {
  const { applySourcePatches } = await import('../../scripts/repack/source-patches.mjs')
  const os = await import('node:os')

  const eacSrc = path.join(ROOT, '.cache', 'eac-src')
  if (!fs.existsSync(eacSrc)) {
    return t.skip('.cache/eac-src absent (run scripts/repack/fetch-eac-src.mjs first)')
  }

  const base = manifest.base.eac
  const pluginsDir = path.join(eacSrc, ...base.subdir.split('/'))

  // 按**补丁粒度**跑，而不是按文件粒度：同一个 patch 里可能同时有 create 和
  // modify 条目，只放其中一个会让 applySourcePatches 在处理另一个时失败
  // （create 目标已存在 / modify 目标缺失），测不到想测的东西。
  const todo = manifest.patches.filter(
    (patch) => patch.source === 'eac-tag'
      && patch.files.some((file) => file.create !== true)
      // 只挑**所有** modify 条目的上游源都在 cache 里的补丁
      && patch.files.every((file) => file.create === true
        || fs.existsSync(path.join(pluginsDir, path.basename(patch.name), ...file.path.split('/')))),
  )
  assert.ok(
    todo.length > 0,
    '.cache/eac-src 里找不到任何可完整回放的 modify 补丁 —— fetch-eac-src.mjs 可能没跑完',
  )

  let checked = 0
  for (const patch of todo) {
    const modifyFiles = patch.files.filter((file) => file.create !== true)
    if (!modifyFiles.length) continue
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-modify-ok-'))
    try {
      // 把该补丁所有 modify 条目的上游源按原路径铺进 staging
      for (const file of modifyFiles) {
        const src = path.join(pluginsDir, path.basename(patch.name), ...file.path.split('/'))
        const dest = path.join(staging, ...file.path.split('/'))
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
        assert.equal(
          sha256(fs.readFileSync(dest)), file.inputSha256,
          `${patch.name} ${file.path}: cache 里的上游字节与 manifest inputSha256 不符`
          + '（fetch-eac-src.mjs 已校验过这一项，走到这里说明 cache 被改过）',
        )
      }
      fs.writeFileSync(
        path.join(staging, 'package.json'),
        JSON.stringify({ name: patch.name, version: patch.version }),
      )

      const applied = applySourcePatches(
        { name: patch.name, version: patch.version },
        staging,
        () => {},
        { schemaVersion: 1, patches: [patch] },
      )

      for (const file of modifyFiles) {
        assert.ok(
          applied.some((a) => a.path === file.path),
          `${patch.name} ${file.path}: 补丁没有报告应用成功`
          + `（applied=${JSON.stringify(applied.map((a) => a.path))}）`,
        )
        const after = sha256(fs.readFileSync(path.join(staging, ...file.path.split('/'))))
        assert.equal(
          after, file.outputSha256,
          `${patch.name} ${file.path}: 打完补丁的字节与 manifest outputSha256 不符\n`
          + '  → 要么 diff 被改过，要么上游源变了。两者都会让 npm pack 出去一个'
          + '「哈希对不上」或「行为不对」的包。',
        )
        checked++
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }
  assert.ok(checked > 0, '一条 modify 用例都没跑 —— 测试无效')
})
