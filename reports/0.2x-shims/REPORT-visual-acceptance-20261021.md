# 视觉验收补充报告（第二轮）

日期：2026-10-21
提交：EAC-Desktop `f6cf6538`、EAC-Pack `8527b02` + `9a7bf94`

---

## 0. 前提：换到有视觉能力的模型后，我才真正"看了"截图

之前那轮截图验收只有 **DOM 断言 + 文件大小**（116 KB–987 KB 说明非空页），
因为当时模型不支持图像输入。换成支持视觉的模型后重看，**立刻发现 3 类此前
完全无法察觉的问题**：

| 问题 | DOM 断言能发现吗 |
| --- | --- |
| 反色按钮文字全透明（白块） | ✗ 元素存在、可点击、控件数正常、无 slot 错误 |
| 皮肤卡片说明文字溢出边框 | ✗ 文本长度正常 |
| 开关渲染成空白灰块 | ✗ 控件计数正常 |

结论：**截图不"看"，等于没测**。DOM 断言只能证明"元素在"，不能证明"看得见"。

---

## 1. 新发现的问题一：两个皮肤包共用 id 与 bodyAttr（已修）

### 现象

`<body>` 上同时挂 2 个皮肤属性（`data-dsh-blue-fantasy` + `data-dsh-maid-atelier`），
`audit-skin-exclusivity` FAIL。用户选 A 皮肤时 B 的样式照样生效。

### 根因链

两个**不同**皮肤包声明了完全相同的 `id` 与 `bodyAttr`：

| 包 | skin.json id | wiring.id | bodyAttr | 显示名 |
| --- | --- | --- | --- | --- |
| `@dsh-external/...deep-whale-day-night` | `maid-atelier` | `ui-skin-deep-whale-day-night` | `data-dsh-maid-atelier` | 鲸鱼娘昼夜工坊 |
| `@smalltailqwq/...maid-atelier` | `maid-atelier` | `ui-skin-maid-atelier` | `data-dsh-maid-atelier` | 深海女仆工坊 |

1. 管理器 `discoverInstalledSkins()` 按 `ids.has(entry.id)` 去重 → **后一个包被丢弃**，
   永远进不了 catalog → 设置里看不到、无法启用/禁用；
2. 我给它补的 `ui-skin-maid-atelier` 关闭行，被管理器 `ownsRecord`
   （`id.startsWith("ui-skin-")`）判成"自己的行"，下次重写 managed 段时**剥掉**
   → 它复活、挂上 bodyAttr；
3. 另一个皮肤用**同一 bodyAttr** → CSS 选择器完全重合 → **皮肤互相污染**。

### 修法（`EAC-Pack/scripts/repack/ensure-bundles.mjs`）

在产物侧归一化重复的 `skin.json#id`：

- 按包名排序，同 id 的第一个保留，其余改为 `<id>-<wiringId 前 8 位哈希>`；
- **只改 `id`**，`name` / `wiring.id` / `bodyAttr` / 其余字段全不动
  → 用户可见皮肤名不变，只让内部 id 唯一；
- 由 `wiringId` 派生 → 每次构建结果一致，可复现；
- 只处理 `wiringId` 不同的真冲突。

为什么在分发侧改：**id 唯一性是分发契约**（cordis 行 id 必须唯一）。
在产物里补齐，不动上游源码、不改皮肤显示名。

### 验证

- dist 产物：`maid-atelier` tgz 的 id → `maid-atelier-74e5f990`，
  `deep-whale-day-night` 保持 `maid-atelier`；index.json sha 同步
- 管理器 catalog：11 → **12** 个皮肤，两个鲸鱼娘皮肤都可见
- 端到端切换 **4/4** 全部正确落盘两层（含新增 id）
- `ui-skin-maid-atelier` 稳定 disabled，不再被剥
- `SKINEXCL: PASS`（body 皮肤属性 1 个，与配置一致）；两层冲突 **0**

---

## 2. 新发现的问题二：反色按钮文字透明（**已知冲突，未修**）

### 现象

`内置插件`（unified-market）分节里，「🎯 精选目录」「默认」「安装」等
**反色按钮变成空白浅色块**，文字看不见。

### 实测数据

同一个 token 在不同作用域的值：

| 作用域 | `--dsw-alias-bg-layer-3` |
| --- | --- |
| `<body>` | `#26324fa3`（深色，正常） |
| 设置对话框内 | `color-mix(in srgb, #ffffff calc(0.03 * 1.1 * 100%), transparent)` → 计算为 `color(srgb 1 1 1 / 0.033)` |

受影响元素两两一组：
- `background: var(--dsw-alias-label-primary)` = `rgb(219,226,242)`（浅）
- `color: var(--dsw-alias-bg-layer-3)` = 3.3% 白 → **浅底 + 几乎全透明字 = 看不见**

### 归因：上游两个插件的 token 语义冲突，**不是单方 bug**

我最初的判断是「`color-mix` 里 `calc` 多乘法非法」——**实测推翻了**：

```
原写法 * 1.1 * 100%  →  computed: color(srgb 1 1 1 / 0.033)  CSS.supports: true
化简 * 110%          →  computed: color(srgb 1 1 1 / 0.033)  CSS.supports: true
```

表达式合法、计算正确。真实原因是两个插件对同一个 token 的**语义假设不同**：

| 插件 | 对 `--dsw-alias-bg-layer-3` 的假设 |
| --- | --- |
| `dsh-plugin-wallpaper-engine` | **背景层** → 玻璃质感下设成 3.3% 半透明白（符合 `bg-layer-*` 命名语义） |
| `dsh-unified-market` | **与 label-primary 反色的文字色**（`background: label-primary; color: bg-layer-3`） |

官方主题下 `bg-layer-3` 恰是深色 → 反色按钮正常；玻璃主题下它变成浅色 →
浅底浅字 = 不可见。

**处理：记录为已知 token 契约冲突，不强行修改。** 理由：
- 改 wallpaper-engine → 破坏玻璃质感的正确语义；
- 改 unified-market → 它是第三方包，且其反色写法在官方主题下是有效设计；
- 真正的修法是内核提供语义明确的「反色文字」token，属上游设计议题。

**影响范围**：仅在「壁纸引擎玻璃效果 + 设置面板内的反色按钮」同时成立时出现。
主界面、其它 24 个分节、所有非反色控件均正常。

---

## 3. 新发现的问题三：皮肤卡片文字溢出（已知，未修）

皮肤管理面板里每张卡片的说明文字
（`安装目录既不是 Git 仓库，也没有构建指纹（skin.build.json）`）
**超出卡片边框**，压在两行卡片之间。

归属：皮肤管理器自身 CSS（卡片高度未自适应内容）。不影响功能，记录待办。

---

## 4. 本轮净结果

### 提交

| 仓库 | commit | 内容 |
| --- | --- | --- |
| EAC-Desktop | `f6cf6538` | catalog 默认关闭项按事实源落盘（终末地主题默认启用修复） |
| EAC-Pack | `8527b02` | 皮肤 id 冲突归一化 |
| EAC-Pack | `9a7bf94` | 钉住 skin.json#id 唯一性（回归测试） |

### 验收数字

| 项目 | 结果 |
| --- | --- |
| EAC-Pack 测试（相关 3 文件） | **18/18** |
| EAC-Desktop `bundle-identity` + `default-disabled-catalog` | **15/15** |
| `verify-all`（full） | **7 PASS / 0 FAIL** |
| `verify-all`（lite） | **7 PASS / 0 FAIL** |
| `audit-skin-exclusivity` | **PASS** |
| `audit-skin-layers` | 两层冲突 **0** |
| 逐页截图（full） | 25/25 分节，29 张，**WALK: PASS** |
| 逐页截图（lite） | 7/7 分节，10 张，**WALK: PASS** |
| 皮肤端到端切换 | **4/4** 正确落盘两层 |
| 皮肤管理器 catalog | **12** 个（原 11，新增深海女仆工坊） |

### 待办（已知、不阻塞）

1. **反色按钮 token 冲突**（壁纸引擎玻璃 + unified-market）：需上游定 token 语义。
2. **皮肤卡片文字溢出**：皮肤管理器 CSS。
3. **`update-portable.test.ts` 3 个失败**：既有/环境问题（该文件不加载本次改动的任何模块，其中一个失败是 `powershell.exe` 执行失败）。
4. **启动期 1 条 console 错误** `cannot get property "remote.session" without inject`：只在启动出现 1 次、交互期零增长，来自内核官方插件。

---

## 5. 教训

**没有视觉能力时，"截图测试"是有名无实的。** 本轮三个新问题里，有两个
（白块、文字溢出）**完全无法被 DOM 断言发现**——元素都在、可点击、文本非空、
无 slot 错误。只有真正看图才能发现。

因此：截图套件必须配套「能看图的执行者」。在无视觉模型时，至少应做像素级
分析（非空白/色彩方差/区域对比），而不是只看文件大小。
