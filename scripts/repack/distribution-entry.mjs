/**
 * 分发面归属判定 —— 供守卫测试与「反向自测」共用同一份实现。
 *
 * 为什么抽出来
 * ------------
 * 原先 `distribution-boundary.test.mjs` 的「反向自测」用例自己重写了一遍判据
 * （`const isConflict = (e) => e.distributionClass === 'builtin' || ...`），
 * 没走真实的 name -> id -> byId 解析路径。结果是它对**解析链本身的缺陷**
 * 完全视而不见 —— 形同虚设。同一份判据必须只有一处实现，测试才有意义。
 *
 * 命名空间不一致问题
 * ------------------
 * catalog 的 id 用裸名（`session-manager`、`raw-html`、`pet`），
 * 而 `.sync/plugin-distribution.json` 里有 **14 条**用 `dsh-<id>` 前缀
 * （`dsh-session-manager`、`dsh-raw-html`、`dsh-pet` …）。
 * 只做字面相等查找会漏掉这 14 条 —— 其中 `dsh-session-manager` 与
 * `dsh-webui-prompt-optimizer` 正是当前补丁包，它们走的是「找不到 → 放行」分支。
 * 当前结论碰巧正确（它们不是 builtin），但判据本身是错的：
 * 一旦某个 `dsh-` 前缀包转为 builtin，就会静默漏判。
 *
 * 所以这里做**双向归一化查找**：先按原样找，再尝试 `dsh-` 前缀的加/减形式。
 */

/** catalog 条目里的 id 可能是裸名，分发表里可能带 `dsh-` 前缀（或反之）。 */
export function candidateIds(id) {
  const out = new Set([id]);
  if (id.startsWith('dsh-')) out.add(id.slice(4));
  else out.add(`dsh-${id}`);
  return [...out];
}

/**
 * 按包名在分发表里查条目（含 id 命名空间归一化）。
 *
 * @param {string} name             catalog 里的包名（如 `dsh-session-manager`）
 * @param {string|undefined} id     catalog 里的 id（如 `session-manager`）
 * @param {Array<{id: string}>} distributionPlugins  分发表的 plugins[]
 * @returns {{entry: object, matchedId: string, viaNormalization: boolean} | null}
 *   `entry === null` 表示分发表里没有该包（属于「只经 Pack 分发」，允许打补丁）。
 */
export function findDistributionEntry(name, id, distributionPlugins) {
  const byId = new Map((distributionPlugins ?? []).map((x) => [x.id, x]));
  if (id === undefined) return null;
  for (const cand of candidateIds(id)) {
    const entry = byId.get(cand);
    if (entry) {
      return { entry, matchedId: cand, viaNormalization: cand !== id };
    }
  }
  return null;
}

/**
 * 判据：分发表条目是否属于「Desktop 内置」—— 即 Pack 不应给它打补丁。
 *
 * @param {{distributionClass?: string, delivery?: string}} entry
 * @returns {boolean}
 */
export function isDesktopBuiltin(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.distributionClass === 'builtin' || entry.delivery === 'bundled';
}

/**
 * 找出补丁清单里「给 Desktop 内置包打了补丁」的条目。
 *
 * @param {Array<{name: string}>} patches  manifest.patches
 * @param {Map<string,string>} nameToId    catalog 的 包名 -> id 映射
 * @param {Array<{id: string}>} distributionPlugins  分发表的 plugins[]
 * @returns {Array<{name: string, matchedId: string, distributionClass: string, delivery: string}>}
 */
export function findBuiltinConflicts(patches, nameToId, distributionPlugins) {
  const out = [];
  for (const patch of patches ?? []) {
    const id = nameToId.get(patch.name);
    if (id === undefined) continue; // catalog 里没有 → 不属于分发面讨论范围
    const found = findDistributionEntry(patch.name, id, distributionPlugins);
    if (!found) continue;           // 只经 Pack 分发 → 允许
    if (!isDesktopBuiltin(found.entry)) continue;
    out.push({
      name: patch.name,
      matchedId: found.matchedId,
      distributionClass: found.entry.distributionClass,
      delivery: found.entry.delivery,
    });
  }
  return out;
}
