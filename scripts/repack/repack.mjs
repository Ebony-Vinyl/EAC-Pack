#!/usr/bin/env node
/**
 * DSH 插件整合包重打包管线（可复现）。
 *
 * 输入：catalog/{eac,aio,skins}.json + .cache 内的 EAC/aio 源（+ 本机 AIO 离线包兜底）。
 * 输出：dist/<name>_<version>.tgz（/ 已替换为 _）、dist/SHA256SUMS、dist/index.json。
 *
 * package.json 改写规则（rewritePeerDeps，见下）：
 *   1. peerDependencies["@deepseek-ai/dsh"]（若有）→ ">=0.1.0-rc.6"。
 *   2. 其余 @deepseek-ai/* peer：精确 pin（如 "0.1.3-alpha.2"）与 ^/~ 范围
 *      （如 "^4.0.1"）放宽为 ">=<floor>"；已是 ">=" 或 "*" 的保持不变。
 *      原因：AIO 第三方包大量精确 pin 0.1.3-alpha.2 内部件，在 dsh 0.2.0-rc.2
 *      下必然不满足；monotone 放宽（新范围 ⊇ 原范围）保证宿主版本 ≥ floor 即满足。
 *   3. 非 @deepseek-ai 作用域的 peer（react/react-dom/zod/cordis 等）不动。
 *   4. "files" 白名单存在时，强制补入源目录根下的许可证/署名文件
 *      （LICENSE、NOTICE、ASSET_LICENSE、THIRD_PARTY、COPYING、AUTHORS 等前缀族）
 *      与功能性清单（cordis.patch.yml / dsh-plugin.json / skin.json / PROVENANCE.json）
 *      —— npm pack 默认只保证 LICENSE 与 README，NOTICE 等不在白名单会被静默丢弃。
 *
 * 用法：node repack.mjs [--only <name-substring>]
 */
import { execSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applySourcePatches } from './source-patches.mjs';
import { ensurePatchedFiles } from './package-files.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CATALOG_DIR = path.join(ROOT, 'catalog');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache');
const STAGING = path.join(CACHE, 'repack-staging');
const NPM_TGZ = path.join(CACHE, 'npm-tarballs');

const EAC_PLUGINS = path.join(CACHE, 'eac-src', 'dsh-desktop', 'assets', 'plugins');
const AIO_PLUGINS = path.join(CACHE, 'aio-src', 'assets', 'plugins');
const AIO_SKINS = path.join(CACHE, 'aio-src', 'assets', 'skins');
// 兜底提取源：本机 AIO 离线发行版的 web-desktop profile 种子 node_modules
const AIO_SEED_NM =
  process.env.AIO_SEED_NM || 'D:/DSHEAC AIO/resources/profile-seed/profiles/web-desktop/node_modules';

// npm 包基名 -> EAC v5.3.6 assets 目录名的例外（其余 = base name 本身）
const DIR_OVERRIDES = { 'meow-smooth': 'dsh-meow-smooth' };

// github 源（可复现：缓存目录缺 package.json 时自动浅克隆）。
// 兼容两种 source 取值：'github'（存量 EAC 独立分发）与 'github-repo'（v0.2.0 社区皮肤）。
const GH_SOURCES = {
  // 这几条原本都不钉 ref，浅克隆于是跟随上游默认分支 —— 实测全量 repack 依次在
  // dsh-visualize(0.1.7≠0.1.4)、dsh-drag-and-drop(0.1.7≠0.1.6) 处「版本漂移」die。
  // 清空 dist 后重建在此机器上从来跑不通，正是这批未钉 ref 造成的。
  // 按 picturereader 的既有做法一律钉完整 SHA（取承载 catalog 期望版本的那个 commit）。
  'dsh-think-zh-expand-eac': {
    url: 'https://github.com/jing-hy/dsh-think-zh-expand-eac.git',
    dir: 'think-zh-src',
    ref: '669ba75d958ae2f65d26b394a90bc506b2cd829e',
  },
  '@nagi-ovo/dsh-visualize': {
    url: 'https://github.com/Nagi-ovo/dsh-visualize.git',
    dir: 'visualize-src',
    ref: 'db54992331d98af68390796d0de4b57bc76453ca',
  },
  'dsh-drag-and-drop': {
    url: 'https://github.com/bill9109/dsh-drag-and-drop.git',
    dir: 'dragdrop-src',
    // 8ed0f65 = "chore: rename package scope @omdsh-dev -> bare name"，仍是 0.1.6。
    // 不能钉 3b70ec4（同版本 0.1.6 但包名带 scope @omdsh-dev/...）—— catalog 与
    // full-pack seed 用的都是**裸名** dsh-drag-and-drop@0.1.6，钉错会报「包名不符」。
    ref: '8ed0f65e7e81b09e5d7eb17428871c76a16af769',
  },
  'dsh-theme-endfield': {
    url: 'https://github.com/ymh0000123/dsh-theme-endfield.git',
    dir: 'endfield-src',
    ref: '533e549239188bc8c2545b14c571bd6c1d141942',
  },
  // picturereader 3.5.0：上游 main 已两端适配 0.2.x 内核 —— 客户端不再 inject
  // 已移除的 settingsScope（改为运行时探测：有旧的内核就走 bind，没有就用插件
  // 自建的 loopback 路由 createRemoteScope 提供同构快照面），宿主半不再 import
  // 已删除的 settingsNamespace，且 settings.register 缺失时降级到自有配置覆盖层
  // 而不是抛 TypeError。但**既没有 npm 发布也没有 tag** —— npm 上最新只到 3.3.3，
  // 而 3.3.3 的宿主半仍在 settings.register 处无保护地调用、客户端仍 inject
  // settingsScope。因此只能钉 commit；ref 用完整 SHA，避免上游后续提交让产物漂移。
  picturereader: {
    url: 'https://github.com/jing-hy/picturereader.git',
    dir: 'picturereader-src',
    ref: 'ebbb2f098ecf3fe18a47eaaa361ae157d31272cc',
  },
};

// github-tgz 源：社区作者经 GitHub Release 分发的 npm-pack 形态 tgz。
// 锁定具体 release 资产 URL（可复现，不追新）；下载缓存于 .cache/community-tgz/。
const GH_TGZ_SOURCES = {
  'dsh-client-liang-intensity-skin': {
    url: 'https://github.com/kingOfSoySauce/dsh-liang-skin/releases/download/v0.1.7/dsh-client-liang-intensity-skin-0.1.7.tgz',
  },
  // 键 = 实际包名（day-night 的包名 @dsh-external/dsh-client-ui-skin-deep-whale-day-night
  // ≠ 仓库名 deep-whale-day-night-theme，以 release tgz 内 package.json 为准）
  '@dsh-external/dsh-client-ui-skin-deep-whale-day-night': {
    url: 'https://github.com/GGBond2424648901/deep-whale-day-night-theme/releases/download/v0.1.12/deep-whale-day-night-theme-0.1.12.tgz',
  },
  // dsh-our-free-model：私有 ESM 包（npm 无发布），上游按 GitHub Release 分发官方
  // 预构建 tgz + SHA256SUMS.txt。锁定 release 资产 URL 而非 git clone --depth 1，
  // 使重打包可复现（此前 catalog 写 source=github-repo，但 GH_SOURCES 无该包映射，
  // repack 会在 materializeGithub 里 die）。
  'dsh-our-free-model': {
    url: 'https://github.com/Ebony-Vinyl/dsh-our-free-model/releases/download/v2.5.6/dsh-our-free-model-2.5.6.tgz',
  },
};

// aio seed 提取（本机 AIO 离线包 node_modules）的包集合
const AIO_SEED_PKGS = new Set([
  '@dsh-external/dsh-webui',
  '@ha-na-bi/dsh-client-ui-custom',
  '@local/dsh-webui-statem-bridge',
]);

const ALWAYS_KEEP = [
  'cordis.patch.yml',
  'dsh-plugin.json',
  'skin.json',
  'PROVENANCE.json',
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'NOTICE',
  'NOTICE.md',
  'ASSET_LICENSE.md',
  'ASSET_LICENSE.txt',
  'THIRD_PARTY_NOTICES.md',
  'COPYING',
  'AUTHORS',
];

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// --only 模式下只重建命中的包：index.json 走合并而不是整体替换，孤儿清理只
// 限「重建包名下的旧版本文件」——否则一次 --only 会把其余 70+ 个 tgz 全部清掉。
const MERGE_MODE = onlyArg != null;

// 定向覆写（issue #1 修复，2026-10-02）。重打包是可复现管线，覆写必须在
// staging 阶段显式声明；reason 记录修复背景，随 PROVENANCE 归档。
const OVERRIDES = {
  'dsh-compact': {
    version: '1.0.1',
    patchYml:
      "- insert:\n    - id: compact\n      name: 'dsh-compact'\n      config: {}\n    - id: compact-agent\n      name: 'dsh-compact/agent'\n      config: {}\n",
    reason:
      'issue#1 缺陷3：上游 cordis.patch.yml 是裸 id 定向形态（loader 报 entry compact not found → 插件静默不挂载），改写为 insert 自挂载；且补第二行 compact-agent（dsh-compact/agent）——压缩引擎在 agent 半边，只挂主行等于只挂了个设置壳。注意：其 status/compact-now 端点与设置卡片依赖 EAC 分叉版的 agentPresets/settingsScope，官方 RC2 上不可用（无害的懒注入 pending）；请求路径自动压缩本身只依赖 llm/tokenMeter/sessions，RC2 齐备。版本 +0.0.1 让已装用户经在线渠道收到修复。',
  },
  '@deepseek-ai/dsh-plugin-manager': {
    exportsAdd: { './tools': { default: './lib/index.js' } },
    reason:
      'issue#1 缺陷2 纵深：补 exports["./tools"]（EAC 配套包的 host 半边本就是合法挂载目标）——即使重打包副本残留 profile node_modules，内核 tool-plugin-manager 行也能启动，不再因 ERR_PACKAGE_PATH_NOT_EXPORTED 拒绝整个预设（全部会话无法恢复）。',
  },
  '@dsh-external/dsh-side-session': {
    patchYml:
      '# dsh-side-session bundle patch\n#\n# 服务端子插件加载：web profile 启动时把本插件纳入 cordis 插件栈。\n# 客户端 bundle 由 package.json 的 dsh.client.inject 声明，host 自动加载\n# lib/client.js（window.__ModuleLoader__.load）。\n#\n# issue#1 缺陷1 纵深：行固定 disabled —— 官方内核不提供 settingsScope，该行\n# 一旦激活即阻塞 web boot；即使被手工加回 dsh.profile.bundles 也只会得到\n# 一个停用行，不再整机砖化。\n- insert:\n    - id: side-session\n      name: \'@dsh-external/dsh-side-session\'\n      config: {}\n      disabled: true\n',
    reason: 'issue#1 缺陷1 纵深：bundle 行固定 disabled:true，防手工启用后阻塞 web boot。',
  },
  '@deepseek-ai/dsh-easy-setup': {
    patchYml:
      '# dsh-easy-setup bundle patch（0.2.1 新增，issue#1 缺陷1 纵深）\n#\n# 上游没有 bundle patch：官方内核不提供 settingsScope，本插件行一旦激活即\n# 阻塞 web boot。固定 disabled —— 即使被手工加回 dsh.profile.bundles 也只会\n# 得到一个停用行，不再整机砖化。\n- insert:\n    - id: easy-setup\n      name: \'@deepseek-ai/dsh-easy-setup\'\n      config: {}\n      disabled: true\n',
    ensureBundlePatch: './cordis.patch.yml',
    reason: 'issue#1 缺陷1 纵深：上游无 bundle patch，补一个且行固定 disabled:true（并声明 dsh.bundle.patch 让补丁生效）。',
  },
};

const log = (...a) => console.log('[repack]', ...a);
const die = (msg) => {
  console.error('[repack] FATAL:', msg);
  process.exit(1);
};
const sh = (cmd, opts = {}) =>
  execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
// shell 引用：反斜杠翻倍是 cmd 传参毒药，统一换正斜杠（Windows API 与 tar 均接受）
const q = (p) => JSON.stringify(String(p).replace(/\\/g, '/'));

function loadCatalog(file) {
  return JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, file), 'utf8'));
}

// ---- 合并 catalog：以包名为唯一键，eac.json 为共享条目主记录 ----
const catalogs = {
  eac: loadCatalog('eac.json'),
  aio: loadCatalog('aio.json'),
  skins: loadCatalog('skins.json'),
  community: loadCatalog('community.json'),
};
const byName = new Map();
for (const [cat, list] of Object.entries(catalogs)) {
  for (const item of list) {
    if (item.source === 'unavailable') {
      log(`SKIP ${item.name} (source=unavailable)`);
      continue;
    }
    const prev = byName.get(item.name);
    if (prev) {
      if (prev.version !== item.version) die(`版本冲突 ${item.name}: ${prev.version} vs ${item.version}`);
      if (prev.source !== item.source) die(`来源冲突 ${item.name}: ${prev.source} vs ${item.source}`);
      prev.packs = Array.from(new Set([...prev.packs, ...item.packs]));
      prev._cats.push(cat);
    } else {
      byName.set(item.name, { ...item, _cats: [cat] });
    }
  }
}
let entries = Array.from(byName.values());
if (onlyArg) entries = entries.filter((e) => e.name.includes(onlyArg) || e.id.includes(onlyArg));
// catalog 条目可以带 `distExclude: true` 表示「保留市场元数据，但不打进 dist」。
//
// 为什么需要这个字段而不是直接删 catalog 条目：
//   · 删条目会同时抹掉插件市场里的「可安装」信息（titleZh/descZh/tier/license 等）；
//   · 而 `distExclude` 只让它不进安装包，用户仍能从市场按需装。
//
// 首个使用者是 `dsh-dafeiyu`：已按 external/market 退役，但它带一个 ~49MB 的
// PyInstaller helper，tgz 合计 **160 MB**，占全 dist 289 MB 的 55%。
// 退役前它既不在 seed bundles（不启动）却仍打进 dist —— 纯占体积。
const distExcluded = entries.filter((e) => e.distExclude === true);
if (distExcluded.length) {
  entries = entries.filter((e) => e.distExclude !== true);
  for (const e of distExcluded) log(`DIST-EXCLUDE ${e.name}（catalog 标 distExclude）`);
}
log(`catalog 条目合并完成：${byName.size} 唯一包，本轮处理 ${entries.length}${distExcluded.length ? `（已排除 ${distExcluded.length}）` : ''}`);

// ---- 工具 ----
// 手写递归复制：Windows 上 fs.cpSync 覆盖复制偶发 errno=0 的 unlink 怪癖
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.git' || name === 'node_modules') continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmRf(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* 落到下方兜底 */
  }
  if (!fs.existsSync(p)) return;
  // Windows 兜底：杀软/索引器握住句柄时 rmSync 会【静默失败】（实测报成功但目录仍在）。
  // 改名挪走 + cmd rd /s /q 实测可靠；rd 需要 cmd 风格反斜杠路径。
  const aside = `${p}.del-${Date.now()}`;
  try {
    fs.renameSync(p, aside);
  } catch (e) {
    throw new Error(`rmRf: 无法删除且无法改名 ${p}: ${e.message}`);
  }
  sh(`rd /s /q "${aside.replace(/\//g, '\\')}"`);
  if (fs.existsSync(p)) throw new Error(`rmRf: 删除失败 ${p}`);
}

function materializeNpm(entry, staging) {
  fs.mkdirSync(NPM_TGZ, { recursive: true });
  const isScoped = entry.name.startsWith('@');
  const tgzName = isScoped
    ? `${entry.name.split('/')[0]}+${entry.name.split('/')[1]}-${entry.version}.tgz`
    : `${entry.name}-${entry.version}.tgz`;
  let tgz = path.join(NPM_TGZ, tgzName);
  if (!fs.existsSync(tgz)) {
    log(`npm pack ${entry.name}@${entry.version}`);
    const out = JSON.parse(
      sh(`npm pack ${entry.name}@${entry.version} --pack-destination ${q(NPM_TGZ)} --json`),
    );
    tgz = path.join(NPM_TGZ, out[0].filename);
    const expected = path.join(NPM_TGZ, tgzName);
    if (path.resolve(tgz) !== path.resolve(expected)) fs.renameSync(tgz, expected); // 统一命名便于缓存复用
    tgz = expected;
  }
  if (!fs.existsSync(tgz)) die(`npm tarball 未就位: ${tgz}`);
  const tmp = path.join(STAGING, '.extract');
  rmRf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  // 注意：相对路径调用 tar —— GNU tar 会把 "D:\..." 的冒号解析为远程主机语法
  sh(`tar -xzf ${tgzName} -C ${q(tmp)}`, { cwd: NPM_TGZ });
  const pkgDir = path.join(tmp, 'package');
  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) die(`tarball 内无 package/: ${tgz}`);
  copyTree(pkgDir, staging);
  rmRf(tmp);
}

function materializeEacTag(entry, staging) {
  let src;
  if (entry._cats.includes('skins') && fs.existsSync(path.join(AIO_SKINS, entry.id))) {
    src = path.join(AIO_SKINS, entry.id); // 皮肤（如 maid-atelier）
  } else if (AIO_SEED_PKGS.has(entry.name)) {
    src = path.join(AIO_SEED_NM, ...entry.name.split('/')); // AIO 离线包兜底
  } else {
    const base = entry.name.split('/').pop();
    const dir = DIR_OVERRIDES[base] || base;
    const eacDir = path.join(EAC_PLUGINS, dir);
    const aioDir = path.join(AIO_PLUGINS, dir);
    // 共享条目版本以 EAC 包为准：优先 v5.3.6，目录缺失再回退 aio-v1
    if (fs.existsSync(eacDir)) src = eacDir;
    else if (fs.existsSync(aioDir)) src = aioDir;
    // 第三级兜底：本机既没有 `.cache/eac-src` 也没有 `.cache/aio-src` 时
    // （离线/未拉基线源），退回 full-pack 的 profile-seed —— 它装着同一批
    // AIO 包，且 `AIO_SEED_NM` 已被指向该目录（见上方默认值 / 环境变量）。
    // 没有这一级，全量 repack 会在第一个 AIO-only 包（dsh-aio-ui-compat）
    // 直接 die，导致「清空 dist 后重建」在这台机器上永远跑不通。
    else if (fs.existsSync(path.join(AIO_SEED_NM, ...entry.name.split('/'), 'package.json'))) {
      src = path.join(AIO_SEED_NM, ...entry.name.split('/'));
      log(`fallback to AIO seed for ${entry.name}`);
    } else {
      src = eacDir; // 让下面的 die 报出原本期望的 eac-src 路径
    }
  }
  if (!fs.existsSync(path.join(src, 'package.json'))) die(`eac-tag 源目录缺 package.json: ${src}`);
  log(`copy ${path.relative(ROOT, src) || src} -> staging`);
  copyTree(src, staging);
}

// github / github-repo：浅克隆上游仓库后交给统一规范化。
//
// 可复现性：映射里可以写 `ref` 钉住 commit/tag。实测有必要 —— catalog 的期望
// 版本和仓库 HEAD 会脱钩（例如 @nagi-ovo/dsh-visualize 的 catalog 要 0.1.4，
// 而 .cache 里的克隆是 0.1.7），此时产物取决于本机缓存的运气。给了 ref 就
// 按 ref 分桶缓存并校验 HEAD；没给 ref 则保持历史行为（克隆默认分支）并告警。
//
// 兼容性取舍：不把 ref 设为必填，否则既有 4 个映射会立刻全部 die —— 补 ref
// 需要先确认每个仓库对应哪个 commit，属于独立的一件事，不该和「新增一个源」
// 混在同一个改动里。
function materializeGithub(entry, staging) {
  const gh = GH_SOURCES[entry.name];
  if (!gh) die(`catalog github 来源缺少 GH_SOURCES 映射: ${entry.name}`);
  const ref = gh.ref;
  if (!ref) {
    log(`WARN ${entry.name} 未钉 ref：产物跟随上游默认分支，不可复现`);
    const cloneDir = path.join(CACHE, gh.dir);
    if (!fs.existsSync(path.join(cloneDir, 'package.json'))) {
      log(`git clone --depth 1 ${gh.url}`);
      sh(`git clone --depth 1 ${gh.url} ${q(cloneDir)}`);
    }
    copyTree(cloneDir, staging);
    return;
  }
  const cloneDir = path.join(CACHE, gh.dir);
  const stamp = path.join(cloneDir, '.repack-ref');
  const current = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (!fs.existsSync(path.join(cloneDir, 'package.json')) || current !== ref) {
    rmRf(cloneDir);
    fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
    log(`git clone ${gh.url} @ ${ref}`);
    try {
      // tag / 分支名走 --branch；40 位 SHA 不被 --branch 接受，故全克隆后 checkout。
      sh(`git clone --depth 1 --branch ${q(ref)} ${gh.url} ${q(cloneDir)}`);
    } catch {
      rmRf(cloneDir);
      sh(`git clone ${gh.url} ${q(cloneDir)}`);
      sh(`git -C ${q(cloneDir)} checkout --detach ${q(ref)}`);
    }
    const head = execSync(`git -C ${q(cloneDir)} rev-parse HEAD`, { encoding: 'utf8' }).trim();
    if (!(head === ref || head.startsWith(ref))) {
      die(`github 源钉点不符 ${entry.name}: 期望 ${ref}, 实际 HEAD ${head}`);
    }
    fs.writeFileSync(stamp, ref + '\n');
  }
  copyTree(cloneDir, staging);
}

// github-tgz：下载 release asset（npm-pack 形态 tgz）→ 解包 → 交由统一规范化。
// 兼容 package/ 前缀（npm pack 标准）与平铺两种布局。
const COMMUNITY_TGZ = path.join(CACHE, 'community-tgz');

function materializeGithubTgz(entry, staging) {
  const src = GH_TGZ_SOURCES[entry.name];
  if (!src) die(`catalog github-tgz 来源缺少 GH_TGZ_SOURCES 映射: ${entry.name}`);
  fs.mkdirSync(COMMUNITY_TGZ, { recursive: true });
  const tgz = path.join(COMMUNITY_TGZ, src.url.split('/').pop());
  if (!fs.existsSync(tgz) || fs.statSync(tgz).size < 1024) {
    log(`curl -fL ${src.url}`);
    // --ssl-no-revoke：Windows schannel 对部分代理/网络会报 CRYPT_E_NO_REVOCATION_CHECK
    sh(`curl -fL --ssl-no-revoke --retry 3 --silent --show-error -o ${q(tgz)} ${JSON.stringify(src.url)}`);
  }
  if (!fs.existsSync(tgz) || fs.statSync(tgz).size < 1024) die(`release tgz 下载失败: ${src.url}`);
  const tmp = path.join(STAGING, '.extract-gh-tgz');
  rmRf(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  // 相对路径调用 tar（cwd=缓存目录）：GNU tar 会把 "D:\..." 的冒号解析为远程主机语法
  sh(`tar -xzf ${JSON.stringify(path.basename(tgz))} -C ${q(tmp)}`, { cwd: path.dirname(tgz) });
  const pkgDir = path.join(tmp, 'package');
  if (fs.existsSync(path.join(pkgDir, 'package.json'))) copyTree(pkgDir, staging);
  else if (fs.existsSync(path.join(tmp, 'package.json'))) copyTree(tmp, staging);
  else die(`release tgz 内无 package 目录: ${tgz}`);
  rmRf(tmp);
}

// 生命周期脚本：staging 目录只含发布物（files 白名单），源仓库的构建脚本
// （如 dsh-pet 的 scripts/prepack-check.js）多半不在内，npm pack 会执行
// prepack/prepare 导致失败。重打包语境下一律剥离生命周期脚本；
// preinstall/install/postinstall 同时避免 pnpm pendingBuilds 问题。
const LIFECYCLE_SCRIPTS = [
  'prepack',
  'prepare',
  'postpack',
  'prepublish',
  'prepublishOnly',
  'preinstall',
  'install',
  'postinstall',
];

function rewritePeerDeps(pkg) {
  const changes = [];
  const peers = pkg.peerDependencies;
  if (peers && typeof peers === 'object') {
    const out = { ...peers };
    for (const key of Object.keys(peers)) {
      const range = peers[key];
      if (key === '@deepseek-ai/dsh') {
        if (range !== '>=0.1.0-rc.6') {
          out[key] = '>=0.1.0-rc.6';
          changes.push(`${key}: ${JSON.stringify(range)} -> ">=0.1.0-rc.6"`);
        }
        continue;
      }
      if (!key.startsWith('@deepseek-ai/')) continue;
      const r = String(range).trim();
      if (r === '*' || r === 'x' || r.startsWith('>=')) continue;
      const m = /^[\^~=> ]*\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/.exec(r);
      if (m) {
        out[key] = `>=${m[1]}`;
        changes.push(`${key}: ${JSON.stringify(range)} -> ">=${m[1]}"`);
      } else {
        log(`WARN 未识别的 peer 范围，保持原样: ${key}: ${JSON.stringify(range)}`);
      }
    }
    pkg.peerDependencies = out;
  }
  return changes;
}

function ensureAttributionFiles(pkg, staging) {
  if (!Array.isArray(pkg.files)) return [];
  const added = [];
  for (const f of ALWAYS_KEEP) {
    if (pkg.files.includes(f)) continue;
    if (fs.existsSync(path.join(staging, f))) {
      pkg.files.push(f);
      added.push(f);
    }
  }
  return added;
}

// 补丁重建出的文件必须能过 npm pack 的 `files` 白名单。有 `files` 的包只发布
// 白名单命中的路径 —— 补丁新建的 lib/settings-compat.js 若不在白名单里会被
// **静默丢弃**（tgz 里没有，但 repack 全绿），运行期才炸。
// 实现抽到 ./package-files.mjs，好处是 suite/test 能直接对同一份代码做单元
// 测试，不必跑完整条 300 MB 的打包管线。

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---- 主流程 ----
fs.mkdirSync(DIST, { recursive: true });
fs.mkdirSync(STAGING, { recursive: true });
const index = [];

for (const entry of entries) {
  const file = `${entry.name.replace(/\//g, '_')}-${entry.version}.tgz`;
  const staging = path.join(STAGING, entry.name.replace(/[/@]/g, '_'));
  rmRf(staging);
  fs.mkdirSync(staging, { recursive: true });

  if (entry.source === 'npm') materializeNpm(entry, staging);
  else if (entry.source === 'eac-tag') materializeEacTag(entry, staging);
  else if (entry.source === 'github' || entry.source === 'github-repo') materializeGithub(entry, staging);
  else if (entry.source === 'github-tgz') materializeGithubTgz(entry, staging);
  else die(`未知 source: ${entry.source}`);

  // Tracked, fail-closed source patches (patches/source-patches.json).
  // Replayed here so a rebuild cannot silently drop a local fix that exists
  // only in dist/*.tgz. No-op for packages without a patch entry.
  const appliedSourcePatches = applySourcePatches(entry, staging, log);

  const pkgFile = path.join(staging, 'package.json');
  // 定向覆写：补丁文件与 dsh.bundle.patch 声明要在 npm pack 前落盘
  const override = OVERRIDES[entry.name];
  if (override?.patchYml) fs.writeFileSync(path.join(staging, 'cordis.patch.yml'), override.patchYml);
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  if (override?.version) pkg.version = override.version;
  if (override?.exportsAdd) pkg.exports = { ...(pkg.exports ?? {}), ...override.exportsAdd };
  if (override?.ensureBundlePatch) {
    pkg.dsh = { ...(pkg.dsh ?? {}), bundle: { ...(pkg.dsh?.bundle ?? {}), patch: override.ensureBundlePatch } };
  }
  if (override) log(`  override: ${override.reason}`);
  if (pkg.name !== entry.name) die(`包名不符 catalog: ${pkg.name} != ${entry.name}`);
  if (pkg.version !== entry.version)
    die(`版本漂移 ${entry.name}: 源=${pkg.version} catalog=${entry.version}（请更新 catalog 或锁定源）`);

  const changes = rewritePeerDeps(pkg);
  let strippedScripts = [];
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const s of LIFECYCLE_SCRIPTS) {
      if (pkg.scripts[s]) {
        delete pkg.scripts[s];
        strippedScripts.push(s);
      }
    }
    if (!Object.keys(pkg.scripts).length) delete pkg.scripts;
  }
  const addedFiles = ensureAttributionFiles(pkg, staging);
  // 兜底与越界必须留痕：正常情况下 addedPatched 是精确路径；若补丁路径本身
  // 含 glob 元字符（如新建 `lib/[id].js`），精确条目在 npm 眼里无效，模块会
  // 改用目录条目兜住并写入 warnings。越出包根的路径也会进 warnings。
  const fileWarnings = [];
  const addedPatched = ensurePatchedFiles(pkg, appliedSourcePatches, { warnings: fileWarnings });
  for (const w of fileWarnings) log(`  files: ⚠ ${w}`);
  if (override || changes.length || addedFiles.length || addedPatched.length || strippedScripts.length) {
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
    for (const c of changes) log(`  peer: ${c}`);
    if (strippedScripts.length) log(`  scripts-= ${strippedScripts.join(', ')}`);
    const filesAdded = [...addedFiles, ...addedPatched];
    if (filesAdded.length) log(`  files+= ${filesAdded.join(', ')}`);
  }

  const packOut = JSON.parse(
    sh(`npm pack --json --pack-destination ${q(DIST)}`, { cwd: staging }),
  );
  const produced = path.join(DIST, packOut[0].filename);
  const target = path.join(DIST, file);
  if (path.resolve(produced) !== path.resolve(target)) fs.renameSync(produced, target);

  const bytes = fs.statSync(target).size;
  index.push({
    id: entry.id,
    name: entry.name,
    version: entry.version,
    packs: entry.packs.slice().sort(),
    file,
    sha256: sha256(target),
    bytes,
    source: entry.source,
    ...(appliedSourcePatches.length
      ? {
          locallyRepacked: true,
          // 有包级 summary 时用它（多文件补丁的 per-file note 拼起来会很长，
          // 1367 字符会把 index.json 撑大约 7%，而这些细节更适合留在
          // patches/source-patches.json 里给维护者看）；否则回退拼 per-file note
          // 以保持既有包的行为不变。
          repackNote: appliedSourcePatches[0]?.summary
            ?? appliedSourcePatches.map((p) => p.note).filter(Boolean).join(' '),
        }
      : {}),
  });
  log(`OK ${file} (${bytes} bytes)`);
  rmRf(staging);
}

index.sort((a, b) => a.name.localeCompare(b.name));
// --only 合并模式：保留未重建包的既有 index 记录，只替换本轮重建的包
let finalIndex = index;
if (MERGE_MODE) {
  const prevFile = path.join(DIST, 'index.json');
  if (fs.existsSync(prevFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(prevFile, 'utf8'));
      if (Array.isArray(prev)) {
        const rebuilt = new Set(index.map((e) => e.name));
        finalIndex = [...prev.filter((e) => e?.name && !rebuilt.has(e.name)), ...index];
      }
    } catch (e) {
      log(`WARN 既有 index.json 不可解析（${e.message}），按整体替换处理`);
    }
  }
}
finalIndex.sort((a, b) => String(a.name).localeCompare(String(b.name)));
fs.writeFileSync(path.join(DIST, 'index.json'), JSON.stringify(finalIndex, null, 2) + '\n');
const sums = finalIndex.map((e) => `${e.sha256}  ${e.file}`).join('\n') + '\n';
fs.writeFileSync(path.join(DIST, 'SHA256SUMS'), sums);
// 清理孤儿：旧版本 tgz 与 suite 本体包不得留在 dist/（后者会经 sync 进入
// suite/assets/dist 再被 npm pack 吞下，形成自引用的指数膨胀）。
const wanted = new Set(finalIndex.map((e) => e.file));
const rebuiltPrefixes = index.map((e) => `${e.name.replace(/\//g, '_')}-`);
let orphans = 0;
for (const name of fs.readdirSync(DIST)) {
  if (!name.endsWith('.tgz') || wanted.has(name)) continue;
  // --only 模式只清「本轮重建包名下的旧版本文件」，不碰其它包
  if (MERGE_MODE && !rebuiltPrefixes.some((p) => name.startsWith(p))) continue;
  try {
    fs.rmSync(path.join(DIST, name), { force: true });
    orphans++;
  } catch { /* delete-pending：报告但不阻塞 */ }
}
if (orphans) log(`清理孤儿 tgz：${orphans} 个`);

// 自动补齐 `dsh.bundle` 声明（ensure-bundles）。
//
// 为什么必须自动做：清空 dist 全量重建后，**产物里没有 `dsh.bundle`**，
// 而 seed 的 `dsh.profile.bundles` 又把这些包列进了启动清单。
// 内核加载 bundle 行时要求包自带 `dsh.bundle` 声明，缺失就**静默跳过**：
//
//   dsh: skipping profile bundle "@deepseek-ai/dsh-balance":
//     Error: profile bundle ... declares no dsh.bundle in its package.json
//
// 实测清空 dist 重建后，62 个 seed bundle 里 **16 个**被跳过 —— 包括
// balance / conversation-tweaks / prompt-custom / openclaw-bridge /
// settings-groups 这些补丁包。它们的设置面和功能会全部消失，而启动审计
// 只在最后给一行 `1 entry did not activate`，极难归因。
//
// `ensure-bundles.mjs` 会扫 dist、给缺声明的包补 `dsh.bundle.patch` 并重打 tgz；
// 实测补了 23 个包。它原先只能手工跑，属于「只有本机作者知道的一步」。
//
// 顺序很重要：**先 ensure-bundles，再 sync-bootstrap** —— 前者会改 tgz 字节，
// 后者才能把新 hash 写进 bootstrap.json。
if (!MERGE_MODE) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'repack', 'ensure-bundles.mjs')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true,
    });
    // ensure-bundles 会重写 index.json，重新读一遍
    finalIndex = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));
    log('已补齐 dsh.bundle 声明（ensure-bundles）');
  } catch (err) {
    const out = err && (err.stdout || err.stderr) ? String(err.stdout || err.stderr) : '';
    log(`WARN 补齐 dsh.bundle 失败：${(err.message || '').split('\n')[0]}`);
    if (out) log('  ' + out.trim().split('\n').slice(-3).join('\n  '));
    log('  → 产物已生成；请手动运行 node scripts/repack/ensure-bundles.mjs');
  }
} else {
  log('（--only 模式跳过 ensure-bundles：它需要完整 dist 才能判定 bundle 清单）');
}


// 自动同步 suite/assets/bootstrap.json 里与本轮重建相关的条目。
//
// 为什么必须自动做：`full-package.test.mjs` 有一条断言「manifest hash must
// match dist」。repack 改变 tgz 字节后若不回写 bootstrap，这条就会红 ——
// 而这个同步原先只是 `.cache/` 里的一个 gitignored 一次性脚本，
// 等于「只有本机作者知道的一步」。实测踩过：重打包 4 个 create 包做回归，
// 之后测试报 `@deepseek-ai/dsh-conversation-tweaks: manifest hash must match dist`，
// 排查一轮才想起要手动跑那个脚本。
//
// 同步范围刻意收窄（与 sync-bootstrap.mjs 一致）：
//   · 全量模式：只同步 manifest.patches 里登记过的包；
//   · --only 模式：只同步**本轮重建**且**已登记在 manifest** 的包，
//     避免单包重打包时顺手改到别人的条目。
try {
  const { syncBootstrapEntries } = await import('./sync-bootstrap.mjs');
  const manifestPath = path.join(ROOT, 'patches', 'source-patches.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const touchable = new Set(manifest.patches.map((p) => p.name));
  const scope = MERGE_MODE
    ? index.filter((e) => touchable.has(e.name)).map((e) => e.name)
    : undefined; // undefined = 全量：同步所有已登记补丁包
  const changed = syncBootstrapEntries({ names: scope, log });
  if (changed) log(`同步 bootstrap.json：${changed} 条`);
} catch (err) {
  // 不因同步失败而判定整轮 repack 失败 —— 产物本身是对的，bootstrap 可以事后补。
  // 但必须响亮提示，否则又是"静默漏了一步"。
  log(`WARN 同步 suite/assets/bootstrap.json 失败：${err && err.message ? err.message : err}`);
  log('  → 产物已生成；请手动运行 node scripts/repack/sync-bootstrap.mjs');
}

log(`完成：dist/ 共 ${finalIndex.length} 个 tgz + index.json + SHA256SUMS${MERGE_MODE ? `（合并模式，本轮重建 ${index.length} 个）` : ''}`);
