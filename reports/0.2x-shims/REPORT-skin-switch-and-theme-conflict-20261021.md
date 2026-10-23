# 皮肤切换与主题冲突：实测定位报告

日期：2026-10-21
对象：`debug` 变体（`7b86909f`，端口 60780）
结论层级：**全部可执行复现**，不是推断。

---

## 0. 一句话结论

你看到的三个问题各有**不同**根因，此前我给的归因至少错了两处：

| 现象 | 真实根因 | 归属 |
| --- | --- | --- |
| 皮肤预设完全无法切换 | `dsh-skin-switch` 的 typert codec 缺 `create()`，远端面挂载失败 | **我方 0.2.x 适配缺口**（已修） |
| 切了看起来没反应 | 管理器用 `body.hasAttribute(bodyAttr)` 判「当前皮肤」，而多个皮肤的 client 都被下发并执行 | **上游皮肤包 + 内核发包机制**（未修，需裁决） |
| 终末地主题与皮肤 UI 冲突 | `theme-endfield` 与三个皮肤共覆写同一批 `dsw-*` 变量，无互斥 | **上游设计**（未修，需裁决） |
| 两者「定位冲突」 | **不成立**。设置项顺序 35 vs 115，差 80 位 | 我先前的说法有误 |

---

## 1. 已修复：typert codec 缺 `create()`

### 症状

浏览器 console 持续报：

```
dsh-skin-switch: remote face mount failed | Error: typert:
@deepseek-ai/dsh-skin-switch#skinSwitch/list result strict codec has no create() factory
```

### 原因

`@deepseek-ai/dsh-skin-switch` 的 codec 定义（`lib/index.js:40`、`lib/client.js:114` 各一份）：

```js
const looseCodec = () => ({
  mode: "strict",
  typeSymbol: "@deepseek-ai/dsh-skin-switch/types#Json",
  schema: { parse: (value) => value }
});
```

0.2.x 有**两套校验器串联**检查同一个 codec 对象：

| 校验器 | 要求 | 原实现的违反点 |
| --- | --- | --- |
| `@deepseek-ai/dsh-typert-registry#validateCodec` | `mode === 'src-json'`，**或** `typeSymbol` 非空且 `create` 是函数 | 没有 `create`；字段名是 `schema` 不是 `create` |
| `@deepseek-ai/dsh-api-gateway#requireStrictCodec` | `mode === 'strict'` | 满足 |

单独改任一边都会挂另一边 —— 实测两条错误交替出现：

- 两边都改 `src-json` → 挂 `has no strict codec`
- 两边都保持 `strict` 但不加 `create` → 挂 `has no create() factory`

### 修复

两边统一为 `strict` + `create()`：

```js
const passthrough = { parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) };
const looseCodec = () => ({
  mode: "strict",
  typeSymbol: "@deepseek-ai/dsh-skin-switch/types#Json",
  create: () => passthrough
});
```

`create()` 的返回值在本插件不会被真正用于数据校验：registry 只对
`contribution.schemas`（本插件为空数组）调 `materializeSchema()`；invocation 的
codec 仅做上述存在性检查。故无需引入 zod（插件解析不到 zod，实测 `MODULE_NOT_FOUND`）。

### 验证

修复后重启，浏览器 console 里该错误消失，只剩无关的 `[dsh-pet] 余额查询失败`。

---

## 2. 未修复：皮肤互斥失效（真正的「切了没反应」）

### 机制

管理器 `client.js` 判「当前皮肤」用的是 **DOM 属性**，不是配置：

```js
function activeSkin(catalog) {
  const active = catalog.find((skin) => document.body.hasAttribute(skin.bodyAttr));
  if (active !== undefined) return active.id;
  return "official";
}
```

同时，浏览器实际只发**一条聚合请求**：

```
/plugins/??@deepseek-ai/dsh-float-window/client.js,
           @linxin666/dsh-client-ui-skin-blue-fantasy/client.js,
           @smalltailqwq/dsh-client-ui-skin-deep-whale-manager/client.js,
           @smalltailqwq/dsh-client-ui-skin-maid-atelier/client.js,
           dsh-client-liang-intensity-skin/client.js,
           dsh-theme-endfield/client.js, ...
```

**客户端 bundle 的取舍由 `package.json` 的 `dsh.profile.bundles`（61 项）决定，
`cordis.patch.yml` 里的 `disabled: true` 只影响 host 侧插件，不影响客户端发包。**

### 实测结果

配置为「官方」（`enabledSkins` 为空），但：

```
body 上 data-dsh-* 属性: data-dsh-blue-fantasy, data-dsh-maid-atelier, data-dsh-sidebar-collapsed
其中属于皮肤的: data-dsh-blue-fantasy, data-dsh-maid-atelier
```

**两个皮肤属性同时存在**，且都不在配置启用的集合里。

### 复现命令

```powershell
node tools/audit-skin-exclusivity.mjs debug     # → SKINEXCL: FAIL
```

判定项：

- A. 皮肤属性数量 <= 1（互斥）→ **FAIL**（实测 2 个）
- B. 属性与配置一致 → **FAIL**（配置官方，属性却是 blue-fantasy + maid-atelier）

### 为何这是「无法切换」

任何一次切换后，`body` 上的属性集合不变（因为客户端 bundle 集合不变），于是
`activeSkin()` 依然返回同一个皮肤，界面永远显示那一个 —— 用户感知就是「点了没反应」。
配置文件其实**已经写对了**（见下一节）。

### 附带发现的 id 冲突

两个包声明了**同一个 `id` 和同一个 `bodyAttr`**：

| 包 | skin.json `id` | `wiring.id` | `bodyAttr` |
| --- | --- | --- | --- |
| `@dsh-external/dsh-client-ui-skin-deep-whale-day-night` | `maid-atelier` | `ui-skin-deep-whale-day-night` | `data-dsh-maid-atelier` |
| `@smalltailqwq/dsh-client-ui-skin-maid-atelier` | `maid-atelier` | `ui-skin-maid-atelier` | `data-dsh-maid-atelier` |

`discoverInstalledSkins()` 用 `ids.has(entry.id)` 去重（`lib/index.js:1592`），
于是**后遍历到的那个被丢弃** —— `ui-skin-maid-atelier` 永远进不了 managed 段。
实测 catalog 返回 11 个皮肤，`maid-atelier` 的 `wiringId` 是 `ui-skin-deep-whale-day-night`。

---

## 3. 已证伪：配置写入本身是好的

我先前记录「11 项全部 `disabled: true`、POST 成功但配置不变」——**这是错的**。

### 端到端实测（`tools/probe-skin-e2e.mjs`）

经 HTTP 真实切换，每次核对两层 patch 文件：

```
target=official     POST 200 {"ok":true,"target":"official"}      profile=[]  home=[]                    OK
target=blue-fantasy POST 200 {"ok":true,"target":"blue-fantasy"}   profile=[ui-skin-blue-fantasy]  home=[...]  OK
target=maid-atelier POST 200 {"ok":true,"target":"maid-atelier"}   profile=[ui-skin-deep-whale-day-night]  OK
target=xp           POST 200 {"ok":true,"target":"xp"}            profile=[ui-skin-xp]            home=[...]  OK
```

**4/4 正确落盘到两层**。

### 纯函数验证（`tools/probe-skin-switch-behavior.mjs`）

`renderManagedBlock(target, catalog)` 对 11 个 target 各生成**恰好 1 个** `disabled: false`；
`switchPatch` 幂等。

### 双 patch 层一致性（`tools/audit-skin-layers.mjs`）

profile 层与 home 层**逐条一致，冲突 0 个**。

> 教训：先前「全部 `disabled: true`」的观测是在旧快照上做的，实例运行期间配置被改过。
> 回读配置必须以**当前**文件为准。

---

## 4. 未修复：终末地主题与皮肤的无互斥覆盖

`theme-endfield` 与三个皮肤的 `dsw-*` CSS 变量覆盖完全重叠：

| 主体 | 覆盖 `dsw-*` 变量数 | 与 endfield 共享 |
| --- | --- | --- |
| `theme-endfield` | 73 | — |
| `maid-atelier` | 46 | 29 |
| `blue-fantasy` | 158 | 59 |
| `liang-intensity-skin` | 44 | 31 |

三者都用 `document.body.classList.add(...)`，**没有任何互斥机制**。

### 关于「定位冲突」

**不成立**。设置分节顺序实测：

- `theme-endfield`：order = **35**
- `dsh-skins`（皮肤管理）：order = **115**

相差 80。你在界面看到的「3 行之隔」是渲染结果，不是 order 冲突。

### 关于「默认打开」

runtime 状态实测为：

```
enabled    = "0"
contour    = "0"
watermark  = "1"
contourAnim= "1"
```

主开关是关的，但 4 个子开关里有 3 个是开的 —— 这很可能就是「看起来默认打开」的来源。

---

## 5. 验收缺口（这是你问题的直接答案）

`lite/tools/verify-all.mjs` 头注释承诺 **6 个维度**，实际只 `push` 了 **5 个**：

| 维度 | 状态 |
| --- | --- |
| 1. 插件激活面 | 有 |
| 2. 设置面 | 有 |
| 3. 图标/符号面 | 有，但**只覆盖 11 个补丁包**、且只认 `命名空间.成员` 写法 |
| 4. 补丁字节面 | 有 |
| 5. 启动审计 | 有 |
| 6. **设置卡渲染面（CDP）** | **注释里有，代码里一行都没有** |

它报「282 个导出符号全覆盖」是**假绿**：正则
`_deepseek_ai_dsh_client_ui_primitives\.(\w+)` 匹配不到具名导入
（`import { IconXxx } from '...'`）与解构导入两种形态，而 `@nanmicoder/dsh-agent-teams`
的 3 个图标正是具名导入写法。

### 已补齐

| 新增工具 | 作用 |
| --- | --- |
| `tools/audit-primitives-gate.mjs` | 只查**真实入口闭包**（按 `package.json#exports` 解析），消灭未发布源码分片的假阳性 |
| `tools/classify-icon-refs.mjs` | 把「本地定义的 SVG 组件」从「缺失引用」中剔除 |
| `tools/audit-kernel-symbols.mjs` | 把符号检查从 primitives 扩到**全部 373 个内核包** |
| `tools/probe-slot-render.mjs` | **真正实现第 6 维**：遍历全部 27 个设置分节，检测 `data-slot-error` 与白卡 |
| `tools/audit-skin-exclusivity.mjs` | 皮肤互斥与配置一致性（本文第 2 节的证据来源） |
| `tools/audit-skin-ids.mjs` / `audit-skin-manifest.mjs` / `audit-skin-layers.mjs` | 皮肤 id / manifest / 双 patch 层三重核对 |

### 探针自身踩过的坑（都会造成假绿）

- `probe-slot-render` 最初只等 `innerText.length > 200`，而启动页「Loading plugins...」
  本身就超过 200 → 0 个导航行 → 却输出 `PASS 0/0`。已加：未就绪即 FAIL、`checked===0` 即 FAIL、
  以及**灵敏度自检**（若所有分节控件数完全相同，判定测量失效）。
- 清理只 `edge.kill()` 会留下孙进程，导致 16 个 msedge 残留并锁住 profile 目录。
  已改为 `taskkill /T /F`。
- Cookie 手工注入经 CDP 反复失败（`Invalid cookie fields` / `Sanitizing cookie failed`），
  已改为直接导航到 readiness token URL。

---

## 6. 附带发现：一处假阳性

`audit-primitives-scope2` 曾报 `@nanmicoder/dsh-agent-teams :: lib/client/ActivityPanel.js`
缺 3 个图标（`IconBranchOutline16` / `IconChevronDownOutline14` / `IconPanelLeftOutline16`）。

**这是假阳性**：该包 `exports["./client"]` 指向 `lib/client.js`（116 KB），其中已内联
ActivityPanel 且用的是存在的名字（`IconBranchOutlineMedium` / `IconChevronDownOutlineRegular` /
`IconPanelLeftOutlineMedium`）。`lib/client/` 目录是未被 `exports` 暴露的源码分片，不会被加载。

同理 `dsh-better-sidebar/lib/client-registry.js` 里 14 个 `Icon*16` 也是假阳性 ——
那个文件不 import primitives，14 个名字是它自己画的 SVG 组件。

---

## 7. 待裁决

1. **皮肤互斥**（第 2 节）：修法有两条
   - 上游皮肤包各自判 `disabled` 后再决定是否设 `bodyAttr`
   - 内核让客户端 bundle 发包遵循 `cordis.patch.yml` 的 `disabled`
   两条都动上游，需你确认走哪条。
2. **`theme-endfield` 与皮肤的变量覆盖**（第 4 节）：方案 A（互斥）已在讨论范围内。
3. **两包 `id` 冲突导致 `ui-skin-maid-atelier` 被丢弃**：需要上游改 `skin.json` 的 `id`。

---

## 8. 复现清单

```powershell
$node = 'D:\AI_Coding\EAC\EAC-Full-Build-20261004\EAC-Desktop\dsh-desktop\vendor\node\node.exe'
Set-Location D:\AI_Coding\EAC\lite

& $node tools/audit-skin-exclusivity.mjs debug   # → SKINEXCL: FAIL（皮肤互斥失效）
& $node tools/audit-skin-layers.mjs debug       # → 两层一致，冲突 0
& $node tools/audit-skin-manifest.mjs debug     # → 12 个 skin.json，1 个 id 冲突
& $node tools/probe-skin-e2e.mjs debug          # → 4/4 切换正确落盘
& $node tools/probe-slot-render.mjs debug       # → 27/27 分节无 slot-error
& $node tools/audit-primitives-gate.mjs debug   # → 真实入口闭包内 0 缺符号
```
