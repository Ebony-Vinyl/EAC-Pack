/**
 * `seed-bundles.mjs` 的回归测试。
 *
 * 这条规则以前只活在未入库的构建工作区脚本里，没有测试 —— 一旦脚本重写就无声
 * 丢失，而后果是**整机 GUI 起不来**。本测试把它钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldSeedBundle, computeSeedBundles, SEED_BASE_BUNDLES, RETIRED_SEED_BUNDLES } from '../../scripts/repack/seed-bundles.mjs';

test('compat 条目一律不进 bundles', () => {
  // 两个真实案例：都是 compat: eac-fork，都曾让全新 full 实例 GUI 起不来
  assert.equal(shouldSeedBundle({ name: 'p1', status: 'preinstalled' }, { compat: 'eac-fork' }), false);
  assert.equal(shouldSeedBundle({ name: 'p2', status: 'preinstalled' }, { compat: 'anything' }), false);
  // 对照：没有 compat 就进
  assert.equal(shouldSeedBundle({ name: 'p3', status: 'preinstalled' }, { compat: undefined, packs: ['eac'] }), true);
});

test('退役清单按 name 判定，调用方必须传 name', () => {
  // 回归：生成端原先调 shouldSeedBundle({ status }, cat) —— 没传 name，
  // 于是 RETIRED_SEED_BUNDLES 静默失效（加了 dafeiyu 退役、重新生成 seed，
  // 它仍出现在 bundles 里）。这条测试钉住「必须按 name 判定」这个契约。
  assert.equal(RETIRED_SEED_BUNDLES.has('dsh-dafeiyu'), true, '退役清单应含 dsh-dafeiyu');
  // 传了 name 且命中 → 排除
  assert.equal(shouldSeedBundle({ status: 'preinstalled', name: 'dsh-dafeiyu' }, {}), false);
  // 传了 name 但未命中 → 放行
  assert.equal(shouldSeedBundle({ status: 'preinstalled', name: 'dsh-not-retired' }, {}), true);
  // 没传 name → 退役规则不生效（这是已知的调用契约，生成端必须补 name）
  assert.equal(shouldSeedBundle({ name: 'p6', status: 'preinstalled' }, {}), true);
});
test('catalog 缺失时 fail-closed，不放行（防 compat 包混进 bundles 拖垮 GUI）', () => {
  // 曾经 catalog 为 null 时直接 return true —— 等于「不知道是不是 compat 就放行」。
  // compat 包进 bundles 会让 0.2.x web boot fail-loud、整机 GUI 拒绝渲染。
  assert.equal(shouldSeedBundle({ name: 'p7', status: 'preinstalled' }, null), false, 'catalog=null 必须 false');
  assert.equal(shouldSeedBundle({ name: 'p8', status: 'preinstalled' }, undefined), false, 'catalog=undefined 必须 false');
  // 正常 catalog 仍应放行
  assert.equal(shouldSeedBundle({ name: 'p6', status: 'preinstalled' }, {}), true, '空对象 catalog 应放行');
});
test('非 preinstalled 状态不进 bundles', () => {
  // desktop-core-precedence：包已由桌面核自带，进 bundles 会重复挂载
  assert.equal(shouldSeedBundle({ name: 'p4', status: 'desktop-core-precedence' }, {}), false);
  // kernel-provided-precedence：内核已提供
  assert.equal(shouldSeedBundle({ name: 'p5', status: 'kernel-provided-precedence' }, {}), false);
  assert.equal(shouldSeedBundle({ name: 'p6', status: 'preinstalled' }, {}), true);
});

test('皮肤与社区包仍然进 bundles（不能被 defaultEnabled 误伤）', () => {
  // 这是踩过的坑：按 defaultEnabled 过滤会把这些一起砍掉。
  // 皮肤的正确模式是「装着但默认 disabled」，所以必须进 bundles。
  const skinEntry = { name: 'dsh-pet', status: 'preinstalled' };
  const skinCatalog = { defaultEnabled: false, packs: ['skins'] };
  assert.equal(shouldSeedBundle(skinEntry, skinCatalog), true, '皮肤必须进 bundles');

  const communityCatalog = { defaultEnabled: false, packs: ['community'] };
  assert.equal(shouldSeedBundle(skinEntry, communityCatalog), true, '社区包必须进 bundles');
});

test('computeSeedBundles 保留基座条目并去重', () => {
  const entries = [
    { name: '@deepseek-ai/dsh-base', status: 'preinstalled' },   // 重复，应去重
    { name: 'dsh-compact', status: 'desktop-core-precedence' },  // 不进
    { name: 'dsh-better-sidebar', status: 'preinstalled', catalog: { packs: ['eac'] } },
    { name: '@ha-na-bi/dsh-client-ui-custom', status: 'preinstalled', catalog: { compat: 'eac-fork' } }, // 不进
    { name: 'dsh-pet', status: 'preinstalled', catalog: { defaultEnabled: false, packs: ['eac'] } },
  ];
  const bundles = computeSeedBundles(entries);
  for (const base of SEED_BASE_BUNDLES) assert.ok(bundles.includes(base), `基座条目 ${base} 必须在内`);
  assert.ok(bundles.includes('dsh-better-sidebar'), '普通 preinstalled 包应进');
  assert.ok(bundles.includes('dsh-pet'), 'defaultEnabled=false 但非 compat 的包应进');
  assert.ok(!bundles.includes('@ha-na-bi/dsh-client-ui-custom'), 'compat 包不进');
  assert.ok(!bundles.includes('dsh-compact'), 'desktop-core-precedence 不进');
  assert.equal(bundles.filter((b) => b === '@deepseek-ai/dsh-base').length, 1, '不得重复');
});

test('真实 composition：排除全部 compat、保留全部皮肤（数字按实际算）', (t) => {
  // 用例名不再写死数字 —— 之前写「61 条（63 减 2）」是错的：实际 62 条、
  // compat 3 条（其中 1 条不满足 preinstalled，所以从 63 只减 2 到 61 并不成立）。
  // 现在改成按实际算出来的数字断言，避免名字与事实脱节。
  const compositionPath = 'D:/AI_Coding/EAC/EAC-Full-Build-20261004/EAC-Desktop/dsh-desktop/assets/full-pack/composition.json';
  if (!fs.existsSync(compositionPath)) return t.skip('composition.json 不存在（未装配 full-pack）');
  const composition = JSON.parse(fs.readFileSync(compositionPath, 'utf8'));
  const bundles = computeSeedBundles(composition.entries);
  const seeded = new Set(bundles);

  // 独立重算一遍期望值，与 computeSeedBundles 相互印证（不直接复用被测函数）
  const expected = new Set(SEED_BASE_BUNDLES);
  for (const e of composition.entries ?? []) {
    if (e.status !== 'preinstalled') continue;
    if (!e.catalog) continue;            // fail-closed
    if (e.catalog.compat) continue;
    // 显式退役清单：即使仍标 preinstalled 也不进 bundles。
    if (RETIRED_SEED_BUNDLES.has(e.name)) continue;
    expected.add(e.name);
  }
  assert.equal(bundles.length, expected.size, `bundles 数量应为 ${expected.size}`);
  assert.equal(seeded.size, bundles.length, '不得有重复条目');

  // 退役清单里的包绝不能出现在 bundles 中
  for (const retired of RETIRED_SEED_BUNDLES) {
    assert.ok(!seeded.has(retired), `退役包 ${retired} 不应进 bundles`);
  }

  // 所有 compat 条目都不得在内
  const compatNames = (composition.entries ?? [])
    .filter((e) => e.catalog && e.catalog.compat)
    .map((e) => e.name);
  assert.ok(compatNames.length > 0, '真实 composition 里应有 compat 条目（否则本测试失去意义）');
  for (const n of compatNames) {
    assert.ok(!seeded.has(n), `compat 条目 ${n} 不应进 bundles`);
  }

  // 皮肤必须都在（防 defaultEnabled 误伤）
  const skinNames = (composition.entries ?? [])
    .filter((e) => e.status === 'preinstalled' && (e.catalog?.packs ?? []).includes('skins'))
    .map((e) => e.name);
  assert.ok(skinNames.length > 0, '真实 composition 里应有皮肤（否则本测试失去意义）');
  for (const n of skinNames) {
    assert.ok(seeded.has(n), `皮肤 ${n} 必须进 bundles`);

  }
  console.log(`[seed-bundles] 真实 composition: ${bundles.length} 条 bundles，排除 compat ${compatNames.length} 条`);
});


