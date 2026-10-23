/**
 * `files` 白名单补齐 —— npm pack 的第二个关卡。
 *
 * 为什么单独成模块
 * ----------------
 * 这段逻辑是「补丁重建出的文件能否活到 tgz 里」的唯一保障，却极难在整条
 * repack 管线里单独断言（repack.mjs 是顶层即执行的脚本）。抽出来之后
 * suite/test/ 可以直接 import 做单元测试，不必跑一遍 300 MB 的打包。
 *
 * 背景
 * ----
 * `source-patches.mjs` 的 create 模式能让补丁**新增**文件，但 npm pack 还会
 * 按 `package.json` 的 `files` 白名单再筛一遍：不在白名单的新文件会被
 * **静默丢弃** —— tgz 打包全绿，运行期才炸。`dsh-better-sidebar` 的 `files`
 * 逐条列了 15 项，正踩这个坑。
 */

/**
 * glob 元字符：npm 的 files 条目底层走 minimatch，这些字符在条目里是**语法**
 * 而不是**字面量**。
 *
 * 为什么必须单独处理（实测 npm 11.6.2 / minimatch 10.0.3 / npm-packlist 7.x）
 * ---------------------------------------------------------------------------
 * `files:['lib/[ab].js']` 里的 `[ab]` 是字符类，匹配 `lib/a.js`，**却不匹配
 * `lib/[ab].js` 自己**。端到端复核（npm-packlist 真跑一遍）：
 *   磁盘 = ['lib/a.js', 'lib/[ab].js']，files=['lib/[ab].js']
 *   → 打进包 = ['lib/a.js']   ← 那个带方括号的真实文件被静默丢弃
 *
 * 于是本模块的 `e === p` 精确等值早退在这里是**错的**：它回答「已覆盖」，
 * 调用方就不补白名单，npm 再把文件丢掉 —— 正是这个模块存在的意义所在。
 * 只认 `*` 而把 `[`/`?` 当字面量，方向并非"永远安全"。
 */
const GLOB_META = /[*?[\]{}()!+@|]/;

/**
 * 路径本身是否含 glob 元字符。
 *
 * 这类文件即便把精确路径 push 进 `files` 也**救不回来**（npm 仍按语法解析），
 * 唯一出路是让某条**目录**条目兜住它（目录条目会被展开成 `dir/**`，靠通配
 * 匹配到含元字符的真实文件）。因此覆盖判定必须能识别这种情况。
 */
export function hasGlobMeta(p) {
  return typeof p === 'string' && GLOB_META.test(p);
}

/**
 * 条目是否是「纯字面」的，即可以被当作字面路径比较。
 * 注意 `[`/`?`/`{}` 等即使本模块不实现其语法，也必须视为**非字面**。
 */
function isLiteralEntry(e) {
  return !GLOB_META.test(e);
}

/**
 * 单条 `files` 条目是否覆盖给定路径。
 *
 * 只做保守判断：宁可在白名单里多加一条精确路径（无害），也不要把未覆盖的
 * 路径误判成已覆盖（那会让文件被 npm 静默丢掉）。
 *
 * @param {string} filePath 相对包根的路径，例如 `lib/settings-compat.js`
 * @param {string} entry    `files` 数组里的一条，例如 `lib/`、`lib/index.js`、`lib/types/**\/*.d.ts`
 * @returns {boolean}
 */
export function isCoveredByFilesEntry(filePath, entry) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (typeof entry !== 'string' || !entry) return false;
  // 路径必须是包根内的相对路径。`..` 或绝对路径不可能被正常条目覆盖，
  // 且不该被写进白名单（npm 会把它当模式外的东西，node-tar 也会拦）。
  // 原先缺这道闸：`isCoveredByFilesEntry('../outside.js', '**')` → true，
  // 于是越界路径被当成"已覆盖"直接放过；换成 push 则是把非法条目写进产物。
  if (filePath.startsWith('/') || filePath.includes('..') || /^[A-Za-z]:/.test(filePath)) return false;
  // 前导 `./` 归一化必须在**所有**分支之前做。
  //
  // 原先只在 globMatch 里 `pattern.replace(/^\.\//, '')`，于是 `./lib/index.js`
  // （精确）和 `./lib/`（目录）两条早退路径都失效，只有含 `*` 的写法生效。
  // 实测（2026-10-21）：`./lib/index.js` vs `lib/index.js` → false，
  // 而 `./lib/**/*.js` vs `lib/a/x.js` → true，同一前缀两种结果，属实现不一致。
  // 失败方向是「误判未覆盖」（会多补一条精确路径，无害），但语义应当统一。
  // npm 的 files 条目允许前导 `/`（实测 files=['/lib/'] 与 ['lib/'] 等价），
  // 也允许前导 `./`。两者都归一化掉，否则 `'/lib/'` 会漏判。
  const p = filePath.replace(/^\.\//, '').replace(/^\/+/, '');
  const e = entry.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p || !e) return false;

  const entryIsLiteral = isLiteralEntry(e);

  // 目录形式（`lib/` 或 `lib`）覆盖其下全部内容。
  //
  // 这条路**不受路径含元字符影响**：npm 把目录条目展开成 `!lib/` + `!lib/**`，
  // 靠 `**` 通配来收文件，所以 `lib/[ab].js` 这种名字能被正常收进包
  // （npm-packlist 实测：files=['lib/'] 打包结果含 'lib/[ab].js'）。
  // 目录条目本身含元字符时不能做字符串前缀判断（那是语法不是字面）。
  const dir = e.replace(/\/+$/, '');
  if (entryIsLiteral && dir && p.startsWith(`${dir}/`)) return true;

  // 路径自身含 glob 元字符（`[`/`?`/`{`/`*` …）时，「按字面认出这个文件」
  // 的条目在 npm 眼里都不成立。最典型的自杀式组合：
  //   files = ['lib/[ab].js']，磁盘上有真实的 lib/[ab].js
  //   npm 把条目当字符类，收 lib/a.js，`lib/[ab].js` 自己被丢弃。
  // 此时若判「已覆盖」→ 调用方不补白名单 → 文件无声消失。
  // 只有含 `*` 的条目能按通配展开、真正匹配到这样的路径，才继续往下判。
  if (hasGlobMeta(p) && !e.includes('*')) return false;

  // 精确等值只有在**条目是纯字面**时才等价于「覆盖」。
  // 条目含 `[`/`?`/`*` 等语法时，npm 会把条目当模式解析，可能匹配别的文件
  // 而匹配不到它自己 —— 此时必须交给下面的 glob 分支，不能早退成 true。
  if (e === p) return entryIsLiteral ? true : globMatch(p, e);

  // 含通配时走 glob 判定。**单星与双星语义必须区分**：
  //   `*`  只匹配**一个**路径段，不得跨 `/`
  //   `**` 可跨任意层级
  // npm（11.6.2 实测）就是这个语义：files=['lib/*.js'] 只收 `lib/top.js`，
  // 不收 `lib/a/top.js`；files=['lib/*/index.js'] 不收 `lib/a/b/index.js`。
  // `**` 吃整段，因此 `lib/**` 也能覆盖 `lib/[ab].js`（实测一致）。
  if (!e.includes('*')) return false;
  return globMatch(p, e);
}

/**
 * 按 npm/packlist 的语义做通配匹配：`*` 单段、`**` 跨段。
 *
 * 用「段数组 + 动态规划」实现，避免正则转义带来的隐蔽错误。
 * 每个模式段要么是：
 *   - `**`  → 吃掉 0..n 个路径段（含 0，即可以匹配「目录自身」）
 *   - 含 `*` 的段 → 在该段内做单星匹配（`*` 只吃段内字符，不吃 `/`）
 *   - 纯字面段 → 精确比较
 *
 * 已知限制：`[ab]`、`?`、`{a,b}` 等 minimatch 语法本实现**不解析**，一律按
 * 字面字符比较。方向是「误判未覆盖 → 白名单变胖」（无害），且调用方在
 * 只有本实现认得的 `*` 时才进这里，不会因此放过真该补的文件。
 *
 * @param {string} filePath 相对包根路径（正斜杠）
 * @param {string} pattern  files 条目（正斜杠）
 * @returns {boolean}
 */
function globMatch(filePath, pattern) {
  const F = filePath.split('/');
  const P = pattern.replace(/^\.\//, '').replace(/^\/+/, '').split('/');
  // dp[j] = 「前 i 个文件段」能否被「前 j 个模式段」匹配
  const memo = new Map();
  const go = (i, j) => {
    const key = `${i},${j}`;
    if (memo.has(key)) return memo.get(key);
    let ok;
    if (j === P.length) {
      ok = i === F.length;
    } else if (P[j] === '**') {
      // 吃掉 0 段，或吃掉 1 段后继续用 `**`
      ok = go(i, j + 1) || (i < F.length && go(i + 1, j));
    } else if (i === F.length) {
      ok = false;
    } else if (P[j].includes('*')) {
      // 段内单星：把该段编译成只在本段内生效的正则（`*` → `[^/]*`）
      const re = new RegExp('^' + P[j].split('*').map(escapeRe).join('[^/]*') + '$');
      ok = re.test(F[i]) && go(i + 1, j + 1);
    } else {
      ok = P[j] === F[i] && go(i + 1, j + 1);
    }
    memo.set(key, ok);
    return ok;
  };
  return go(0, 0);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把补丁实际写过的路径补进 `pkg.files`（原地修改）。
 *
 * - 无 `files` 字段 → npm 会收全部内容，无需补，直接返回空数组。
 * - 已被某条覆盖 → 跳过，避免重复。
 * - 否则 push **精确路径**（不用 glob，失败模式更可预测）。
 *
 * 唯一的例外是**路径本身含 glob 元字符**（如补丁新建了 `lib/[id].js`）：
 * push 精确路径救不回来 —— npm 仍把该条目当模式解析，匹配不到它自己
 * （实测 npm-packlist：files=['lib/[ab].js'] 打不进 `lib/[ab].js`）。
 * 这种文件只能靠**目录条目**兜住（目录会被展开成 `dir/**`）。因此改为：
 *   1. 若已有某目录条目覆盖它 → 什么都不做；
 *   2. 否则 push 其所在目录（保证不丢文件）；
 *   3. 同时记入 `warnings`，让调用方知道这里用了兜底而非精确条目。
 *
 * @param {{files?: string[]}} pkg  staging 里的 package.json 对象
 * @param {Array<{path: string}>} appliedSourcePatches  applySourcePatches 的返回值
 * @param {{warnings?: string[]}} [opts] 收集兜底/异常情况
 * @returns {string[]} 实际新增的条目
 */
export function ensurePatchedFiles(pkg, appliedSourcePatches, opts = {}) {
  if (!Array.isArray(pkg.files)) return [];
  const warnings = opts.warnings;
  const added = [];
  for (const applied of appliedSourcePatches ?? []) {
    const patchedPath = applied?.path;
    if (!patchedPath) continue;
    // 越界路径不该进白名单。原先无声跳过，现在至少留个痕迹。
    if (patchedPath.startsWith('/') || patchedPath.includes('..') || /^[A-Za-z]:/.test(patchedPath)) {
      warnings?.push(`补丁路径越出包根，不写入 files: ${patchedPath}`);
      continue;
    }
    if (pkg.files.some((entry) => isCoveredByFilesEntry(patchedPath, entry))) continue;

    if (hasGlobMeta(patchedPath)) {
      // 精确条目在这里无效，改用所在目录兜住。
      const dir = patchedPath.split('/').slice(0, -1).join('/');
      if (!dir) {
        warnings?.push(`补丁路径含 glob 元字符且位于包根，无法用目录条目兜住: ${patchedPath}`);
        continue;
      }
      warnings?.push(`补丁路径含 glob 元字符，改用目录条目兜住: ${patchedPath} -> ${dir}/`);
      const entry = `${dir}/`;
      if (!pkg.files.includes(entry)) {
        pkg.files.push(entry);
        added.push(entry);
      }
      continue;
    }

    pkg.files.push(patchedPath);
    added.push(patchedPath);
  }
  return added;
}
