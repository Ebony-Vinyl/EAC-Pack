# theme-endfield 默认启用：修复尝试与回滚记录

日期：2026-10-21
状态：**两次修复尝试均已回滚**，最终采用精确白名单方案。

---

## 1. 现象

`theme-endfield` 默认启用，覆写 73 个 `dsw-*` CSS 变量，与皮肤管理器冲突。
`catalog/community.json` 里写的是 `defaultEnabled: false`，但实际是启用的。

profile 的 `cordis.patch.yml` 里有这样一行（**没有 `disabled` 字段**）：

```yaml
- id: theme-endfield
  name: dsh-theme-endfield
  config:
    enabled: "0"        # 插件内部开关，管不了插件加载
```

---

## 2. 尝试一：修 `isRegistered` 口径（**部分有效，但被熔断拦住**）

### 改动

`bundle-identity.ts` 新增 `explicitDisabledEntryIds()`：只把「显式写了 `disabled`」的行
算作用户已表态，而不是「id 出现过」。

`companion-sync.ts` 的 `isRegistered` 从 `registeredPatchEntryIds` 换成它。

### 为什么方向对

`registeredPatchEntryIds` 把 bundle 层 `- insert:` 行也算成"已登记"，于是自带
`dsh.bundle.patch` 的社区包（`theme-endfield` 正是）天然有一行 insert → 被判定
"已登记" → 跳过补写关闭行 → 永远补不上 `disabled: true`。

### 实测结果

真实 profile 上验证口径差异正确：

```
registeredPatchEntryIds  27 个（含 theme-endfield）
explicitDisabledEntryIds 11 个（只有 11 个皮肤，不含 theme-endfield）
```

但**实际不生效**：`externalDefaultDisabledPlan` 仍返回 0 项。

### 原因

`resolveBundleIdentities` 对全部 61 个 bundle 返回 `ok: false`：

```
identity ok=0, 失败=61
```

其中 `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` 报
「无法读取插件的安装元数据或补丁」——它们装在内核的
`<app>/dsh-desktop/node_modules`，**不在 profile 的目录链上**。

它们是 `KERNEL_BUNDLE_PACKAGES` 成员，解析失败会置 `unresolvedCore = true`，
触发 `resolveBundleIdentities` 的安全网：把所有非内核 bundle 标成
「核心插件元数据不可用，无法确认条目归属」→ `ok: false`。

---

## 3. 尝试二：补内核作用域解除熔断（**造成严重过度修复，已回滚**）

### 改动

给 `installedPackageRoot` / `resolveBundleIdentity` / `resolveBundleIdentities`
增加 `kernelRoots` 参数，由调用方传 `<APP_ROOT>/node_modules`。

### 结果：灾难性

熔断解除后，`externalDefaultDisabledPlan` 立刻给 **45 个插件**补了 `disabled: true`：

```
disabled:true  从 11 个 → 54 个
被禁掉的包括：skin-switch（切换器本身）、ui-skin-deep-whale-manager（皮肤管理器本身）、
             liang-intensity-skin、better-sidebar、agent-teams、balance、pets……
```

### 根因（比原 bug 更严重）

`PLUGIN_SYNC_REGISTRY` 只登记 **10 个包**，而 profile 有 **61 个 bundles**（命中 1/61）。

未登记的包经 `canonicalBundleId` 得到 `scoped-<hex>` id：

```
@deepseek-ai/dsh-balance  →  scoped-40646565707365656b2d61692f6473682d62616c616e6365
```

而 `PLUGIN_DISTRIBUTION_CLASSES` 的 key 是裸名（`balance`）。两边 id 空间完全对不上，
于是 `distributionClassOf` 全部落到默认分支 `'external'`。

**模拟**：若 id 空间修好，会补 `disabled` 的包是 **55 个**。

结论：`unresolvedCore` 熔断**一直在掩盖这个 id 空间错配**。它不是一个可以
简单"修好"的 bug —— 一旦解除，就会批量误禁插件。

### 已回滚

- `bundle-identity.ts`：移除 `kernelRoots` 参数
- `companion-sync.ts` / `plugin-ops.ts`：移除传参
- 测试：移除依赖 `kernelRoots` 的 2 条
- 实测确认：`disabled:true` 回到 11 个，无批量误禁

---

## 4. 结论与最终方案

### 不能走的路径

「外部插件默认禁用」（`externalDefaultDisabledPlan`）在 EAC 上**不可用**，因为它
依赖两个前提都不成立：

1. `PLUGIN_SYNC_REGISTRY` 覆盖所有 bundle（实际 10/61）
2. `canonicalBundleId` 能给出与 `PLUGIN_DISTRIBUTION_CLASSES` 同空间的 id（实际 scoped-hex）

### 采用的路径：精确白名单

不走通用规划器，直接对**明确需要默认关闭的社区包**写 `disabled: true`。
判据来自 catalog（`defaultEnabled: false` + `tier: visual` + 自带 bundle patch），
而不是"凡是 external 就禁用"。

### 保留的成果

`explicitDisabledEntryIds()` 及其测试保留 —— 它本身是正确的语义修正
（"id 出现过" ≠ "已表态禁用"），将来 id 空间修好后可直接启用。

---

## 5. 复现

```powershell
$node = 'D:\AI_Coding\EAC\EAC-Full-Build-20261004\EAC-Desktop\dsh-desktop\vendor\node\node.exe'
Set-Location D:\AI_Coding\EAC\EAC-Full-Build-20261004\EAC-Desktop\dsh-desktop

# 单测（11 条，含 explicitDisabledEntryIds）
& $node --test test/bundle-identity.test.ts --test-timeout=120000

# 观察 disabled 数量（健康值 = 11，出现 50+ 说明熔断被解除）
$prof = 'D:\AI_Coding\EAC\lite\variants\debug\data\dpx\dsh-environments\eac-stable\dsh-home\profiles\web-desktop'
(Get-Content "$prof\cordis.patch.yml" -Raw | Select-String -Pattern 'disabled:\s*true' -AllMatches).Matches.Count
```
