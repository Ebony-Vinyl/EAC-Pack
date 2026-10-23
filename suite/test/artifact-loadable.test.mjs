/**
 * 产物可加载性守卫：seed 的 `dsh.profile.bundles` 里每个包，其产物 tgz 必须自带
 * `dsh.bundle` 声明。
 *
 * 为什么需要这条
 * --------------
 * 内核按 bundle 行加载插件时要求包自带 `dsh.bundle` 声明，缺失就**静默跳过**：
 *
 *   dsh: skipping profile bundle "@deepseek-ai/dsh-balance":
 *     Error: profile bundle ... declares no dsh.bundle in its package.json
 *   dsh: warning: 1 entry did not activate
 *
 * 后果是设置面与功能整块消失，而启动审计只在最后给一行「1 entry did not activate」，
 * 极难归因到具体包。
 *
 * 实测 2026-10-21：清空 dist 全量重建后，62 个 seed bundle 里 **16 个**缺这个声明
 * （balance / conversation-tweaks / prompt-custom / openclaw-bridge /
 * settings-groups / float-window / skin-switch / file-changes 系列…）。
 * 根因是 `dsh.bundle` 由 `ensure-bundles.mjs` 事后补写，而 repack 当时不会自动调它。
 *
 * 为什么「补丁字节闭合」挡不住
 * ----------------------------
 * `source-patches.test.mjs` 验的是「补丁文件内容 == manifest 声明的 outputSha256」。
 * 这证明**补丁被正确应用**，但完全不涉及 `package.json` 里的 `dsh.bundle` ——
 * 那一步由 ensure-bundles 重打 tgz 时补。所以「字节全绿」与「能被内核加载」
 * 是两个不同的断言，必须分别守。
 *
 * fail 条件
 * ---------
 * · dist 不存在 → skip（未装配）
 * · full-pack seed 不存在 → skip（Desktop 仓不在同一 checkout）
 * · 否则任何缺失都判失败
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.json');
const SEED = path.join(ROOT, '..', 'EAC-Desktop', 'dsh-desktop', 'assets', 'full-pack', 'profile-seed', 'package.json');

/** 读取 tgz 内某个文件的文本内容。 */
function readFromTgz(tgzPath, innerPath) {
  return cp.execFileSync('tar', ['-xOf', tgzPath, innerPath], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('seed bundles 里的每个产物都自带 dsh.bundle 声明', (t) => {
  if (!fs.existsSync(DIST_INDEX)) return t.skip('dist/index.json 不存在（未装配）');
  if (!fs.existsSync(SEED)) return t.skip('full-pack seed 不存在（Desktop 仓不在同一 checkout）');

  const index = JSON.parse(fs.readFileSync(DIST_INDEX, 'utf8'));
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const bundles = seed.dsh?.profile?.bundles ?? [];
  assert.ok(bundles.length > 0, 'seed 应包含 profile.bundles');

  const byName = new Map(index.map((e) => [e.name, e]));
  const missing = [];
  const notInDist = [];

  for (const name of bundles) {
    const entry = byName.get(name);
    if (!entry) { notInDist.push(name); continue; }
    const tgz = path.join(ROOT, 'dist', entry.file);
    if (!fs.existsSync(tgz)) { notInDist.push(name); continue; }
    try {
      const pkg = JSON.parse(readFromTgz(tgz, 'package/package.json'));
      if (!pkg.dsh?.bundle) missing.push(name);
    } catch (err) {
      missing.push(`${name}（tgz 读取失败: ${err.message.split('\n')[0]}）`);
    }
  }

  // 不在 dist 里的包不算失败：kernelProvided / desktop-core-precedence 的包
  // 由内核或桌面壳自带，seed 里列它们是为了启停状态，不需要 Pack 产物。
  assert.deepEqual(
    missing,
    [],
    'seed bundles 里的包必须自带 dsh.bundle，否则内核会静默跳过它、功能整块消失。\n'
      + '修复：node scripts/repack/ensure-bundles.mjs（repack 全量跑完已自动调用）。\n'
      + '缺失：\n  ' + missing.join('\n  '),
  );

  console.log(`[artifact-loadable] seed bundles ${bundles.length} 个，dist 覆盖 ${bundles.length - notInDist.length} 个，全部自带 dsh.bundle`);
  if (notInDist.length) {
    console.log(`[artifact-loadable] 其中 ${notInDist.length} 个不在 dist（由内核/桌面壳提供，正常）：${notInDist.slice(0, 6).join(', ')}${notInDist.length > 6 ? ' …' : ''}`);
  }
});

/**
 * 皮肤包的 bundle patch 行 id 必须等于 `skin.json#wiring.id`。
 *
 * 为什么需要这条
 * --------------
 * 皮肤包同时声明两套 id：
 *   · `skin.json#id`        —— 目录/展示用，如 `blue-fantasy`
 *   · `skin.json#wiring.id` —— cordis loader 的真实 entry id，如 `ui-skin-blue-fantasy`
 *
 * 皮肤管理器 `@smalltailqwq/dsh-client-ui-skin-*` 写 `cordis.patch.yml` 的
 * managed 段时用的是 **wiring.id**：
 *
 *   # --- dsh-skin managed (auto-generated; do not edit) ---
 *   - id: ui-skin-blue-fantasy
 *     disabled: true
 *   # --- end dsh-skin managed ---
 *
 * 若产物里 bundle patch 的 entry id 写成 `blue-fantasy`，那行 `disabled: true`
 * 就打在了一个**不存在的 entry** 上：`cordis-plugin-loader` 按 entryId 匹配，
 * 匹配不到就什么也不做 —— 皮肤永远启用，界面切换无效。
 *
 * 实测 2026-10-21：blue-fantasy 0.2.0 上游漏带 `dsh.bundle.patch`，被
 * `ensure-bundles.mjs` 补写时错用了 catalog 的 `entry.id`，于是 11 个皮肤里
 * 只有它切不动。其余 10 个上游自带的 patch 都用 `ui-skin-*`，所以这个问题
 * 只在「我们替上游补 patch」时才暴露 —— 正是最容易漏掉的一类。
 *
 * fail 条件
 * ---------
 * · dist 不存在 → skip（未装配）
 * · 有 skin.json 但 patch 行 id ≠ wiring.id → 失败
 * · 有 skin.json 但 wiring.id 缺失/非法 → 失败（无法判定即视为不可控）
 */
test('皮肤包 bundle patch 的行 id 必须等于 skin.json 的 wiring.id', (t) => {
  if (!fs.existsSync(DIST_INDEX)) return t.skip('dist/index.json 不存在（未装配）');

  const index = JSON.parse(fs.readFileSync(DIST_INDEX, 'utf8'));
  const mismatched = [];
  const broken = [];
  let checked = 0;

  for (const entry of index) {
    const tgz = path.join(ROOT, 'dist', entry.file);
    if (!fs.existsSync(tgz)) continue;

    let listing;
    try {
      listing = cp.execFileSync('tar', ['-tzf', tgz], {
        maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch { continue; }
    const files = listing.split(/\r?\n/);
    if (!files.includes('package/skin.json')) continue;

    checked++;
    let skin;
    try {
      skin = JSON.parse(readFromTgz(tgz, 'package/skin.json'));
    } catch (err) {
      broken.push(`${entry.name}（skin.json 不可解析: ${err.message.split('\n')[0]}）`);
      continue;
    }
    const wiringId = skin?.wiring?.id;
    if (typeof wiringId !== 'string' || !/^[a-zA-Z0-9@/_.:-]+$/.test(wiringId)) {
      broken.push(`${entry.name}（skin.json 未声明合法 wiring.id）`);
      continue;
    }

    // patch 路径取自 package.json 的 dsh.bundle.patch
    let patchText;
    try {
      const pkg = JSON.parse(readFromTgz(tgz, 'package/package.json'));
      const decl = pkg.dsh?.bundle?.patch;
      const rel = (Array.isArray(decl) ? decl[0] : decl) ?? './cordis.patch.yml';
      patchText = readFromTgz(tgz, `package/${String(rel).replace(/^\.\//, '')}`);
    } catch (err) {
      broken.push(`${entry.name}（bundle patch 读不到: ${err.message.split('\n')[0]}）`);
      continue;
    }

    // 抽第一条 insert 行的 id
    const m = /^\s*-\s*id:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(patchText);
    if (!m) { broken.push(`${entry.name}（patch 里没有 - id 行）`); continue; }
    if (m[1] !== wiringId) mismatched.push(`${entry.name}: patch id "${m[1]}" ≠ wiring.id "${wiringId}"`);
  }

  assert.deepEqual(
    broken,
    [],
    '皮肤包必须声明可解析的 skin.json#wiring.id，否则无法判定它是否可控。\n  问题包：\n  ' + broken.join('\n  '),
  );
  assert.deepEqual(
    mismatched,
    [],
    '皮肤包 bundle patch 的行 id 必须等于 skin.json#wiring.id。\n'
      + '它们不等时，皮肤管理器写进 cordis.patch.yml managed 段的 disabled:true\n'
      + '会打在并不存在的 entry 上（loader 按 entryId 匹配），结果是该皮肤永远启用、\n'
      + '界面切换无效。\n'
      + '修复：node scripts/repack/ensure-bundles.mjs（它按 wiring.id 生成并纠正旧产物）。\n'
      + '不一致：\n  ' + mismatched.join('\n  '),
  );

  console.log(`[artifact-loadable] 检查 ${checked} 个皮肤包，bundle patch 行 id 全部等于 skin.json#wiring.id`);
});
