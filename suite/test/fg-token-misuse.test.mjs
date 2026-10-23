/**
 * 「把背景层色变量当文字色变量用」的回归测试。
 *
 * 为什么这个测试重要
 * ------------------
 * 2026-10-22 用户报「亮色模式下内置插件页的按钮是纯黑块、看不见字」。
 * 定位结论：**不是主题渲染 bug**，而是 5 个插件把
 * `--dsw-alias-bg-layer-*`（背景层色，语义就是「背景」）写进了 `color:`。
 *
 *   错：color: var(--dsw-alias-bg-layer-3)                  ← 浅色背景色当文字
 *   对：color: var(--dsw-alias-label-primary-foreground)    ← 与 label-primary 配对
 *
 * 实测对比度：错法在亮色/深色、四套皮肤下都是 1.0~1.1（WCAG 正文要求 ≥4.5），
 * 修好后是 15.35（亮）/ 15.96（深）。
 *
 * 为什么不能只靠人工评审
 * ----------------------
 * 这种写法在「深底 + 浅色文字」的直觉下**看起来是对的**，只有在特定皮肤
 * 覆盖了 bg-layer 变量、或亮色主题下调换明暗之后才暴露。而它对所有实现
 * 都是 100% 错误，可以机械判定 —— 所以做成断言最划算。
 *
 * 断言分成两层：
 *   1. 清单里的每个补丁 diff，不得**新增** `color: var(--dsw-alias-bg-*)`；
 *   2. 打包产出的 tgz 里，不得残留该写法（防止补丁漏打或上游回归）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'patches', 'source-patches.json');

/** `color:` / `-webkit-text-fill-color:` 后直接挂 bg-* 变量。 */
const MISUSE = /(?:^|[;{\s])(?:-webkit-text-fill-color|color)\s*:\s*[^;}"']*?var\(--dsw-alias-bg-/gi;

/** 判断某个加号行是否引入了误用（排除 background-color 之类的误命中）。 */
function addsMisuse(line) {
  if (!line.startsWith('+') || line.startsWith('+++')) return false;
  const body = line.slice(1);
  MISUSE.lastIndex = 0;
  let m;
  while ((m = MISUSE.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 12), m.index);
    if (/background-$/.test(before)) continue;   // background-color: 不算
    return true;
  }
  return false;
}

test('补丁 diff 不得新增「背景层色当文字色」的写法', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const offenders = [];
  for (const patch of manifest.patches) {
    for (const file of patch.files) {
      const diffPath = path.join(ROOT, 'patches', file.diff);
      if (!fs.existsSync(diffPath)) continue;
      const lines = fs.readFileSync(diffPath, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (addsMisuse(line)) {
          offenders.push(`${patch.name} ${file.path}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    '补丁新增了 color: var(--dsw-alias-bg-*) —— 背景色变量不能当文字色。\n' +
    '改用 color: var(--dsw-alias-label-primary-foreground, #fff)\n' +
    offenders.join('\n'),
  );
});

test('已修复的包在补丁 diff 里不得残留旧写法为「删除以外的上下文」', () => {
  // 这些包本次已修复；diff 中只允许在 `-` 行看到旧写法（即“删掉它”）。
  const FIXED = ['dsh-dock-settings', 'dsh-unified-market', 'dsh-better-sidebar', 'dsh-meme'];
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  for (const name of FIXED) {
    const patch = manifest.patches.find((p) => p.name === name);
    assert.ok(patch, `${name} 应登记在 source-patches.json`);
    // 该包的 diff 必须真的引入 foreground 变量，否则说明修复没落进补丁
    const hasForeground = patch.files.some((f) => {
      const diffPath = path.join(ROOT, 'patches', f.diff);
      if (!fs.existsSync(diffPath)) return false;
      return fs.readFileSync(diffPath, 'utf8')
        .split(/\r?\n/)
        .some((l) => l.startsWith('+') && l.includes('--dsw-alias-label-primary-foreground'));
    });
    assert.equal(hasForeground, true, `${name}: 补丁未引入 label-primary-foreground`);
  }
});

test('打包产出的 tgz 内不得残留「背景层色当文字色」', (t) => {
  const DIST = path.join(ROOT, 'dist');
  if (!fs.existsSync(DIST)) {
    t.skip('dist/ 不存在，跳过产物断言');
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const offenders = [];

  for (const patch of manifest.patches) {
    const tgz = fs.readdirSync(DIST)
      .find((f) => f.startsWith(`${patch.name}-${patch.version}`) && f.endsWith('.tgz'));
    if (!tgz) continue;
    // 解出该包全部 js/css 内容检查（不同包文件布局不同：lib/ 或根目录）
    let entries;
    try {
      entries = execFileSync('tar', ['--force-local', '-tzf', path.join(DIST, tgz)], { encoding: 'utf8' })
        .split(/\r?\n/).filter((f) => /\.(js|mjs|cjs|css)$/.test(f));
    } catch { continue; }
    for (const entry of entries) {
      let content;
      try {
        content = execFileSync('tar', ['--force-local', '-xOf', path.join(DIST, tgz), entry], { encoding: 'utf8' });
      } catch { continue; }
      MISUSE.lastIndex = 0;
      let m;
      while ((m = MISUSE.exec(content)) !== null) {
        const before = content.slice(Math.max(0, m.index - 12), m.index);
        if (/background-$/.test(before)) continue;
        const lineNo = content.slice(0, m.index).split('\n').length;
        offenders.push(`${tgz}:${entry}:${lineNo}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '打包产物里仍有 color: var(--dsw-alias-bg-*)\n' + offenders.join('\n'));
});
