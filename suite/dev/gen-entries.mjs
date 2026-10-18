/**
 * dev-only generator: produces `mock-entries.mjs` from the real project catalog
 * (`../catalog/eac.json` at the repo root) so the preview exercises the same
 * shapes the host half ships. Re-run after the catalog changes:
 *
 *   node suite/dev/gen-entries.mjs
 *
 * Output layout (matches the task spec): the EAC catalog minus DROP, plus
 * AIO/skin entries, with installed / enabled / updateAvailable / defaultEnabled
 * state coverage.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogFile = path.resolve(here, '../../catalog/eac.json')
const outFile = path.join(here, 'mock-entries.mjs')

const raw = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
const list = Array.isArray(raw) ? raw : raw.plugins ?? []

// 41 of the real entries (drop 5 visual + 2 core for a denser mock list).
const DROP = new Set([
  'viewport-lock',
  'meow-smooth',
  'web-mobile-fix',
  'settings-scroll-fix',
  'navbar',
  'file-drop-eac',
  'unified-market',
])

// Bump catalog versions for a handful of entries so "可更新" badges are real.
const VERSION_OVERRIDE = {
  terminal: '0.2.0',
  'skin-switch': '1.0.0',
  'better-sidebar': '1.3.0',
  'message-rewind': '0.4.0',
}

const pick = (entry) => ({
  id: entry.id,
  name: entry.name,
  version: VERSION_OVERRIDE[entry.id] ?? entry.version,
  tier: entry.tier ?? 'core',
  defaultEnabled: entry.defaultEnabled !== false,
  titleZh: entry.titleZh ?? entry.name,
  titleEn: entry.titleEn ?? entry.name,
  descZh: entry.descZh ?? '',
  descEn: entry.descEn ?? '',
  license: entry.license ?? 'MIT',
  source: entry.source ?? null,
  notes: entry.notes ?? '',
})

const eac = list.filter((e) => !DROP.has(e.id)).map(pick)
// 期望值不再硬编码。此前写死 41，catalog 收敛后实际只剩 34，生成器直接
// exit(1)，dev 预览无法再生成；改为只做空集保护。
if (!eac.length) {
  console.error('[gen-entries] catalog 过滤后为空，检查 catalog/eac.json 与 DROP')
  process.exit(1)
}

// AIO: curated subset shared with EAC + one runtime bundle (byId lookup).
const byId = new Map(list.map((e) => [e.id, e]))
const aioShared = ['balance', 'terminal', 'plugin-manager', 'skin-switch']
  .map((id) => byId.get(id))
  .filter(Boolean)
  .map(pick)
const aioRuntime = {
  id: 'aio-runtime',
  name: '@dsheac/aio-runtime',
  version: '0.2.0-rc.2',
  tier: 'core',
  defaultEnabled: true,
  titleZh: 'AIO 运行时',
  titleEn: 'AIO Runtime',
  descZh: 'DSHEAC AIO 共享运行时与第三方 bundles 兼容垫片（随包离线安装）。',
  descEn: 'DSHEAC AIO shared runtime and third-party bundle compatibility shim (offline install).',
  license: 'MIT',
  source: 'aio-v1',
  notes: 'AIO 精选包的运行时底座，随包发布。',
}
const aio = [...aioShared, aioRuntime]

// 10 optional community skins — all default-disabled.
const SKINS = [
  ['skin-aurora', 'Aurora 极光', 'Aurora', '冷色渐变光晕与毛玻璃层叠，暗色场景下层次分明。'],
  ['skin-sakura', 'Sakura 樱粉', 'Sakura', '低饱和樱花粉配色，圆角与柔和阴影。'],
  ['skin-nord', 'Nord 极地', 'Nord', 'Nordic 冷蓝灰调色板，适合长时间阅读。'],
  ['skin-gruvbox', 'Gruvbox 折衷', 'Gruvbox', '复古暖棕与芥末黄，终端党熟悉的味道。'],
  ['skin-catppuccin', 'Catppuccin 奶咖', 'Catppuccin', '低对比度柔和四档主题（Mocha/Frappe/Macchiato/Latte）。'],
  ['skin-solarized', 'Solarized 日晒', 'Solarized', '经典 Solarized 双主题，护眼黄绿底。'],
  ['skin-dracula', 'Dracula 暗夜', 'Dracula', '高对比紫粉配色，深色背景下的霓虹感。'],
  ['skin-one-dark', 'One Dark', 'One Dark', 'Atom One Dark 移植，冷静的深灰蓝。'],
  ['skin-github-light', 'GitHub Light', 'GitHub Light', 'GitHub 亮色风格，白底蓝链接近原生文档观感。'],
  ['skin-win-aero', 'Windows Aero', 'Windows Aero', 'Win7 Aero 玻璃质感复刻，半透明高光边框。'],
]
const skins = SKINS.map(([id, zh, en, descZh], i) => ({
  id,
  name: `@community/dsh-skin-${id.replace(/^skin-/, '')}`,
  version: `1.${i}.0`,
  tier: 'visual',
  defaultEnabled: false,
  titleZh: zh,
  titleEn: en,
  descZh: `社区皮肤：${descZh}（在「皮肤切换」中启用）。`,
  descEn: `Community skin: ${descZh} (enable via Skin Switch).`,
  license: 'MIT',
  source: 'community',
  notes: '社区皮肤默认不启用，安装后到皮肤切换里启用。',
}))

// State projection seeds. ids not listed here are "not installed".
// 这些 id 会与实际条目求交后过滤：catalog 收敛/退役后，指向已删插件的
// 悬空 id 自动掉落，不会在预览里制造「已安装但不存在」的假状态。
const INSTALLED_SEED = [
  'balance', 'file-changes', 'client-file-changes', 'terminal', 'plugin-manager',
  'conversation-tweaks', 'prompt-custom', 'skin-switch', 'easy-setup', 'eac-locale-compat',
  'eac-core-bridge', 'picturereader', 'soul-md', 'compact', 'dock-settings',
  'session-manager', 'plugin-wizard', 'aio-runtime', 'skin-aurora',
]
const DISABLED_SEED = ['pet', 'whale-widget', 'float-window', 'image-paste', 'skin-aurora']
const INSTALLED_VERSIONS_SEED = {
  terminal: '0.1.0',
  'skin-switch': '0.9.8',
  'better-sidebar': '1.2.0',
  'message-rewind': '0.3.1',
}

const validIds = new Set([...eac, ...aio, ...skins].map((e) => e.id))
const onlyKnown = (ids) => ids.filter((id) => validIds.has(id))
const INSTALLED = onlyKnown(INSTALLED_SEED)
const DISABLED = onlyKnown(DISABLED_SEED)
const INSTALLED_VERSIONS = Object.fromEntries(
  Object.entries(INSTALLED_VERSIONS_SEED).filter(([id]) => validIds.has(id)),
)
const droppedSeeds = [
  ...INSTALLED_SEED.filter((id) => !validIds.has(id)),
  ...DISABLED_SEED.filter((id) => !validIds.has(id)),
  ...Object.keys(INSTALLED_VERSIONS_SEED).filter((id) => !validIds.has(id)),
]
if (droppedSeeds.length) {
  console.log(`[gen-entries] 已剔除悬空 seed id（不在当前条目中）: ${[...new Set(droppedSeeds)].join(', ')}`)
}

const body = `/**
 * GENERATED by dev/gen-entries.mjs — do not edit by hand; tweak the generator.
 * Shapes mirror what the host half's /status projects onto the real catalog.
 */

export const ENTRIES = ${JSON.stringify({ eac, aio, skins }, null, 2)}

export const INITIAL_STATE = ${JSON.stringify({
  installed: INSTALLED,
  disabled: DISABLED,
  installedVersions: INSTALLED_VERSIONS,
}, null, 2)}
`

fs.writeFileSync(outFile, body, 'utf8')
console.log(
  `[gen-entries] wrote ${outFile} (eac=${eac.length}, aio=${aio.length}, skins=${skins.length})`,
)
