/**
 * `files` 白名单补齐的回归测试（scripts/repack/package-files.mjs）。
 *
 * 为什么这个测试重要
 * ------------------
 * npm pack 会按 `package.json` 的 `files` 白名单过滤产物。补丁新建的文件
 * （例如 `lib/settings-compat.js`）如果没被补进白名单，`npm pack` 会**静默
 * 丢弃**它 —— repack 全绿、tgz 里却没有该文件，直到插件在运行期 import
 * 失败才暴露。这类缺陷没法靠"跑一遍打包看有没有报错"发现，必须专门断言。
 *
 * 用例覆盖三种判断：精确路径、目录前缀、glob 前缀；以及最容易出错的两个
 * 反例 —— 标题相同但不在同一目录的路径、以及没有 files 字段的包。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCoveredByFilesEntry, ensurePatchedFiles } from '../../scripts/repack/package-files.mjs';

test('精确路径只匹配自身', () => {
  assert.equal(isCoveredByFilesEntry('lib/index.js', 'lib/index.js'), true);
  assert.equal(isCoveredByFilesEntry('lib/client.js', 'lib/index.js'), false);
  // 前缀相同但不是同一文件 —— 不能被误判为覆盖
  assert.equal(isCoveredByFilesEntry('lib/index.js.map', 'lib/index.js'), false);
});

test('目录条目（带或不带斜杠）覆盖其下全部内容', () => {
  for (const entry of ['lib/', 'lib']) {
    assert.equal(isCoveredByFilesEntry('lib/settings-compat.js', entry), true);
    assert.equal(isCoveredByFilesEntry('lib/deep/nested.js', entry), true);
  }
  // 不在该目录下的同名文件不算覆盖
  assert.equal(isCoveredByFilesEntry('src/settings-compat.js', 'lib/'), false);
  // 兄弟目录不能被前缀误吞（'library/...' 不是 'lib/' 的内容）
  assert.equal(isCoveredByFilesEntry('library/x.js', 'lib/'), false);
});

test('glob 条目按「前缀 + 后缀」覆盖，不能只看前缀', () => {
  assert.equal(isCoveredByFilesEntry('lib/types/index.d.ts', 'lib/types/**/*.d.ts'), true);
  assert.equal(isCoveredByFilesEntry('lib/types/client/api.d.ts', 'lib/types/**/*.d.ts'), true);
  // 同目录但不在 glob 子树下
  assert.equal(isCoveredByFilesEntry('lib/settings-compat.js', 'lib/types/**/*.d.ts'), false);

  // 回归：**同目录、但后缀不符** —— 曾经被判为已覆盖，导致文件被 npm 静默丢弃。
  // 这正是本模块要防的失败模式（create 模式补丁漏文件），却在判据里复现过一次。
  assert.equal(
    isCoveredByFilesEntry('lib/types/helper.js', 'lib/types/**/*.d.ts'),
    false,
    'lib/types/**/*.d.ts 不应覆盖 .js —— 否则该文件不会补进白名单，npm pack 静默丢弃',
  );
  assert.equal(isCoveredByFilesEntry('lib/types/helper.mjs', 'lib/types/**/*.d.ts'), false);
  assert.equal(isCoveredByFilesEntry('lib/types/helper.d.ts', 'lib/types/**/*.d.ts'), true);

  // 尾缀纯通配（'lib/**'）时，前缀之后全都覆盖
  assert.equal(isCoveredByFilesEntry('lib/deep/nested/x.js', 'lib/**'), true);
  assert.equal(isCoveredByFilesEntry('other/x.js', 'lib/**'), false);

  // 目的目录不应误覆盖同名前缀的兄弟目录
  assert.equal(isCoveredByFilesEntry('library/x.js', 'lib/**'), false);
});

test('单星 `*` 只匹配一个路径段，不得跨 `/`（与 npm pack 实测一致）', () => {
  // 曾经把单个 `*` 当成能跨段的 `**`，于是 `lib/*.js` 误判覆盖 `lib/a/top.js`。
  // 实测 npm 11.6.2：files=['lib/*.js'] 只收 lib/top.js，不收 lib/a/top.js。
  // 影响面不是理论风险 —— dist 里已有 10 个在销包用单星条目
  // （dsh-raw-html 的 lib/*.js、三个皮肤的 locale/*.json 与 assets/icons/*.ico）。
  assert.equal(isCoveredByFilesEntry('lib/top.js', 'lib/*.js'), true, '同层应覆盖');
  assert.equal(isCoveredByFilesEntry('lib/a/top.js', 'lib/*.js'), false, '子目录不应覆盖');

  assert.equal(isCoveredByFilesEntry('lib/a/index.js', 'lib/*/index.js'), true, '单星占一段应覆盖');
  assert.equal(isCoveredByFilesEntry('lib/a/b/index.js', 'lib/*/index.js'), false, '单星只占一段，深两层不覆盖');

  // 皮肤包的真实条目形态
  assert.equal(isCoveredByFilesEntry('locale/zh.json', 'locale/*.json'), true);
  assert.equal(isCoveredByFilesEntry('locale/sub/en.json', 'locale/*.json'), false);
  assert.equal(isCoveredByFilesEntry('assets/icons/a.ico', 'assets/icons/*.ico'), true);
  assert.equal(isCoveredByFilesEntry('assets/icons/x/b.ico', 'assets/icons/*.ico'), false);

  // 双星才跨段
  assert.equal(isCoveredByFilesEntry('lib/a/b/deep.js', 'lib/**/*.js'), true);
});

test('无 files 字段时不动 pkg（npm 会收全部内容）', () => {
  const pkg = { name: 'x' };
  const added = ensurePatchedFiles(pkg, [{ path: 'lib/new.js' }]);
  assert.deepEqual(added, []);
  assert.equal('files' in pkg, false);
});

test('未覆盖的补丁文件被补进白名单，且只补一次', () => {
  // 模拟 dsh-better-sidebar 的真实 files 形态：逐条列 lib/*.js，不含新建的 compat
  const pkg = {
    files: ['lib/index.js', 'lib/invariant.js', 'lib/client.js', 'cordis.patch.yml', 'LICENSE'],
  };
  const added = ensurePatchedFiles(pkg, [
    { path: 'lib/settings-compat.js' },
    { path: 'lib/index.js' }, // 已被精确条目覆盖 → 不重复添加
  ]);
  assert.deepEqual(added, ['lib/settings-compat.js']);
  assert.equal(pkg.files.filter((f) => f === 'lib/settings-compat.js').length, 1);
  assert.equal(pkg.files.filter((f) => f === 'lib/index.js').length, 1);
});

test('已覆盖的补丁文件不会被重复添加', () => {
  const dirPkg = { files: ['lib/'] };
  assert.deepEqual(ensurePatchedFiles(dirPkg, [{ path: 'lib/settings-compat.js' }]), []);
  const globPkg = { files: ['lib/types/**/*.d.ts'] };
  assert.deepEqual(ensurePatchedFiles(globPkg, [{ path: 'lib/types/x.d.ts' }]), []);
});

test('多个补丁文件按顺序补齐', () => {
  const pkg = { files: ['LICENSE'] };
  const added = ensurePatchedFiles(pkg, [
    { path: 'lib/a.js' },
    { path: 'lib/b.js' },
    { path: 'lib/a.js' }, // 重复输入 → 第二次应命中已 push 的条目
  ]);
  assert.deepEqual(added, ['lib/a.js', 'lib/b.js']);
});

/**
 * `**` 必须能吃掉 **0 个**路径段（`a/**\/b` 要匹配 `a/b`）。
 *
 * 这是 globstar 语义最容易写错的地方：若 `**` 被实现成「至少吃 1 段」，
 * `lib/**\/*.js` 就匹配不到 `lib/x.js`。而本模块的失败方向是「误判未覆盖
 * → 白名单多补一条精确路径」（无害），所以这种错**不会让测试变红**，
 * 只会让白名单逐渐变胖 —— 正因如此需要显式钉住。
 */
test('globstar 吃 0 段：a/**\/b 匹配 a/b', () => {
  assert.equal(isCoveredByFilesEntry('a/b', 'a/**/b'), true, '** 应可吃 0 段');
  assert.equal(isCoveredByFilesEntry('a/x/b', 'a/**/b'), true, '** 吃 1 段');
  assert.equal(isCoveredByFilesEntry('a/x/y/b', 'a/**/b'), true, '** 吃多段');
  assert.equal(isCoveredByFilesEntry('a/b/c', 'a/**/b'), false, '尾部不得多段');
  assert.equal(isCoveredByFilesEntry('a/b', 'a/*/b'), false, '单星必须吃满一段');
  assert.equal(isCoveredByFilesEntry('lib/x.js', 'lib/**/*.js'), true, 'lib/**/*.js 应覆盖 lib/x.js');
});

/** 前导 `./` 归一化：npm 的 files 条目允许写 `./lib/`。 */
test('./ 前缀的条目同样生效', () => {
  assert.equal(isCoveredByFilesEntry('lib/index.js', './lib/index.js'), true);
  assert.equal(isCoveredByFilesEntry('lib/a/x.js', './lib/**/*.js'), true);
});

/**
 * 字符类与 `?` 本实现不解析 —— 但**方向并不安全**，必须说清楚。
 *
 * 原先这条测试的标题写的是「已知限制，方向安全」，理由是「误判未覆盖 →
 * 多补精确路径（无害）」。这个理由是错的：真正危险的不是「漏判」，而是
 * 「路径本身含元字符时被判成已覆盖」。
 *
 * 反例（npm-packlist 实测）：files=['lib/[ab].js'] 且磁盘上真有
 * `lib/[ab].js` 时，npm 把条目当字符类，收 `lib/a.js`，把 `lib/[ab].js`
 * **丢弃**。旧实现在 `e === p` 处早退成 true，于是「已覆盖」→ 不补白名单
 * → 文件无声消失。这条正是本模块存在的意义所在。
 *
 * 现在的行为：路径含元字符而条目不含 `*` → 一律判未覆盖，由
 * ensurePatchedFiles 改用目录条目兜住。详细差分见
 * `package-files-npm-parity.test.mjs`（会真的跑一遍 npm-packlist）。
 */
test('字符类与 ? 不被当作通配（已知限制，但危险方向已被堵住）', () => {
  // 条目含元字符、路径不含 → 本实现不展开，判未覆盖（安全方向：多补条目）
  assert.equal(isCoveredByFilesEntry('lib/a.js', 'lib/[ab].js'), false, '当前不解析字符类');
  assert.equal(isCoveredByFilesEntry('lib/x.js', 'lib/?.js'), false, '当前不解析 ?');

  // 危险方向：路径自身含元字符、条目按字面写 → 必须判未覆盖
  assert.equal(
    isCoveredByFilesEntry('lib/[ab].js', 'lib/[ab].js'),
    false,
    'npm 不会把 lib/[ab].js 打进包；判 true 会让它被静默丢弃',
  );
  assert.equal(isCoveredByFilesEntry('lib/?.js', 'lib/?.js'), false);

  // 含 `*` 的通配条目仍能覆盖含元字符的路径
  assert.equal(isCoveredByFilesEntry('lib/[ab].js', 'lib/*.js'), true);
});
