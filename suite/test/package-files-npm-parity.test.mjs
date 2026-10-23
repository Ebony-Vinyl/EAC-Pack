/**
 * `files` 覆盖判定 与 **真实 npm-packlist** 的差分测试。
 *
 * 为什么要差分而不是只写断言
 * --------------------------
 * `package-files.test.mjs` 里的断言都是我「以为」的 npm 语义。上一轮已经
 * 因此翻过两次车：
 *   - `./` 前缀只在 glob 分支生效，精确/目录分支全失效；
 *   - 「字符类按字面量处理，方向安全」——**方向不安全**，见下。
 *
 * 所以这里不再让我复述 npm 的行为，而是把 npm 自己的 npm-packlist 跑起来，
 * 在临时目录里造出真实文件，看它到底把哪些文件打进包，再拿结果跟
 * `isCoveredByFilesEntry` 对账。
 *
 * 契约（两向都断言，因为两侧的错代价不同）
 * ----------------------------------------
 *   A. npm 收了 而 本实现说「未覆盖」 → 白名单变胖，**无害**，允许。
 *   B. npm 没收 而 本实现说「已覆盖」   → 文件被静默丢弃，**致命**，禁止。
 *
 * 只钉 B。A 方向留白是有意的：本实现只认 `*`、不认 `[`/`?`/`{}`，也做了
 * 大小写敏感比较，这些都是「更保守」的偏差，不应被测试误判为缺陷。
 *
 * 依赖缺失时怎么办
 * ----------------
 * npm-packlist 来自本机 npm 安装，不属于本项目依赖。找不到就**跳过**，
 * 但跳过必须显式可见（`t.skip` 带原因），不能让绿条掩盖「没验」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCoveredByFilesEntry, ensurePatchedFiles } from '../../scripts/repack/package-files.mjs';

/** 尝试加载 npm-packlist；拿不到返回 null。 */
function loadPacklist() {
  const candidates = [];
  // 1) 从 npm 自身的 package.json 解析（最可靠）
  const { execPath } = process;
  for (const npmRoot of [
    path.join(path.dirname(execPath), 'node_modules', 'npm', 'package.json'),
    path.join(path.dirname(path.dirname(execPath)), 'lib', 'node_modules', 'npm', 'package.json'),
    'C:/Program Files/study apps/node_modules/npm/package.json',
    'C:/Program Files/nodejs/node_modules/npm/package.json',
  ]) {
    if (fs.existsSync(npmRoot)) candidates.push(npmRoot);
  }
  // 2) 本项目自己的 node_modules（若将来把 npm-packlist 提为 devDependency）
  candidates.push(path.join(process.cwd(), 'package.json'));

  for (const from of candidates) {
    try {
      const req = createRequire(from);
      const walk = req('npm-packlist');
      if (typeof walk === 'function') return walk;
    } catch {
      /* 换下一个 */
    }
  }
  return null;
}

const walk = loadPacklist();

/**
 * 造一个临时包目录，跑真实 npm-packlist，返回被收进包的文件列表
 * （不含 package.json 自身）。
 */
async function npmPackFiles(files, diskFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-packlist-'));
  try {
    for (const f of diskFiles) {
      const abs = path.join(dir, f);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, 'x');
    }
    const pkg = { name: 'probe', version: '1.0.0', files };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    const out = await walk({ path: dir, package: pkg });
    return out.filter((f) => f !== 'package.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 差分对账：给定 files 条目与磁盘文件，逐条检查「npm 没收 → 本实现不得说
 * 已覆盖」。
 */
async function assertNoDangerousOverclaim(files, diskFiles) {
  const packed = new Set(await npmPackFiles(files, diskFiles));
  const bad = [];
  for (const f of diskFiles) {
    const npmTookIt = packed.has(f);
    const weSayCovered = files.some((e) => isCoveredByFilesEntry(f, e));
    if (!npmTookIt && weSayCovered) bad.push(f);
  }
  assert.deepEqual(
    bad,
    [],
    `本实现声称已覆盖、但 npm 实际丢弃的文件：${JSON.stringify(bad)}\n` +
      `  files=${JSON.stringify(files)} 磁盘=${JSON.stringify(diskFiles)} 打包=${JSON.stringify([...packed])}\n` +
      `  → 这些文件不会被补进白名单，npm pack 静默丢弃`,
  );
}

test('差分：真实 npm-packlist 未收的文件，本实现不得判为已覆盖', async (t) => {
  if (!walk) {
    t.skip('本机找不到 npm-packlist，跳过差分（不是通过，是没验）');
    return;
  }
  // 每组都是真实会出现的条目形态。含元字符的用例是上一轮的漏判点。
  // 注意：`?` 在 Windows 上不是合法文件名字符，无法造真实文件，故只保留
  // 方括号（Windows 允许）—— `?` 的判定在下面用纯函数断言覆盖。
  const scenarios = [
    [['lib/[ab].js'], ['lib/a.js', 'lib/[ab].js']],
    [['lib/[id].js'], ['lib/[id].js']],
    [['lib/*.js'], ['lib/top.js', 'lib/a/deep.js']],
    [['lib/x.js'], ['lib/x.js', 'lib/y.js']],
    [['lib/'], ['lib/a.js', 'lib/[ab].js']],
    [['lib/**'], ['lib/a.js', 'lib/[ab].js']],
    [['lib'], ['lib/deep/x.js']],
    [['*.js'], ['lib/a.js', 'top.js']],
  ];
  for (const [files, disk] of scenarios) {
    await assertNoDangerousOverclaim(files, disk);
  }
});

test('回归：含方括号的真实文件名被目录条目覆盖时判为已覆盖', () => {
  // npm 实测 files=['lib/'] 能把 lib/[ab].js 打进包（目录展开成 lib/**）。
  assert.equal(isCoveredByFilesEntry('lib/[ab].js', 'lib/'), true);
  assert.equal(isCoveredByFilesEntry('lib/[ab].js', 'lib/**'), true, '** 吃整段，含元字符的段也能被 ** 覆盖');
});

test('危险方向：条目含元字符时，精确等值不得判为已覆盖', () => {
  // 这是上一轮的致命漏判：`e === p` 早退成 true，而 npm 把条目当模式解析，
  // 匹配的是 lib/a.js，不是 lib/[ab].js 自己（npm-packlist 实测打包结果
  // = ['lib/a.js']，那个真实文件被丢弃）。
  // 判 false 才是安全方向：调用方会补条目，文件不会丢。
  assert.equal(
    isCoveredByFilesEntry('lib/[ab].js', 'lib/[ab].js'),
    false,
    'npm 不会把 lib/[ab].js 收进包，判 true 就等于放任它被静默丢弃',
  );
  assert.equal(isCoveredByFilesEntry('lib/?.js', 'lib/?.js'), false);
  assert.equal(isCoveredByFilesEntry('lib/[ab].js', 'lib/[cd].js'), false);
  // 含 * 的通配条目仍能正常展开
  assert.equal(isCoveredByFilesEntry('lib/[ab].js', 'lib/*.js'), true);
});

test('ensurePatchedFiles：含元字符的补丁路径改用目录条目兜住，而不是 push 精确路径', () => {
  const warnings = [];
  const pkg = { files: ['LICENSE'] };
  const added = ensurePatchedFiles(pkg, [{ path: 'lib/[id].js' }], { warnings });
  // push 精确条目救不回来 —— npm 仍按模式解析，必须用目录条目
  assert.deepEqual(added, ['lib/']);
  assert.ok(pkg.files.includes('lib/'));
  assert.ok(!pkg.files.includes('lib/[id].js'), '精确条目对含元字符路径无效，不应写入');
  assert.equal(warnings.length, 1, '兜底必须留痕');
  assert.match(warnings[0], /glob 元字符/);
});

test('ensurePatchedFiles：已有目录条目覆盖时，含元字符路径无需再补', () => {
  const warnings = [];
  const pkg = { files: ['lib/'] };
  const added = ensurePatchedFiles(pkg, [{ path: 'lib/[id].js' }], { warnings });
  assert.deepEqual(added, []);
  assert.equal(warnings.length, 0);
});

test('越界路径：不得被判为已覆盖，也不得写进 files', () => {
  for (const bad of ['../outside.js', '/etc/passwd', 'C:/Windows/x.js']) {
    assert.equal(isCoveredByFilesEntry(bad, '**'), false, `${bad} 不应被 '**' 判为已覆盖`);
    assert.equal(isCoveredByFilesEntry(bad, bad), false, `${bad} 不应被自身条目判为已覆盖`);
  }
  const warnings = [];
  const pkg = { files: ['LICENSE'] };
  const added = ensurePatchedFiles(pkg, [{ path: '../outside.js' }], { warnings });
  assert.deepEqual(added, []);
  assert.deepEqual(pkg.files, ['LICENSE'], '越界路径不得污染 files');
  assert.equal(warnings.length, 1);
});

test('前导 `/` 的条目等价于无前导 `/`（npm 实测）', () => {
  // npm-packlist 实测：files=['/lib/'] 与 ['lib/'] 都能收 lib/a.js
  assert.equal(isCoveredByFilesEntry('lib/a.js', '/lib/'), true);
  assert.equal(isCoveredByFilesEntry('lib/a.js', '/lib'), true);
  assert.equal(isCoveredByFilesEntry('lib/a/b.js', '/lib/**'), true);
});
