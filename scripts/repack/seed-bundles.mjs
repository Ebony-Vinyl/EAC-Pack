/**
 * seed 的 `dsh.profile.bundles` 条目筛选规则（可入库、可测试的单一事实源）。
 *
 * 为什么单独成模块
 * ----------------
 * 这条规则原本只存在于 `EAC-Full-Build-20261004/prepare-composition.mjs` ——
 * 一个**未入库的构建工作区脚本**。它的关键一行是：
 *
 *     // 只排 compat，不要用 defaultEnabled 过滤
 *     if (cat.compat) continue;
 *
 * 为什么不能用 `defaultEnabled`：那个表达式还排除了 `skins` 与 `community` 包，
 * 而皮肤恰恰需要「装着但默认 disabled」（皮肤开关/社区皮肤都这个模式）。
 * 实测按 defaultEnabled 过滤会一次把 63 个 bundle 砍到 43，移掉 20 个，
 * 包括 dsh-pet / dsh-theme-endfield / dsh-image-paste 与全部 15 个皮肤。
 *
 * 为什么必须排除 compat：`compat: 'eac-fork'` 的包依赖 EAC 分叉内核专有服务，
 * 官方 0.2.x 上激活期永久挂起；而 web boot 对「entry 未激活」是 fail-loud 的 ——
 * 一个挂起就整体拒绝渲染（`Failed to load plugins`）。实测 2026-10-21：seed 里
 * 留着 2 个 compat 条目时，全新 full 实例宿主侧 RPC 全绿但 GUI 完全起不来。
 *
 * 现在把规则放在这里（受版本控制、有单测），生成端 import 即可 ——
 * 脚本重写或迁移都不会把规则弄丢。
 */

/** 永远进入 bundles 的三个基座条目（与官方 web profile 出厂模板一致）。 */
/**
 * 显式退役清单：这些包**不再进入 seed 的 dsh.profile.bundles**（用户按需从市场装）。
 *
 * 为什么需要一份显式清单，而不是「按 external 类一律排除」：
 * 分发表里 20 个 external/market 包中有 16 个仍留在 seed bundles，其中 5 个
 * （computer-user / openclaw-bridge / settings-groups / agent-teams /
 * webui-prompt-optimizer）正是我们打过补丁的包。按类清退会连修复一起消失，
 * 超出维护者裁决范围。所以只把**明确点名退役**的包列在这里。
 *
 * dsh-dafeiyu（大肥鱼桌面伴侣）：分发表标 external/market，
 * 且 dsh-desktop/assets/plugins 下**没有它的实物**（不随桌面壳分发），
 * 所以它不该出现在 full 实例的启动清单里。
 */
export const RETIRED_SEED_BUNDLES = new Set([
  'dsh-dafeiyu',
]);

export const SEED_BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'eac-plugin-suite'];

/**
 * 判断某个 catalog 条目是否应进入 seed 的 `dsh.profile.bundles`。
 *
 * 规则（务必保持单一判据）：
 *   · `status !== 'preinstalled'` → 不进（desktop-core-precedence / kernel-provided
 *     的包已由别处提供，进 bundles 会重复挂载）
 *   · `catalog.compat` 为真     → 不进（官方内核上激活即挂起，fail-loud 拖垮 GUI）
 *   · 其余                       → 进
 *
 * **不要**额外加 `defaultEnabled` 判据 —— 见文件头注释。
 *
 * @param {{status?: string}} entry        composition entry（含 status）
 * @param {{compat?: string, packs?: string[], defaultEnabled?: boolean}} catalog catalog 条目
 * @returns {boolean}
 */
export function shouldSeedBundle(entry, catalog) {
  if (!entry || typeof entry !== 'object') return false;
  // entry.name 是**必需**输入，不是可选的。
  //
  // 为什么强制：退役清单（RETIRED_SEED_BUNDLES）按 name 查。曾经生成端写成
  // `shouldSeedBundle({ status }, cat)` —— 没传 name，于是退役规则**静默失效**
  // （加了 dafeiyu 到退役清单、重生成 seed，它仍出现在 bundles 里）。
  //
  // 现在改为「缺 name 就 throw」而不是静默放行：让调用方的契约错误立刻暴露，
  // 而不是让一条安全规则悄悄变成 no-op。这是本仓第三次
  // 「规则写了但没生效」——前两次分别是 execFileSync 读错流、git apply 缺 -v
  // 没有信号源。共同的防法是：**在规则入口校验它依赖的输入，而不是依赖调用方自觉**。
  if (typeof entry.name !== 'string' || entry.name === '') {
    throw new Error(
      'shouldSeedBundle: entry.name 是必需字段（退役清单按 name 判定）。\n'
      + '  收到：' + JSON.stringify(entry) + '\n'
      + '  调用方必须传 { name, status, catalog }，否则退役规则会静默失效。',
    );
  }
  // 显式退役清单优先：即使包仍是 preinstalled，也不进 bundles。
  if (RETIRED_SEED_BUNDLES.has(entry.name)) return false;
  if (entry.status !== 'preinstalled') return false;
  // catalog 缺失 → **fail-closed**（不进 bundles）。
  //
  // 曾经写成 `if (catalog && catalog.compat) return false` —— catalog 为
  // null/undefined 时整个条件为假，直接落到 `return true`，于是「不知道它是不是
  // compat 包」被判成「可以进 bundles」。而 compat 包一旦进 bundles 就会让
  // 0.2.x 的 web boot fail-loud、**整机 GUI 拒绝渲染**（RPC 全绿，只有截图看得出）。
  //
  // 宁可少装一个插件，也不能让整机起不来 —— 所以这里取 fail-closed。
  // 调用方若真的没有 catalog（不该发生），应当先补全再算，而不是默默放行。
  if (!catalog || typeof catalog !== 'object') return false;
  if (catalog.compat) return false;
  return true;
}

/**
 * 从 composition 的 entries 算出完整的 seed bundles 数组。
 *
 * @param {Array<{name?: string, status?: string, catalog?: object}>} entries composition.entries
 * @returns {string[]} bundles（去重、保持 entries 顺序，基座条目在前）
 */
export function computeSeedBundles(entries) {
  const out = [...SEED_BASE_BUNDLES];
  const seen = new Set(out);
  for (const e of entries ?? []) {
    if (!e || typeof e.name !== 'string') continue;
    if (seen.has(e.name)) continue;
    if (!shouldSeedBundle(e, e.catalog)) continue;
    seen.add(e.name);
    out.push(e.name);
  }
  return out;
}
