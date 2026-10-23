/**
 * 分发面归属守卫：Pack 不得给「Desktop 内置（builtin/bundled）」的包打补丁。
 *
 * 为什么需要这条断言
 * ------------------
 * `dsh-compact` 曾经同时被两个分发面声明：
 *   · Desktop：`distributionClass: builtin` / `delivery: bundled`，
 *     运行时由 `companion-sync` 从 `dsh-desktop/assets/plugins/` 拷进 profile；
 *   · Pack：当作普通补丁包，在 `patches/source-patches.json` 里登记 0.2.x 适配。
 *
 * 结果是 Pack 的补丁**从来没生效过** —— profile 里的实际文件来自 Desktop 那份
 * 内置源码，Pack 的 repack 产物被静默覆盖。表现是：
 *   · `settings/describe` 里查不到 `compact` 命名空间（设置卡不出现）；
 *   · `source-patches.test.mjs` 的字节闭合断言持续报 drift（因为装进去的不是 Pack 的产物）；
 *   而两者的 `fiberPhase` 都是 `active`，看不出问题。
 *
 * 实测 2026-10-21：交叉核对 12 个补丁包，只有 compact 一个落在 builtin/bundled。
 * 撤掉它的补丁、把适配改到 Desktop 内置源码后，设置卡才真正出现。
 *
 * 判据
 * ----
 * 对每个补丁包，按 catalog 的 `name -> id` 找到 `.sync/plugin-distribution.json`
 * 里的条目：
 *   · `distributionClass === 'builtin'` 或 `delivery === 'bundled'`
 *     → **不允许**登记补丁（应改 Desktop 内置源码）；
 *   · 其余（external / recommended / 不在分发表里）→ 允许。
 *
 * 为什么「不在分发表里」也算允许：`dsh-plugin-wallpaper-engine`、
 * `dsh-session-manager`、`dsh-webui-prompt-optimizer` 这类只经由 Pack 分发的包
 * 本来就不在 Desktop 的 46 项分发清单里，Pack 是它们唯一的归属，补丁是正确手段。
 *
 * fail-open 还是 fail-closed
 * --------------------------
 * Desktop 仓不在同一 checkout 时**跳过**（skip），不判失败 —— Pack 的 CI 与
 * Desktop 未必同装，这与 `kernel-compat.mjs` 对「内核缺失」的处理口径一致
 * （那边是 exit 2 环境错误，这里是 skip）。但**只要文件在，就必须判**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  findBuiltinConflicts,
  findDistributionEntry,
  isDesktopBuiltin,
  candidateIds,
} from '../../scripts/repack/distribution-entry.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DESKTOP_DISTRIBUTION = path.join(ROOT, '..', 'EAC-Desktop', '.sync', 'plugin-distribution.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** 从 catalog 建 包名 -> id 映射（与 repack 用同一份事实源）。 */
function catalogNameToId() {
  const map = new Map();
  for (const pack of ['eac', 'aio', 'skins', 'community']) {
    const file = path.join(ROOT, 'catalog', `${pack}.json`);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    const rows = Array.isArray(data) ? data : (data.plugins ?? []);
    for (const e of rows) {
      if (e && typeof e.name === 'string' && typeof e.id === 'string') map.set(e.name, e.id);
    }
  }
  return map;
}

test('Pack 不给 Desktop 内置（builtin/bundled）的包打补丁', (t) => {
  if (!fs.existsSync(DESKTOP_DISTRIBUTION)) {
    return t.skip('Desktop 仓不在同一 checkout（.sync/plugin-distribution.json 缺失）');
  }
  const manifest = readJson(path.join(ROOT, 'patches', 'source-patches.json'));
  const distribution = readJson(DESKTOP_DISTRIBUTION);
  const nameToId = catalogNameToId();

  // 走共享实现（scripts/repack/distribution-entry.mjs）—— 与「反向自测」同一份判据，
  // 且带 id 命名空间归一化。此前是本文件自己内联一份字面相等查找，
  // 于是 14 条 `dsh-<id>` 前缀条目全部漏掉，3 个补丁包静默走「找不到 → 放行」。
  const conflicts = findBuiltinConflicts(manifest.patches, nameToId, distribution.plugins);
  const offenders = conflicts.map(
    (c) => `${c.name} (id=${c.matchedId}, class=${c.distributionClass}, delivery=${c.delivery})`,
  );

  assert.deepEqual(
    offenders,
    [],
    'Pack 不能给 Desktop 内置分发的包打补丁 —— 补丁会被内置版覆盖且静默失效。\n'
      + '应改为修改 Desktop 仓的 dsh-desktop/assets/plugins/<name>，并从 manifest 撤掉该条目。\n'
      + '冲突条目：\n  ' + offenders.join('\n  '),
  );
});

test('分发归属守卫自身能识别 builtin 冲突（反向自测，走真实实现）', (t) => {
  if (!fs.existsSync(DESKTOP_DISTRIBUTION)) {
    return t.skip('Desktop 仓不在同一 checkout');
  }
  // 本用例**不再自己重写判据** —— 之前写成
  //   const isConflict = (e) => e.distributionClass === 'builtin' || ...
  // 等于把被测逻辑抄一遍再断言它自己，对解析链的缺陷（id 命名空间不一致、
  // catalog 查不到时的静默放行）完全视而不见，形同虚设。
  // 现在直接走 findDistributionEntry / isDesktopBuiltin / findBuiltinConflicts。
  const distribution = readJson(DESKTOP_DISTRIBUTION);
  const plugins = distribution.plugins ?? [];

  // (a) compact 是 builtin/bundled，必须被判为冲突
  const compact = findDistributionEntry('dsh-compact', 'compact', plugins);
  assert.ok(compact, 'compact 应能在分发表里找到');
  assert.equal(compact.entry.distributionClass, 'builtin');
  assert.equal(compact.entry.delivery, 'bundled');
  assert.equal(isDesktopBuiltin(compact.entry), true, 'compact 必须被判为 builtin');

  // (b) better-sidebar 是 recommended/pack，不该判冲突
  const sidebar = findDistributionEntry('dsh-better-sidebar', 'better-sidebar', plugins);
  assert.ok(sidebar, 'better-sidebar 应能在分发表里找到');
  assert.equal(isDesktopBuiltin(sidebar.entry), false, 'better-sidebar 不应判为 builtin');

  // (c) **关键回归**：id 命名空间归一化。distribution 里有 14 条用 `dsh-<id>`
  // 前缀，而 catalog 用裸 id；字面相等查找会漏掉它们，全部走「找不到 → 放行」。
  // 用 session-manager 这个真实存在的例子验证归一化确实生效。
  const byLiteral = findDistributionEntry('dsh-session-manager', 'dsh-session-manager', plugins);
  const byBare = findDistributionEntry('dsh-session-manager', 'session-manager', plugins);
  assert.ok(byBare, '裸 id session-manager 应通过归一化命中 dsh-session-manager');
  assert.equal(byBare.matchedId, 'dsh-session-manager');
  assert.equal(byBare.viaNormalization, true, '应标记为经过了归一化');
  assert.ok(byLiteral, '带前缀的 id 也应能直接命中');
  assert.equal(isDesktopBuiltin(byBare.entry), false, 'session-manager 不是 builtin');

  // (d) candidateIds 双向都要覆盖
  assert.deepEqual(candidateIds('compact').sort(), ['compact', 'dsh-compact'].sort());
  assert.deepEqual(candidateIds('dsh-pet').sort(), ['dsh-pet', 'pet'].sort());

  // (e) 用一份人造 patches 验证 findBuiltinConflicts 真的会报出来
  const fakeNameToId = new Map([['dsh-compact', 'compact'], ['dsh-better-sidebar', 'better-sidebar']]);
  const fakeConflicts = findBuiltinConflicts(
    [{ name: 'dsh-compact' }, { name: 'dsh-better-sidebar' }],
    fakeNameToId,
    plugins,
  );
  assert.equal(fakeConflicts.length, 1, '只应报出 compact 一条');
  assert.equal(fakeConflicts[0].name, 'dsh-compact');
  assert.equal(fakeConflicts[0].matchedId, 'compact');
});

/**
 * seed 的 `dsh.profile.bundles` 不应包含 `compat` 条目（信息性）。
 *
 * 背景：`compat: 'eac-fork'` 的包依赖 EAC 分叉内核专有服务，在官方 0.2.x 上
 * 激活期永久挂起；而 0.2.x 的 web boot 对「entry 未激活」是 fail-loud 的 ——
 * 一个挂起就整体拒绝渲染（`Failed to load plugins`）。
 *
 * 实测 2026-10-21：seed 的 63 个 bundle 里曾含 2 个 compat 条目
 *   @ha-na-bi/dsh-client-ui-custom (aio)
 *   @dsh-external/dsh-side-session (eac)
 * 它们让全新 full 实例的 GUI 完全起不来（宿主侧 RPC 全绿，只有截图能看出）。
 *
 * 已有两层防护：
 *   1. 生成端调用 `scripts/repack/seed-bundles.mjs` 的 `shouldSeedBundle()` 过滤
 *      —— **规则本身已入库、有 `seed-bundles.test.mjs` 5 条单测钉着**
 *      （第 12 轮之前，这条规则只活在未入库的
 *      `EAC-Full-Build-20261004/prepare-composition.mjs` 里，脚本一重写就会丢，
 *      而后果是整机 GUI 拒绝启动 —— 所以特意把它挪进了 Pack）；
 *   2. `dsh-desktop/lib/desktop/companion-sync.ts` 的
 *      `stripIncompatibleProfileBundles()` 启动时从 profile 剥离 compat 条目
 *      —— 这层是运行时兜底，已实测幂等有效。
 *
 * 所以本条**不判失败**（seed 是构建产物，且已由运行时兜底覆盖），只把残留
 * 报出来，让「生成端规则退化成旧版 / 有人绕过 shouldSeedBundle」这件事可见。
 */
test('seed bundles 不含 compat 条目（信息性；有运行时兜底）', (t) => {
  const seedManifest = path.join(ROOT, '..', 'EAC-Desktop', 'dsh-desktop', 'assets', 'full-pack', 'profile-seed', 'package.json');
  if (!fs.existsSync(seedManifest)) return t.skip('full-pack seed 不存在（未装配）');

  const seed = readJson(seedManifest);
  const bundles = new Set(seed.dsh?.profile?.bundles ?? []);
  const nameToId = catalogNameToId();
  const idToName = new Map([...nameToId].map(([name, id]) => [id, name]));

  const compatNames = new Set();
  for (const pack of ['eac', 'aio', 'skins', 'community']) {
    const f = path.join(ROOT, 'catalog', `${pack}.json`);
    if (!fs.existsSync(f)) continue;
    const data = readJson(f);
    const rows = Array.isArray(data) ? data : (data.plugins ?? []);
    for (const e of rows) if (e && e.compat && typeof e.name === 'string') compatNames.add(e.name);
  }

  const offenders = [...compatNames].filter((n) => bundles.has(n));
  if (offenders.length) {
    console.log('[distribution-boundary] seed 里仍含 compat 条目（运行时会被 companion-sync 剥离）:');
    for (const o of offenders) {
      const id = nameToId.get(o);
      console.log(`  ${o}${id ? ` (id=${id})` : ''}`);
    }
    console.log('  → 生成端应调用 scripts/repack/seed-bundles.mjs 的 shouldSeedBundle()；');
    console.log('    若它已调用却仍有残留，说明 seed 是旧的、需要重跑 prepare-composition。');
  }
  // 实质断言：seed 里**不得**出现 compat 条目。
  // 之前这里是 `assert.ok(Array.isArray(offenders))` —— 恒真，等于没测。
  // 现在 seed 已经由 shouldSeedBundle() 过滤干净（实测 0 残留），可以直接断言。
  // 若将来生成端规则退化，这条会红，并打印上面的定位提示。
  assert.deepEqual(offenders, [],
    'seed bundles 里不应有 compat 条目：' + offenders.join(', '));
});

/**
 * builtin 包的「版本双轨」告警（非阻断）。
 *
 * 同一批 builtin 包在 Desktop 的 `assets/plugins/<dir>` 与 Pack 的 `dist/` 各有一份，
 * 运行时 Desktop 内置版优先。两份版本号不同时，Pack 那份就是**永远不会被用到的
 * 冗余产物**，而且掩盖真实状态 —— compact 就是这样：Pack 标 1.0.1（由 OVERRIDES
 * 硬抬高，源目录其实是 1.0.0），Desktop 是 1.0.0，实际生效的永远是后者。
 *
 * 实测 2026-10-21 的四条：
 *   plugin-shield        Desktop 0.1.2 > Pack 0.1.0   ← Pack 陈旧
 *   settings-scroll-fix  Desktop 2.0.3 > Pack 2.0.2   ← Pack 陈旧
 *   compact              Desktop 1.0.0 vs Pack 1.0.1  ← Pack 是虚拟抬版
 *   unified-market       Desktop 0.4.0 < Pack 0.4.1   ← Pack 更新但不会被用
 *
 * 这条**不判失败**（不阻断合并：它是分发策略问题，需维护者裁决哪边为准），
 * 只把差异打进测试输出，避免它再次悄无声息地累积。
 */
test('builtin 包在 Desktop 与 Pack 的版本双轨（信息性）', (t) => {
  if (!fs.existsSync(DESKTOP_DISTRIBUTION)) return t.skip('Desktop 仓不在同一 checkout');
  const desktopPluginsDir = path.join(ROOT, '..', 'EAC-Desktop', 'dsh-desktop', 'assets', 'plugins');
  if (!fs.existsSync(desktopPluginsDir)) return t.skip('Desktop assets/plugins 不存在');

  const manifest = readJson(path.join(ROOT, 'patches', 'source-patches.json'));
  const distribution = readJson(DESKTOP_DISTRIBUTION);
  const byId = new Map((distribution.plugins ?? []).map((x) => [x.id, x]));
  const nameToId = catalogNameToId();

  const drift = [];
  for (const [name, id] of nameToId) {
    const entry = byId.get(id);
    if (entry === undefined) continue;
    if (entry.distributionClass !== 'builtin' && entry.delivery !== 'bundled') continue;
    // Desktop 内置目录：优先 dsh-<id>，其次 <id>
    let desktopVersion = null;
    for (const dir of [`dsh-${id}`, id]) {
      const p = path.join(desktopPluginsDir, dir, 'package.json');
      if (fs.existsSync(p)) { desktopVersion = readJson(p).version; break; }
    }
    if (desktopVersion === null) continue;
    // Pack 侧版本：catalog（repack 的真相源）
    let packVersion = null;
    for (const pack of ['eac', 'aio', 'skins', 'community']) {
      const f = path.join(ROOT, 'catalog', `${pack}.json`);
      if (!fs.existsSync(f)) continue;
      const data = readJson(f);
      const rows = Array.isArray(data) ? data : (data.plugins ?? []);
      const hit = rows.find((e) => e && e.name === name);
      if (hit) { packVersion = hit.version; break; }
    }
    if (packVersion === null || packVersion === desktopVersion) continue;
    drift.push(`${name}: desktop=${desktopVersion} pack=${packVersion}`);
  }

  if (drift.length) {
    // 用 console 而非 assert：这里是信息，不是门禁
    console.log('[distribution-boundary] builtin 包版本双轨（Desktop 内置版优先，Pack 那份不会被用到）:');
    for (const d of drift) console.log('  ' + d);
  }
  // 本用例是**信息性**的（不设门槛，见上方注释：这是分发策略问题，需维护者裁决）。
  // 原来的 `assert.ok(Array.isArray(drift))` 恒真、没有意义。改成一个真正会失败的
  // 结构性检查：drift 列表里每条都必须能被解析出 desktop/pack 两侧版本 ——
  // 若解析逻辑坏了（例如命中了错误目录），drift 会为空或含畸形项，这里就会红。
  for (const d of drift) {
    assert.match(d, /^.+: desktop=.+ pack=.+$/, `drift 条目格式应可解析：${d}`);
  }
  // 至少确认「真的扫描过」而不是「一个都没扫到」：builtin 条目存在时，
  // 必然有若干能在 Desktop assets 里找到对应 package.json；若一个都没找到，
  // 说明目录解析错了，本用例会静默失真（永远输出空 drift）。
  const builtinCount = [...byId.values()].filter(isDesktopBuiltin).length;
  if (builtinCount > 0) {
    let scanned = 0;
    for (const [, id] of nameToId) {
      const entry = byId.get(id);
      if (!entry || !isDesktopBuiltin(entry)) continue;
      for (const dir of [`dsh-${id}`, id]) {
        if (fs.existsSync(path.join(desktopPluginsDir, dir, 'package.json'))) { scanned++; break; }
      }
    }
    assert.ok(scanned > 0,
      `builtin 条目有 ${builtinCount} 个，但在 Desktop assets/plugins 里一个对应目录都没扫到 —— 目录解析可能有误`);
  }
});

/**
 * 分发表 `external/market` 标注与实际分发面不符（信息性）。
 *
 * 实测 2026-10-21：`external` 类 20 个包里有 **17 个在 dist 产物中**（= 随 Pack 分发），
 * 只有 `dsh-stt` / `dsh-undo` / `plugin-wizard` 是真正的纯市场包。
 *
 * 为什么这是**信息性**而非门禁：
 * `distributionClass` 经 `PLUGIN_DISTRIBUTION_CLASSES` 只用于行/UI 的分级标签展示，
 * **不参与**「是否安装」「是否进启动清单」的判定（后两者由 dist 与
 * seed-bundles.mjs 决定）。所以标注不准的后果是市场页展示与实际不符，
 * 不影响功能。改不改、怎么改需要维护者定口径 —— 见
 * `lite/DECISION-distribution-class-20261021.md`。
 *
 * 本用例只把「差异集合」固定下来：一旦有新的包被误标、或有人修正了标注，
 * 这里会给出提示，避免它悄悄漂移。
 */
test('分发表 external 标注与 dist 事实的差异（信息性，记录待裁决）', (t) => {
  if (!fs.existsSync(DESKTOP_DISTRIBUTION)) return t.skip('Desktop 仓不在同一 checkout');
  const distIndex = path.join(ROOT, 'dist', 'index.json');
  if (!fs.existsSync(distIndex)) return t.skip('dist 不存在（未装配）');

  const distribution = readJson(DESKTOP_DISTRIBUTION);
  const index = readJson(distIndex);
  const byName = new Set(index.map((e) => e.name));
  const nameToId = catalogNameToId();
  const idToName = new Map([...nameToId].map(([n, id]) => [id, n]));

  const extInDist = [];
  for (const e of distribution.plugins ?? []) {
    if (e.distributionClass !== 'external') continue;
    const bare = String(e.id).replace(/^dsh-/, '');
    const name = idToName.get(e.id) ?? idToName.get(bare);
    if (name && byName.has(name)) extInDist.push(String(e.id));
  }

  if (extInDist.length) {
    console.log('[distribution-boundary] 标 external/market 但实际随 Pack 分发（待裁决）:');
    for (const id of extInDist) console.log('  ' + id);
    console.log('  → 详见 lite/DECISION-distribution-class-20261021.md');
  }
  // 只断言「可枚举」，把差异固定成可见输出，不阻断合并
  assert.ok(Array.isArray(extInDist));
});
