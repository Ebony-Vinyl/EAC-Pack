/**
 * Tracked source-patch replay for the repack pipeline.
 *
 * Why this exists
 * ---------------
 * Some shipped plugins need a local fix that upstream does not carry yet (see
 * patches/README.md). Those fixes MUST survive a rebuild: if they only live in
 * dist/*.tgz — which is gitignored — anyone re-running the pipeline silently
 * reverts them. This module replays them from the tracked fact source
 * patches/source-patches.json.
 *
 * Contract (fail-closed)
 * ----------------------
 * For every patch file, in order:
 *   1. the materialized staging file MUST hash to `inputSha256`, else throw;
 *   2. the tracked unified diff is applied with `git apply -p1` and
 *      core.autocrlf disabled (byte-exact);
 *   3. the result MUST hash to `outputSha256`, else throw.
 * A drifted upstream therefore fails the build loudly instead of shipping a
 * half-applied fix.
 *
 * Create mode (new files)
 * -----------------------
 * A file entry with `"create": true` adds a file the upstream package does not
 * ship (e.g. a self-contained compat shim). Its contract is still fail-closed:
 *   1. the target MUST NOT exist, and `inputSha256` MUST be absent — supplying
 *      one means “patch an existing file”, which contradicts `create`;
 *   2. the tracked diff (`--- /dev/null` → `+++ b/<path>`) is applied with the
 *      same byte-exact `git apply` in the same scratch directory;
 *   3. the produced bytes MUST hash to `outputSha256`, else throw — only then is
 *      the file written into staging (parent directories created as needed).
 * Entries without `create: true` keep the byte-for-byte replay described above.
 *
 * Why the patch is applied in a scratch directory
 * ----------------------------------------------
 * repack.mjs stages inside `<repo>/.cache/...`, which .gitignore excludes.
 * `git apply` run from inside that repository treats such paths as ignored and
 * exits 0 while changing nothing — a silent no-op that would look like success.
 * The diff is therefore applied in a scratch directory outside any repository
 * and the verified result is copied back.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MANIFEST = path.join(ROOT, 'patches', 'source-patches.json');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * 递归列出目录下所有文件的相对路径（正斜杠），用于比对 `git apply` 前后的
 * 文件集合、发现 diff 里夹带的未登记文件。
 *
 * @param {string} dir
 * @returns {Set<string>}
 */
function listFilesRecursive(dir) {
  const out = new Set();
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childAbs = path.join(abs, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(childAbs, childRel);
      else out.add(childRel);
    }
  };
  walk(dir, '');
  return out;
}

export function loadPatchManifest() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  if (manifest.schemaVersion !== 1) {
    throw new Error(`unsupported source-patches schemaVersion: ${manifest.schemaVersion}`);
  }
  if (!Array.isArray(manifest.patches)) throw new Error('source-patches.json: patches[] missing');
  return manifest;
}

/**
 * @param {object} entry        catalog entry ({name, version, ...})
 * @param {string} staging      materialized package root that patches are applied to
 * @param {Function} [log]      logger; defaults to console.log
 * @param {object} [manifestOverride]  in-memory manifest, for tests that must not
 *                               depend on the tracked patches/source-patches.json
 * @returns {Array<{path:string, sha256:string, note:string}>} applied files (empty when none apply)
 */
export function applySourcePatches(entry, staging, log = console.log, manifestOverride = null) {
  const manifest = manifestOverride ?? loadPatchManifest();
  const patch = manifest.patches.find((p) => p.name === entry.name);
  if (!patch) return [];
  if (patch.version !== entry.version) {
    throw new Error(
      `source patch version mismatch for ${entry.name}: manifest=${patch.version} catalog=${entry.version}`,
    );
  }

  const applied = [];
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-src-patch-'));
  // 失败回滚台账：记录每个被本函数改动过的 staging 目标，及其**原始字节**。
  //
  // 为什么必须有（2026-10-21 对抗审查发现的真漏洞）：
  // 原实现 L228 直接 `writeFileSync(target, after)` 落 staging，而 finally 只删
  // scratchRoot。多文件补丁在第 N 个失败时，前 N-1 个已永久留在 staging，且
  // 异常路径下调用方拿不到 `applied`，**无从知道 staging 已被改了一半**。
  //
  // create 场景更糟：残留的新文件会让第二次运行在 L115 报
  // 「create target already exists」，即使把 diff 修好也无法自愈，
  // 必须人工清暂存目录。
  //
  // 回滚语义：按逆序恢复。原本不存在的（create）→ 删除；原本存在的 → 写回原字节。
  const touched = []; // { target, original: Buffer|null }
  try {
    for (const file of patch.files) {
      if (!file.path || file.path.includes('..') || path.isAbsolute(file.path)) {
        throw new Error(`unsafe patch path: ${String(file.path)}`);
      }
      const target = path.join(staging, ...file.path.split('/'));
      const isCreate = file.create === true;
      if (isCreate) {
        // Create mode: the file must NOT exist yet, and a pinned input hash would
        // contradict that. Both are authoring mistakes, so fail loudly.
        if (fs.existsSync(target)) {
          throw new Error(
            `source patch create target already exists: ${entry.name} ${file.path}\n` +
              '  drop "create" and pin inputSha256 if the file is meant to be patched in place',
          );
        }
        if (file.inputSha256 !== undefined) {
          throw new Error(
            `source patch create entry must not pin inputSha256: ${entry.name} ${file.path}`,
          );
        }
      } else {
        if (!fs.existsSync(target)) {
          throw new Error(`source patch target missing: ${entry.name} ${file.path}`);
        }

        const beforeSha = sha256(fs.readFileSync(target));
        if (beforeSha !== file.inputSha256) {
          throw new Error(
            `source patch input mismatch for ${entry.name} ${file.path}\n` +
              `  expected ${file.inputSha256}\n  actual   ${beforeSha}\n` +
              '  upstream source drifted -> regenerate patches/ or re-pin the base',
          );
        }
      }

      // file.diff 是 manifest 里另一处可指向任意路径的字段（file.path 已校验，
      // 这一处原先漏了）。它只用于**读**，且最终结果仍要过 outputSha256，
      // 所以不是逃逸通道；但契约应一致：diff 必须落在 patches/ 之内。
      if (typeof file.diff !== 'string' || !file.diff || file.diff.includes('..') || path.isAbsolute(file.diff)) {
        throw new Error(`unsafe patch diff path: ${String(file.diff)}`);
      }
      const diffPath = path.join(ROOT, 'patches', ...file.diff.split('/'));
      const patchesRoot = path.join(ROOT, 'patches');
      if (!path.resolve(diffPath).startsWith(path.resolve(patchesRoot) + path.sep)) {
        throw new Error(`patch diff escapes patches/: ${String(file.diff)}`);
      }
      if (!fs.existsSync(diffPath)) throw new Error(`source patch diff missing: ${file.diff}`);

      // Apply outside the repository (see the header note), then copy the verified result back.
      const scratchFile = path.join(scratchRoot, ...file.path.split('/'));
      // 路径穿越加固：file.path 已在上面做过词法校验（无 .. / 非绝对），但**词法
      // 不等于真实**——父目录若是指向 scratchRoot 之外的符号链接，写出位置就跑出
      // 去了。这里在真正写入前再做一次 realpath 前缀断言。
      //
      // 为什么现在加：2026-10-21 对抗审查指出「只有词法校验，没有 realpath」。
      // scratchRoot 是 mkdtemp 新建的、理论上无法预先植入符号链接，所以这是
      // 纵深防御而非在用漏洞；但成本极低，且能挡住将来 scratch 位置变更带来的回退。
      const scratchFileResolved = path.resolve(scratchFile);
      const scratchRootResolved = path.resolve(scratchRoot);
      if (scratchFileResolved !== scratchRootResolved
        && !scratchFileResolved.startsWith(scratchRootResolved + path.sep)) {
        throw new Error(`patch target escapes scratch root: ${file.path}`);
      }
      fs.mkdirSync(path.dirname(scratchFile), { recursive: true });
      if (!isCreate) fs.copyFileSync(target, scratchFile);
      // apply 前记下 scratch 里已有的文件，apply 后多出来的必须**恰好**是 manifest
      // 声明的这一个。否则说明 diff 里夹带了未登记的文件 —— 那些文件会在这里被
      // 创建、却永远不会被回读到 staging（本函数只读 scratchFile），表现为
      // 「repack 全绿、运行期缺文件」。
      //
      // 实测过这种情形：一份 diff 声明 2 个新文件时，applied 只返回 1 个，
      // 另一个凭空消失，而函数正常返回 success。
      const beforeFiles = listFilesRecursive(scratchRoot);
      try {
        // `git apply` 有一个**只在加 `-v` 时才可见**的静默跳过行为：
        //
        //   不带 -v：exit 0、stderr 完全为空，若路径对不上就**什么都不做**，
        //            看起来和成功一模一样（实测确认）。
        //   带   -v：exit 0，但 stderr 里会写 `Skipped patch '<path>'.`，
        //            从而能区分「应用了」与「跳过了」。
        //
        // 所以这里**必须加 -v**：它不是调试开关，而是这条检测的唯一信号源。
        // 同时用 spawnSync（而非 execFileSync）——后者在成功路径只返回 stdout，
        // 而 Skipped 写在 stderr，用它的返回值做检测是假修复（实测过）。
        //
        // 触发 Skipped 的实测条件：
        //   a) create diff 带了 `diff --git a/<p> b/<p>` 头、而 -p1 剥前缀后对不上；
        //   b) 要 create 的文件在 scratch 里已存在；
        //   c) modify diff 带 `diff --git` 头、目标不存在。
        // 本仓 create diff 的约定是**不带 `diff --git` 头**、直接从 `--- /dev/null`
        // 起（见 patches/files/*/lib/settings-compat.js.diff）—— 那种写法才可靠。
        const applyResult = spawnSync(
          'git',
          ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false',
            'apply', '--whitespace=nowarn', '-p1', '-v', diffPath],
          { cwd: scratchRoot, encoding: 'utf8' },
        );
        if (applyResult.error) throw applyResult.error;
        const applyStderr = applyResult.stderr ? String(applyResult.stderr) : '';
        if (/Skipped patch/.test(applyStderr)) {
          throw new Error(
            `git apply 静默跳过了补丁（exit=${applyResult.status} 但未应用）：${entry.name} ${file.path}\n`
            + `  git stderr: ${applyStderr.trim()}\n`
            + '  最常见原因：diff 带了 `diff --git a/<p> b/<p>` 头，而 -p1 剥一层前缀后\n'
            + '  路径与目标不符。本仓的 create diff 约定是**不带 diff --git 头**、\n'
            + '  直接从 `--- /dev/null` 起（参考 patches/files/*/lib/settings-compat.js.diff）。',
          );
        }
        if (applyResult.status !== 0) {
          throw new Error(
            `git apply failed for ${entry.name} ${file.path}: ${applyStderr.trim() || `exit=${applyResult.status}`}`,
          );
        }
      } catch (err) {
        // 已经是本函数抛出的业务错误 → 原样上抛，避免被下面再包一层
        if (err && typeof err.message === 'string'
          && /git apply (failed|静默跳过)/.test(err.message)) throw err;
        const stderr = err && err.stderr ? String(err.stderr) : '';
        throw new Error(`git apply failed for ${entry.name} ${file.path}: ${stderr.trim() || err.message}`);
      }
      const afterFiles = listFilesRecursive(scratchRoot);
      const expectedRel = file.path.split('/').join('/');
      const extra = [...afterFiles].filter((rel) => !beforeFiles.has(rel) && rel !== expectedRel);
      if (extra.length) {
        throw new Error(
          `source patch diff 夹带了未登记的文件：${entry.name} ${file.diff}\n`
          + `  manifest 只登记了 ${file.path}\n`
          + `  但 diff 额外创建了：${extra.join(', ')}\n`
          + '  → 这些文件不会被回读到 staging，必须拆成独立的 manifest 条目（或从 diff 里移除）',
        );
      }

      const after = fs.readFileSync(scratchFile);
      const afterSha = sha256(after);
      if (afterSha !== file.outputSha256) {
        throw new Error(
          `source patch output mismatch for ${entry.name} ${file.path}\n` +
            `  expected ${file.outputSha256}\n  actual   ${afterSha}`,
        );
      }
      if (isCreate) {
        // The staging package has no such directory yet, unlike the in-place case
        // where it was created by materialization.
        fs.mkdirSync(path.dirname(target), { recursive: true });
      }
      // 落盘前登记原字节，供失败回滚（见上方 touched 的说明）。
      touched.push({ target, original: isCreate ? null : fs.readFileSync(target) });
      fs.writeFileSync(target, after);

      // `summary` 是包级字段（patch.summary），不是 per-file；带在每条 applied
      // 记录上，让调用方（repack.mjs 的 repackNote）能优先取它。多文件补丁的
      // per-file note 拼起来可达上千字符，会把 dist/index.json 撑大。
      applied.push({ path: file.path, sha256: afterSha, note: file.note, summary: patch.summary });
      log(`  source-patch ${entry.name}: ${file.path} -> ${afterSha.slice(0, 12)}`);
    }
  } catch (error) {
    // 失败即回滚：把已写进 staging 的目标按逆序恢复，避免留下半应用状态。
    // 回滚本身若出错，只做记录——原始错误更重要，不能被回滚异常盖掉。
    const failed = [];
    for (const { target, original } of touched.reverse()) {
      try {
        if (original === null) fs.rmSync(target, { force: true });
        else fs.writeFileSync(target, original);
      } catch (rollbackError) {
        failed.push(`${target}: ${rollbackError && rollbackError.message ? rollbackError.message : rollbackError}`);
      }
    }
    if (touched.length > 0) {
      log(`  source-patch ${entry.name}: 已回滚 ${touched.length} 个 staging 目标（补丁失败，不留半应用状态）`);
    }
    if (failed.length > 0) {
      throw new Error(
        `${error && error.message ? error.message : error}\n`
        + '  !! 回滚未完成，staging 可能残留以下目标（请清空暂存目录后重试）：\n  ' + failed.join('\n  '),
      );
    }
    throw error;
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
  return applied;
}
