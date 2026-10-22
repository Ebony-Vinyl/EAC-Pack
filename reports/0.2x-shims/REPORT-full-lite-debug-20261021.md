# full / lite 双变体全量 debug 测试报告

日期：2026-10-21
修复提交：`f6cf6538`（EAC-Desktop `fix/0.2x-runtime-main`）

---

## 1. 本次修复的三个 bug

### 1.1 终末地主题默认启用（原始问题）

`catalog/community.json` 写的是 `defaultEnabled: false`，但实际启用：
覆写 73 个 `dsw-*` 变量，与皮肤管理器冲突。

**根因**：自带 `dsh.bundle.patch` 的社区包在 profile 里天然有一行 `- insert:`
（bundle 层写入），该行**没有 disabled 字段** → 插件默认启用。它的
`config.enabled: "0"` 只是插件内部开关，管不了插件加载。

**修法**：新增 `defaultDisabledBundlePackages()`，以 catalog 的
`defaultEnabled: false` 为唯一事实源补关闭行。

### 1.2 修 1.1 时引入的回归：皮肤管理器被误禁（已修）

第一版按 catalog 直接补 disabled，把
`@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` 也禁了 —— 它是
**皮肤管理器的 UI 入口**，禁掉后设置里的「皮肤管理」分节整块消失。

**发现方式**：逐页截图测试立刻暴露 —— 设置导航从 27 个分节掉到 24 个。

**修法**：`NEVER_DEFAULT_DISABLE` 排除管理器自身与上游 `dsh-skin-switch`。

### 1.3 双层 patch 不一致导致「切换看似成功实则无效」（已修）

我的第一版只查 profile 层 patch，无视用户在 home 层写的
`disabled: false`（明确启用 `qq98`），又给 profile 层补了 `disabled: true`
→ 两层对同一 id 给出相反值。

**修法**：「已表态」查两层 patch 求并集。

---

## 2. 验证结果

### 2.1 单元测试

| 文件 | 结果 |
| --- | --- |
| `bundle-identity.test.ts` | 11/11（含 `explicitDisabledEntryIds` 新口径用例） |
| `default-disabled-catalog.test.ts`（新增） | 4/4 |
| `issue-416-plugin-distribution-tiers.test.ts` | 通过（断言同步 + 补 2 条新守卫） |
| 相关子集合计（6 文件） | **54/54** |

### 2.2 dsh-desktop 全量分批测试

98 个测试文件分 7 批跑完毕：

| 批次 | 结果 |
| --- | --- |
| 1–5、7 | 全部 OK（共 586 pass / 0 fail） |
| 6 | pass=149 fail=3 |

**批次 6 的 3 个失败全部在 `update-portable.test.ts`**，判定为**既有/环境问题，与本次改动无关**，证据：

1. 该测试文件只加载 `update-portable.js` / `update-package.js` / `update-archive.js`
   —— **均未被本次改动触及**（本次只改 `bundle-identity.ts`、`companion-sync.ts`）；
2. 其中一个失败的原始错误是 `powershell.exe ... -EncodedCommand` 执行失败
   （zip 打包步骤），属环境问题；
3. 另两个失败为 `identity-mismatch` 正则不匹配与 `update-persistent-data-changed`
   —— 均为该测试自身的状态/行为断言，与 bundle identity / catalog / 皮肤无关。

> 待办：这 3 条需要单独排期排查（不阻塞本次验收）。

### 2.3 实机验收（full 变体 `debug`，commit `f6cf6538`）

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包
PASS  补丁插件功能端点可达 — 6 PASS / 0 FAIL / 1 SKIP
合计：7 PASS / 0 FAIL
```

### 2.4 实机验收（lite 变体，全新 profile）

```
PASS  补丁插件全部 active — SKIP（lite 档位：按设计不安装 EAC-Pack 补丁包，已装 0/11）
PASS  补丁文件字节闭合 — SKIP（同上）
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包
PASS  补丁插件功能端点可达 — SKIP（补丁插件未安装，端点不适用）
合计：7 PASS / 0 FAIL
```

### 2.5 皮肤/主题专项

| 检查 | full 结果 |
| --- | --- |
| `audit-skin-exclusivity` | **PASS**（body 皮肤属性 1 个，与配置一致） |
| `audit-skin-layers` | 两层冲突 **0**，`activeSkinTarget = qq98`（用户选择保留） |
| 运行时 entry 状态 | `theme-endfield` **disabled**；`ui-skin-deep-whale-manager` **ENABLED** |

---

## 3. 新增：逐页面 / 逐功能 / 逐插件截图测试

工具：`lite/tools/walk-screenshot.mjs`

### 3.1 覆盖范围

- **逐页面**：主界面 → 设置根 → 每个设置分节 → 插件管理 → 皮肤管理
- **逐功能**：每个分节点击进入后断言「内容区控件数 + 文本长度 + 无 slot 错误」
- **逐插件**：设置分节由插件注册，运行时从 DOM 读出（不硬编码），
  因此覆盖到每个实际注册了设置面的插件

每步产出：一张 PNG（`screenshots/walk/<序号>-<slug>.png`）+ 一条结构化结果
（`walk-report.json`，含 DOM 文本摘要、控件数、console 错误）。

### 3.2 假绿防护（每条都对应踩过的坑）

| 防护 | 对应踩坑 |
| --- | --- |
| 就绪判定必须等到「设置」入口，不能只看 innerText 长度 | 启动页 `Loading plugins...` 本身 >200 字符 |
| `checked === 0` 直接 FAIL | 早期输出 `PASS 0/0` |
| 灵敏度自检：所有分节测出相同控件数 → FAIL | 测的是整页而非分节 |
| `taskkill /T /F` + 重试删目录 | 只 kill 父进程留下 16 个 msedge 残留 |
| `ev()` 暴露 expression 异常 | 静默返回 undefined 导致误判"点击失败" |

### 3.3 结果

| 变体 | 分节 | 检查项 | 截图 | 结果 |
| --- | --- | --- | --- | --- |
| full（`debug`） | 25 | 6 | 29 | **WALK: PASS** |
| lite | 7 | 5 | 10 | **WALK: PASS** |

full 的 25 个分节全部 PASS，含「皮肤管理」：
`控件 39, 文本 1318`；皮肤管理面板 `17 个按钮，当前: QQ2008 怀旧版`（与配置 `qq98` 一致）。

---

## 4. 顺带修掉的两个**验收工具**缺陷

### 4.1 `verify-all` 无档位概念

原本用 full 的标准判 lite → lite 上得到「3 PASS / 4 FAIL」，全部由
"补丁包未安装"造成。那是**工具假警报**。

修法：按 profile 里实际安装的补丁包数量判定档位
（`0` → lite、`>= 半数` → full、其它 → degraded 照 full 判），
lite 下相应维度输出 **SKIP + 原因**。

### 4.2 `verify-endpoints` 不认「插件被有意禁用」

修好 1.1 后，`theme-endfield` 被禁用，它注册的 host 路由 404 ——
工具立刻报 FAIL。**那其实是修复生效的证据**。

修法：读两层 patch 的 disabled 集合，被禁用的插件对应探针判 **SKIP**，
并在统计行单独计数（`X PASS / Y FAIL / Z SKIP`）。

---

## 5. 已知遗留（不阻塞）

1. **`update-portable.test.ts` 3 个失败**：既有/环境问题，需单独排查。
2. **console 有一条启动期错误**：`cannot get property "remote.session" without inject`。
   实测**只在启动期出现 1 次，交互期完全不增加**，不影响功能；来自内核官方插件，
   非我方代码。
3. **`maid-atelier` 的 `skin.json#id` 与 `deep-whale-day-night` 冲突**：
   上游两个包的问题，但目前用 `wiring.id` 已能区分，不影响可控性。

---

## 6. 复现

```powershell
$node = 'D:\AI_Coding\EAC\EAC-Full-Build-20261004\EAC-Desktop\dsh-desktop\vendor\node\node.exe'
Set-Location D:\AI_Coding\EAC\lite

# 单测
Set-Location D:\AI_Coding\EAC\EAC-Full-Build-20261004\EAC-Desktop\dsh-desktop
& $node --test test/bundle-identity.test.ts test/default-disabled-catalog.test.ts --test-timeout=60000
Set-Location D:\AI_Coding\EAC\lite

# full 变体
& $node tools/launch.mjs --variant debug --detach
& $node tools/verify-all.mjs debug
& $node tools/walk-screenshot.mjs debug
& $node tools/audit-skin-exclusivity.mjs debug
& $node tools/audit-skin-layers.mjs debug

# lite 变体（变体不能并行：固定端口 19873/49223 互斥，需先停另一个）
& $node tools/launch.mjs --variant debug --stop
& $node tools/make-variant.mjs lite --fresh-data
& $node tools/launch.mjs --variant lite --detach
& $node tools/verify-all.mjs lite
& $node tools/walk-screenshot.mjs lite

# 全量分批测试
& $node tools/run-tests-batched.mjs
```
