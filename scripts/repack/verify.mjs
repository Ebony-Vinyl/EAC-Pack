#!/usr/bin/env node
/**
 * dist/ 产物校验：
 *  (a) dist/index.json 与 catalog 一一对应（唯一包名级），共享条目 packs 合并一致；
 *  (b) 每个条目：tgz 存在、sha256/bytes 与文件实况一致、tgz 内 package.json 的
 *      name/version 与条目一致；
 *  (c) peer 范围检查（semver@7，prereleases participate in range matching，
 *      即 includePrerelease:true）：
 *        - peerDependencies["@deepseek-ai/dsh"]（若有）必须被 0.2.0-rc.2 满足；
 *        - 其余 @deepseek-ai/* peer 必须为放宽形态（"*" 或以 ">=" 开头），
 *          且其 floor 本身满足该范围（floor 保留校验）；
 *  (d) SHA256SUMS 行与 index.json 完全一致；
 *  (e) 安装脚本（preinstall/install/postinstall）预警。
 *
 * 用法：node verify.mjs
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const semver = require('semver'); // 只存在于 scripts/repack/node_modules

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const TARGET = '0.2.0-rc.2'; // 官方桌面端目标版本

let failures = 0;
const warn = (msg) => console.error('[verify] WARN :', msg);
const fail = (msg) => {
  failures++;
  console.error('[verify] FAIL :', msg);
};
const ok = (msg) => console.log('[verify] ok   :', msg);

const catalog = {};
for (const f of ['eac.json', 'aio.json', 'skins.json', 'community.json']) {
  for (const item of JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', f), 'utf8'))) {
    (catalog[item.name] ||= []).push({ ...item, _cat: f });
  }
}
const index = JSON.parse(fs.readFileSync(path.join(DIST, 'index.json'), 'utf8'));

// (a) index <-> catalog 一一对应
const indexByName = new Map(index.map((e) => [e.name, e]));
let expected = 0;
for (const [name, items] of Object.entries(catalog)) {
  const srcs = new Set(items.map((i) => i.source));
  if (srcs.has('unavailable')) {
    if (indexByName.has(name)) fail(`${name} 标记 unavailable 却出现在 index.json`);
    continue;
  }
  expected++;
  const versions = new Set(items.map((i) => i.version));
  if (versions.size > 1) fail(`catalog 内 ${name} 版本不一致: ${[...versions]}`);
  const e = indexByName.get(name);
  if (!e) fail(`index.json 缺少 ${name}`);
  else {
    if (e.version !== items[0].version) fail(`${name} 版本不符: index=${e.version} catalog=${items[0].version}`);
    const packsUnion = [...new Set(items.flatMap((i) => i.packs))].sort();
    if (JSON.stringify([...e.packs].sort()) !== JSON.stringify(packsUnion))
      fail(`${name} packs 不符: index=${e.packs} catalog并集=${packsUnion}`);
  }
}
if (indexByName.size !== expected) {
  const extra = [...indexByName.keys()].filter((n) => !catalog[n]);
  fail(`index.json 条目数(${indexByName.size}) != catalog 可分发数(${expected})；多出: ${extra.join(', ')}`);
} else ok(`index.json 与 catalog 一一对应（${expected} 项）`);

// (b)(c)(e) 逐条目校验
for (const e of index) {
  const file = path.join(DIST, e.file);
  if (!fs.existsSync(file)) {
    fail(`${e.file} 不存在`);
    continue;
  }
  const bytes = fs.statSync(file).size;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash !== e.sha256) fail(`${e.file} sha256 不符`);
  if (bytes !== e.bytes) fail(`${e.file} bytes 不符`);

  let pkg;
  try {
    // 相对路径调用 tar（cwd=DIST）：GNU tar 会把绝对路径里的 "D:" 解析为远程主机
    pkg = JSON.parse(execSync(`tar -xOzf ${JSON.stringify(e.file)} package/package.json`, { encoding: 'utf8', cwd: DIST }));
  } catch (err) {
    fail(`${e.file} 读取 package.json 失败: ${err.message.split('\n')[0]}`);
    continue;
  }
  if (pkg.name !== e.name) fail(`${e.file} 内 name=${pkg.name} != ${e.name}`);
  if (pkg.version !== e.version) fail(`${e.file} 内 version=${pkg.version} != ${e.version}`);

  const peers = pkg.peerDependencies || {};
  for (const [key, range] of Object.entries(peers)) {
    const r = String(range);
    if (key === '@deepseek-ai/dsh') {
      if (!semver.satisfies(TARGET, r, { includePrerelease: true }))
        fail(`${e.name}: peer ${key}@${r} 不被 ${TARGET} 满足`);
      continue;
    }
    if (key.startsWith('@deepseek-ai/')) {
      if (!(r === '*' || r.trim().startsWith('>='))) {
        fail(`${e.name}: peer ${key}@${r} 未放宽（应为 ">=floor" 或 "*"）`);
        continue;
      }
      const m = /^>=\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(r.trim());
      if (m && !semver.satisfies(m[1], r, { includePrerelease: true }))
        fail(`${e.name}: peer ${key}@${r} 的 floor ${m[1]} 不在范围内（floor 丢失）`);
    }
  }
  for (const s of ['preinstall', 'install', 'postinstall']) {
    if (pkg.scripts && pkg.scripts[s]) warn(`${e.name} 含 ${s} 安装脚本（pnpm 可能 pendingBuilds）`);
  }
}
ok(`逐条目校验完成：${index.length} 个 tgz`);

// (d) SHA256SUMS 一致性
const sums = fs.readFileSync(path.join(DIST, 'SHA256SUMS'), 'utf8').trim().split('\n');
if (sums.length !== index.length) fail(`SHA256SUMS 行数(${sums.length}) != index 条目数(${index.length})`);
for (const line of sums) {
  const [hash, file] = line.split(/\s{2}/);
  const e = index.find((x) => x.file === file);
  if (!e) fail(`SHA256SUMS 含未知文件 ${file}`);
  else if (e.sha256 !== hash) fail(`SHA256SUMS ${file} 哈希与 index.json 不符`);
}
ok('SHA256SUMS 一致性完成');

// (f) 内核导出兼容：产物里的服务端源码不得 import 内核已删除的具名导出。
// 单列成模块是因为它需要静态解析内核包导出集合，比上面几项重得多；
// 内核目录默认取并排检出的 Desktop，可用 --kernel <dir> 或 $DSH_KERNEL_ROOT 覆盖。
// 找不到内核时**不算失败**（只跳过并提示）—— CI 里 Pack 与 Desktop 未必同装。
try {
  const { checkKernelCompat, formatReport, guessKernelRoot } = await import('./kernel-compat.mjs');
  // 与 kernel-compat.mjs 的 main() 保持同一套参数优先级：显式 --kernel 优先，
  // 其次 $DSH_KERNEL_ROOT，最后按目录布局猜。verify.mjs 也要认 --kernel，
  // 否则文档里写的覆盖方式在这条调用路径上是空的。
  const kernelArgIdx = process.argv.indexOf('--kernel');
  const kernelArg = kernelArgIdx !== -1
    && process.argv[kernelArgIdx + 1]
    && !process.argv[kernelArgIdx + 1].startsWith('--')
    ? process.argv[kernelArgIdx + 1]
    : undefined;
  const kernelRoot = kernelArg ? path.resolve(kernelArg) : guessKernelRoot();
  const result = checkKernelCompat({ kernelRoot });
  if (!result.kernelExists) {
    warn(`内核目录不存在，跳过导出兼容校验（用 --kernel <dir> 或 DSH_KERNEL_ROOT 指定；试过 ${kernelRoot ?? '(无候选路径)'}）`);
  } else if (result.ok) {
    ok(`内核导出兼容：${result.stats.packageCount} 个产物 / ${result.stats.refCount} 处具名导入全部可解析`);
  } else {
    console.error(formatReport(result));
    failures += result.hits.length;
  }
} catch (err) {
  warn(`内核导出兼容校验无法执行: ${String(err && err.message ? err.message : err)}`);
}

if (failures) {
  console.error(`\n[verify] 结果：FAIL（${failures} 项不合格）`);
  process.exit(1);
}
console.log(`\n[verify] 结果：PASS（${index.length} 个 tgz 全部合格；peer 对 ${TARGET} 满足）`);
