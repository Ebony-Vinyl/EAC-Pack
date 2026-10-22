# 0.2.x 适配 —— 实机验收报告（2026-10-21，收尾版）

## 一句话

**从空 `dist/` 全量重建**跑通（此前本机必然失败），产物装回零数据根的**全新实例**后：
6/6 目标插件 `fiberPhase=active`、25 个 settings 命名空间、启动失败 5 → 1、
GUI 经 CDP 逐项点击验证正常。

## 交付物（PR 均面向**上游**仓）

| 仓 | PR | head | 状态 |
| --- | --- | --- | --- |
| EAC-Pack | [**#14**](https://github.com/Ebony-Vinyl/EAC-Pack/pull/14) · `feat/pack-0.2x-plugin-shims` | `24aa3ac` | `mergeable=true`，**`blocked`=需他人批准** |
| EAC-Desktop | [**#488**](https://github.com/Ebony-Vinyl/EAC-Desktop/pull/488) · `fix/0.2x-runtime-main` | `5cee0d43` | `mergeable=true`，**`blocked`=需他人批准** |

**PR #488 是从 `origin/main`（`47af3833`，Merge PR #478）重新拉的干净分支**，
cherry-pick 了那两个提交 —— 不依赖 `feat/ofm-builtin-252-v2`，两条基线都验证过
`tsc --noEmit` exit 0。

EAC-Pack 提交：`dff72fe` / `91ce777` / `c37d18b` / `16aaccd` / `9f13e9b` / `37ee658` / `24aa3ac`
EAC-Desktop 提交：`c92726fb` / `2f9de7fd`（原分支）+ `00b10c0c` / `5cee0d43`（main 分支 cherry-pick）

> **一个已经踩过并修正的坑**：最初在 fork 上开 PR 时 base 选成了我自己的
> `BAIKAI23333/EAC-Pack:main`，`gh api .../merge` 返回 `merged:true`，让我误以为
> 合并成功 —— 实际是把工作合进了**自己的 fork main**，而且 fork main 落后上游
> 5 个提交，等于丢掉了上游那两个提交。已把 fork main 强制重置回上游 sha（现在
> `identical, ahead=0, behind=0`），并重开面向 `Ebony-Vinyl/EAC-Pack:main` 的 PR #14。
> 教训：`merged:true` 不代表合进了上游，必须看 `base.repo.full_name`。

## 本轮（第四轮）核心成果：全量重建终于跑通

清空 `dist/` 后跑全量 `repack.mjs`，此前是**连环失败**，四个独立原因：

| # | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| ① | `eac-tag 源目录缺 package.json: …/aio-src/…/dsh-aio-ui-compat` | 本机无 `.cache/aio-src`、`.cache/eac-src` 只有 45 个 EAC 包；但 AIO 包**在 full-pack seed 里都有** | 加第三级兜底：eac-src / aio-src 都没有时回退 `AIO_SEED_NM` |
| ② | `版本漂移 dsh-visualize: 源=0.1.7 catalog=0.1.4` | `GH_SOURCES` 不钉 `ref`，浅克隆跟随上游默认分支 | 钉完整 SHA（取承载 catalog 期望版本的 commit） |
| ③ | `版本漂移 dsh-drag-and-drop: 源=0.1.7 catalog=0.1.6` | 同上 | 同上 |
| ④ | `包名不符: @omdsh-dev/dsh-drag-and-drop != dsh-drag-and-drop` | 同一个 0.1.6 有两个 commit：`3b70ec4` 带 scope，`8ed0f65` 是改名后的裸名 | 钉 `8ed0f65`（catalog 与 seed 都用裸名） |

`picturereader` 那条早就钉了完整 SHA 并写了注释 —— 说明这是**既定做法**，只是另外
三条漏了。

### 重建结果

```
dist 清空 → node scripts/repack/repack.mjs
  exit 0（此前必然 FATAL）
  完成：dist/ 共 72 个 tgz + index.json + SHA256SUMS
  locallyRepacked: 9（与补丁清单一致）
  补丁字节闭合：9/9 包、逐文件 tar -xOf 比对 outputSha256 → DRIFT 0
ensure-bundles     23 repaired（全新重建后需补 bundle 行，属正常）
sync-bootstrap     5 条目重钉
全量 suite         80/80
kernel-compat      0 命中
补丁重放           ALL CLEAN
```

**这台机器现在可以从零完整复现整个 Pack**，不再依赖历史手工攒下的 dist 或缓存。

## 本轮另一个修复：`better-sidebar` 的前端缺陷

它修好宿主半边、**真正激活之后**才暴露：

```
list slot "conversation.chat.turnTail" requires options.id
slot entry crashed in 'conversation.chat.turnTail': React error #130
```

0.2.x 的 slot 框架对 list 类型强制要求 `options.id`，缺失直接 throw → 该条目渲染期
炸成 React #130 → 侧栏「产出文件」入口**整个消失**（不崩页面，只是少一块 UI）。

上游注册块有 name/select/priority/registrant/inject，独缺 `id`；同一个 slot 的另一个
注册方 `@nagi-ovo/dsh-visualize` 传了 `id: "dsh-visualize-cards"`，说明是上游遗漏。
补 `id: "dsh-better-sidebar-produced-files"` 即修复。

**只有截图能发现**：RPC 侧 `fiberPhase=active`、25 个命名空间全绿，错误只在渲染期发生。

## 累计修复清单（四轮）

**EAC-Pack（5 个提交）**

1. 5 个插件 × 三处设置模型退役：`settingsNamespace` / `installSettingsSection` /
   `settingsScope` / `ctx.settings.register` / `volatile()`
2. 补丁链两项新能力：`create` 模式（新增文件）、`files` 白名单补齐
3. `better-sidebar` 的 `conversation.chat.turnTail` 缺 `options.id`
4. 全量重建可跑通（4 个 github ref + AIO seed 回退）

**EAC-Desktop（2 个提交）**

5. `c92726fb`：共享层 `schemastery` 缺 `cosmokit` 与 `@standard-schema/spec` ——
   它让**整个 web boot 起不来**（端口都不监听），而日志只显示 `failed to import`
6. `2f9de7fd`：`compat: 'eac-fork'` 的两个包混进 `dsh.profile.bundles` →
   web boot fail-loud → 整机 GUI 拒绝启动。加启动时剥离的运行时兜底

## 验收对照

| 指标 | 起点 | 现在 |
| --- | ---: | ---: |
| 目标插件 `fiberPhase=active` | 1/6 | **6/6** |
| 启动 `did not activate` | 5 | **1**（仅 agent-teams） |
| `settings/describe` 命名空间 | 22 | **25** |
| GUI | 拒绝启动 | **完整渲染 + 逐项点击通过** |
| 全量重建 | 必然 FATAL | **exit 0，72 tgz** |
| 补丁字节闭合 | — | **9/9，DRIFT 0** |

## 逐项功能测试（CDP 自动化）

工具：`lite/tools/cdp-functest.mjs`（手写最小 CDP 客户端，Edge headless + cookie 注入）。

已验证可用的界面（`variants/fresh21/screenshots/`）：

| 截图 | 内容 |
| --- | --- |
| `02-home.png` | 首页 + our-free-model 引导弹窗（6 页） |
| `03-settings-open.png` / `04-settings.png` | 设置面板 |
| `05-tab-5.png` | 设置-通用：字号 / 工作步骤 / 代码工作视图 / 快捷键 / 繁忙发送行为 / 撤销恢复快捷键 |

设置左侧分区：通用设置 / 增强功能 / 余额 / 桌宠 / 连接手机 / 模型 / 内置插件 /
Agent 预设 / Skills 与 MCP / 图片阅读 / 插件保护 / 外观·字体与颜色 / 表情包 /
人设卡 / 一键迁移 —— 这些是各插件注册的设置卡，说明插件 UI 半边真的在工作。

`failBannerSeen: false`（无 "Failed to load plugins"）。

## 边界：剩下的真实既有问题

第八轮之后，前端**不再有任何 React 渲染错误**。仍在的只有：

| 问题 | 性质 |
| --- | --- |
| `agent-teams` 启动失败 | 内核把 `registerContinuableSetup` 换成 provider 模式（API 重构，非改名），需上游适配。已写裁决备忘 |
| `client-ui-custom` | 与内核 locale 命名空间撞名，catalog 已标 `compat: eac-fork`，运行时自动剥离 |

（上一轮把两处 React #130 归为"第三方不归本仓管"，第八轮已证明是我的误判并修复。）

## 合并路径已验证（第六轮）

之前只知道「PR 是 29 个提交的叠加分支」，但没验证过**按 plan v4 顺序逐个合入**会怎样。
这轮用 detached worktree + `git merge` 真跑了一遍：

```
从 origin/main (4565123) 开始
  merge fix/gitattributes-patch-eol      ok，零冲突
  merge fix/computer-user-0.3.7          ok，零冲突
  merge feat/picturereader-3.5.0         ok，零冲突
  merge feat/pack-kernel-compat-gate     ok，零冲突
  merge feat/pack-0.2x-plugin-shims      ⚠ 1 个冲突：patches/source-patches.json
```

**唯一冲突是机械性的**：双方各自往 `patches.patches[]` 数组尾部追加补丁条目
（base 4 条 + 本分支 9 条）。按 `name` 取并集即可，无同 name 重叠 —— 解完是 9 条。

解冲突后的合并态跑全量测试：**89 tests / 85 pass / 0 fail / 4 skipped**
（skip 的 4 个都是 `dist/` 相关，fresh worktree 无 dist，符合预期）。

### 由此暴露并修掉的两个既有缺陷

这两处**只在干净检出时**才会失败，主工作区里一直是绿的，所以潜伏至今：

**① `patches/files/_shared/**` 未受 `-text` 保护**

`.gitattributes` 只保护了 `patches/**/*.diff`。但 `patches/files/_shared/settings-compat.js`
是**被 git 跟踪的普通文件**：生成器读它造 `create` diff，manifest 钉的是它的 sha256
（`7903a521…`）。主工作区恰好是 LF，干净检出变 CRLF（实测 167 个 CR）→ 哈希变
`0dca6997…` → `source-patches.test.mjs` 的 create-mode 用例直接红。

→ 补规则 `patches/files/_shared/** -text`。

**② 根 `README.md` 停在 0.2.3，`suite/README.md` 已是 0.2.4**

`full-package.test.mjs` 断言「根 README 与 suite/README 逐字节相等」。main 上这两份
本来就不一致（`6ab76c7` 只更新了 suite 那份），而 package.json / bootstrap.json
都是 0.2.4。主工作区因文件陈旧（fs 未跟 HEAD 刷新）恰好两份都是 0.2.3，表现成绿。

→ 用 suite 那份（权威 0.2.4）覆盖根 README，并把两份统一成 LF 行尾
（此前根是 LF、suite 是 CRLF，内容同、字节不同，同样过不了字节相等断言）。

两轮修复后，合并态从「2 红」变成 **0 红**。

## 合并路径（第九轮复核，含新增的 3 个补丁）

```
从 origin/main (4565123) 开始逐个 merge：
  #13  fix/gitattributes-patch-eol      CLEAN
  #10  fix/computer-user-0.3.7          CLEAN
  #12  feat/picturereader-3.5.0         CLEAN
  #11  feat/pack-kernel-compat-gate     CLEAN
  #14  feat/pack-0.2x-plugin-shims      ⚠ 1 个冲突（唯一）
```

**唯一冲突 = `patches/source-patches.json`**，纯机械：多个分支各自往
`patches.patches[]` 数组尾部追加补丁条目。按 `name` 取并集即可 ——
base 4 条 + 本分支 11 条 = **11 条**，无同 name 重叠。

解完冲突的合并态：**89 tests / 85 pass / 0 fail / 4 skipped**（skip 都是 dist 相关）。

## 合并方案（已实测验证，可直接照做）

上游 `Ebony-Vinyl/EAC-Pack` 当前有 10 个 PR 待合。我的 #14 是叠加分支，依赖其中 5 个。
用 detached worktree 真跑了一遍完整合并：

```
从 origin/main (4565123) 开始，逐个 merge：
  #13  fix/gitattributes-patch-eol      CLEAN
  #10  fix/computer-user-0.3.7          CLEAN
  #12  feat/picturereader-3.5.0          CLEAN
  #11  feat/pack-kernel-compat-gate      CLEAN
  #14  feat/pack-0.2x-plugin-shims      ⚠ 1 个冲突（唯一）
  #9   feat/ofm-2.5.6                   （在解完上面冲突后）CLEAN
```

**唯一冲突 = `patches/source-patches.json`**，性质是纯机械的：多个分支各自往
`patches.patches[]` 数组尾部追加补丁条目。按 `name` 取并集即可 ——
base 4 条 + 本分支 9 条 = 9 条，无同 name 重叠（`computer-user` 在 base 与本分支
内容相同，取任一份均可）。

**解完冲突后的完整合并态：89 tests / 85 pass / 0 fail / 4 skipped**
（skip 的都是 `dist/` 相关，fresh worktree 无 dist）。

> 注：#9 ofm 的冲突曾一度看起来存在，但那是「在未解决冲突的工作区上继续 merge」
> 造成的假象。解掉 source-patches.json 后 OFM 合入无冲突。

### 两个 PR 的状态

| PR | base | mergeable | 说明 |
| --- | --- | --- | --- |
| EAC-Pack [#14](https://github.com/Ebony-Vinyl/EAC-Pack/pull/14) | `Ebony-Vinyl/EAC-Pack:main` | `true` | `blocked` = 需他人批准 |
| EAC-Desktop [#488](https://github.com/Ebony-Vinyl/EAC-Desktop/pull/488) | `Ebony-Vinyl/EAC-Desktop:main` | `true` | `blocked` = 需他人批准 |

## 第八轮：两处 React #130 的真凶找到了（上一轮误判）

上一轮我把这两处崩溃归为「第三方插件、本仓未改动其内容」。**这个判断是错的** ——
二分定位后确认，两个元凶（`dsh-session-manager`、`dsh-webui-prompt-optimizer`）
**都经由本仓重打包**。

### 现象

全量启用 61 个 bundle 时稳定报：

```
slot entry crashed in 'sidebar.footer.action'
slot entry crashed in 'conversation.input.right'
→ Minified React error #130 (Element type is invalid ... got: undefined)
```

不崩页面，只是**该槽位静默消失**（少一块 UI）。RPC 全绿，只有 CDP 抓 console 才看得见。

### 定位：二分 61 → 2

```
内核 3 个 bundle          0 条
+ 前 29                  0 条
+ 后 29                  2 条   ← 落在这里
+ 其中 14                2 条
+ 其中 7                 1 条   ← 只剩 footer
+ 只留 dsh-session-manager      1 条  ← 元凶 A
+ 后 4 个候选             1 条   ← 只剩 input.right
+ 只留 dsh-webui-prompt-optimizer 1 条  ← 元凶 B
```

### 根因：primitives 图标在 0.2.x 改了命名形态

0.2.x 的 `@deepseek-ai/dsh-client-ui-primitives` **只导出**
`<Name>Regular` 与 `<Name>Medium` 两种变体（196 个图标），
**既没有裸名 `<Name>`，也没有旧版的尺寸后缀形式**。两个插件用的是旧名：

| 插件 | 旧名（缺失） | 新名 | 依据 |
| --- | --- | --- | --- |
| `dsh-session-manager` | `IconArchiveOutline20` ×2 | `IconArchiveOutlineRegular` | 20px / 1px stroke → Regular |
| `dsh-session-manager` | `IconWarningOutline16` | `IconWarningOutlineMedium` | 16px / 1.3px → Medium |
| `dsh-webui-prompt-optimizer` | `IconLoadingOutline16` ×2 | `IconLoadingOutlineMedium` | 同上 |
| `dsh-webui-prompt-optimizer` | `IconSparkle16` | `IconSparkleMedium` | 同上 |

查证方式不是猜：读 primitives bundle 的 export 行（12381 行 / 6615 字符），
列出 196 个 `Icon*` 名字对照，确认 `Regular`/`Medium` 存在、裸名不存在。

> **走过一次弯路**：第一版把 20/16 都映射成裸名 `IconArchiveOutline`，仍崩 ——
> 因为裸名根本不在导出表里。改成 Regular/Medium 才真正修复。
> 教训：这类"改名"必须对着**真实导出清单**核，不能按直觉去后缀。

### 实测

```
只留 dsh-session-manager（旧产物）    1 条 footer 崩
换新产物（图标已改）                  0 条
只留 dsh-webui-prompt-optimizer（旧）  1 条 input.right 崩
换新产物                              0 条
61 个 bundle 全量                     0 条  ← 两处都好了
```

**视觉证据**：侧栏底部出现了「会话管理」按钮（之前该槽位整体消失）。

## 第九轮：agent-teams 保活 + 找到 compact 设置卡的真正归属

### ① agent-teams：存在性探测 + 降级，而不是崩

0.2.x 的 `SubagentRuntime` 退役了 `registerContinuableSetup`（改 provider 模式：
`registerProvider` + `observeActivation`）。`members.js` 顶层无条件调用，
`apply()` 抛 TypeError → 整个 fiber failed → 连 8 个 `agent_teams_*` 工具都注册不上。

改法：**存在性探测**。有钩子（0.1.x）原样调用；没有（0.2.x）返回同形空壳
`{ withPending(p,l,s,op) => op() }` 并日志明说降级。

为什么降级而非重写：重写要动子代理创建 / 冷恢复 / durable record 三处语义，
那是 fork 上游实现（违反 `patches/README.md` 红线）；而该钩子只服务
「冷恢复时还原成员模型选择」这一个增强点，建队/任务 DAG/派活/消息/状态都不经过它。

实测：`fiberPhase` failed → **active**，启动审计那条失败消失。

### ② compact 设置卡的真正归属：Desktop 内置，不是 Pack 补丁

上一轮我给 compact 打了 0.2.x 适配，但这轮发现**它从来没生效过**：

- Desktop 把 `compact` 标成 `builtin` / `bundled`，运行时由 `companion-sync`
  从 `assets/plugins/dsh-compact` 拷进 profile，**优先于** Pack 的 repack 版；
- 那份内置源码是 1.0.0 + v6 旧垫片，仍调已退役的 `ctx.settings.register`，
  try/catch 静默降级 → `settings/describe` 里查不到 `compact`；
- **交叉核对 12 个补丁包：只有 compact 一个落在 `builtin/bundled`**，
  其余全是 `external`(market) 或 `recommended`(pack)。

所以正确归属是 Desktop 内置分发。处理：
- Pack 侧撤掉 compact 的补丁条目与 diff（产物回到 14643B，与 main 一致）；
- Desktop 侧把三处适配（垫片补 `createSettingsScope` / 改用该调用 /
  根 schema 标 `volatile()`）同步进 `assets/plugins/dsh-compact`。

实测：`settings/describe` 命名空间 **25 → 26**，出现 `compact`；
「自动压缩」设置卡完整渲染（启用开关 / 阈值滑块 80% / 立即压缩按钮）。

> 一处踩过的坑：第一版把 `export const Config = ...` 插在
> `indexOf('})\n')` 之后，锚到了 `jsonResponse()` 里 `res.writeHead({...})` 的收尾，
> Config 定义落进函数体把函数切坏（`node --check` 报错）。第二版改锚
> `}).description('DSH 请求路径上下文压缩')` 才对。

### 结论：**22 PASS / 0 FAIL —— 首次零失败**

```
settings/describe 命名空间   26（含 compact）
9 个插件 fiberPhase         全部 active
启动审计                    0 失败（唯一一条是 agent-teams，已降级保活）
前端渲染                    0 个 React 错误、0 个 slot 崩溃
设置分区逐项                 27/27 可点，截图各异
```

**架构副产物**：`dsh-compact` 同时被两个分发面声明，导致 Pack 的补丁被内置版
静默覆盖。规则应是——凡 Desktop 标 `builtin/bundled` 的包，Pack 只原样透传、
不再打补丁；否则补丁白做且掩盖问题。

## 第十轮：把「分发面归属」这条架构规则固化成测试

上一轮撤掉 compact 补丁时发现了一个**架构级问题**：`dsh-compact` 同时被两个分发面
声明，Pack 的补丁被 Desktop 内置版静默覆盖、从未生效。当时我在报告里写了
「凡 Desktop 标 `builtin/bundled` 的包，Pack 只应原样透传」，但**那只是文字，
没有测试守住** —— 同类错误随时能再犯。

本轮补上 `suite/test/distribution-boundary.test.mjs`：

```
判据：按 catalog 的 name -> id 找到 .sync/plugin-distribution.json 的条目
  distributionClass === 'builtin' 或 delivery === 'bundled'
    → 不允许登记补丁（应改 Desktop 内置源码）
  其余（external / recommended / 不在分发表里）→ 允许
```

「不在分发表里」也算允许：`wallpaper-engine` / `session-manager` /
`webui-prompt-optimizer` 这类只经 Pack 分发的包本就不在 Desktop 的 46 项清单里，
Pack 是它们唯一归属。fail-open 取舍：Desktop 仓不在同一 checkout 时 **skip**，
文件在就必须判（与 `kernel-compat.mjs` 对内核缺失的口径一致）。

**反向自测坐实守卫有效**：把 compact 塞回 manifest 后立刻红：

```
✖ Pack 不给 Desktop 内置（builtin/bundled）的包打补丁
  冲突条目：
    dsh-compact (id=compact, class=builtin, delivery=bundled)
ℹ pass 1 / fail 1
```

恢复后转绿。当前 11 个补丁包 **conflicts: 0**（全部归属正确）。
全量 suite **89/89**（原 87 + 新增 2）。

### 顺带核实：`client-ui-custom` 的风险已被可靠覆盖

它仍在 seed 的 `dsh.profile.bundles` 里，但**运行时防御幂等有效** ——
实测把它重新注入 profile（bundles 62）后启动，自动剥离回 61：

```
[sidecar] [boot] 已从 profile 剥离 1 个与官方内核不兼容的 bundle:
  @ha-na-bi/dsh-client-ui-custom（compat 条目不激活，否则整机 GUI 拒绝启动）
```

依赖条目同步移除、启动审计 0 失败、GUI 正常。因此维持现状是可接受的
（真正的修法在 seed 生成端，但那个脚本在未入库的构建工作区，两个代码仓都没有守它）。

## 第十一轮：发现 builtin 包的「版本双轨」并纳入可见性

### 顺着 compact 的线索又挖出一层

compact 的陷阱不止「补丁被内置版覆盖」。继续查发现**第二层**：Pack 的 catalog 把它
标成 **1.0.1**，但那是 `OVERRIDES` 硬抬高的版本号，`.cache/eac-src` 里的源实际是
**1.0.0** —— 与 Desktop 内置版同号。

也就是说 Pack 的 1.0.1 是个**虚拟版本**：既不是新内容，也永远不会被用到
（Desktop 内置优先），却老老实实进了 `dist/index.json` 与 `bootstrap.json`，
让「有个 1.0.1 修复」看起来成立。

顺着这条线索交叉核对全部 **10 个 builtin 包**，发现 **4 个版本双轨**：

| 包 | Desktop | Pack | 性质 |
| --- | --- | --- | --- |
| dsh-compact | 1.0.0 | 1.0.1 | Pack 是虚拟抬版 |
| dsh-plugin-shield | 0.1.2 | 0.1.0 | Pack 陈旧 |
| dsh-settings-scroll-fix | 2.0.3 | 2.0.2 | Pack 陈旧 |
| dsh-unified-market | 0.4.0 | 0.4.1 | Pack 更新但不会被用 |

内容也确实不同（逐文件比对：compact 3 diff、plugin-shield 1、scroll-fix 1、
unified-market 2），不是单纯的版本号笔误。

### 处理：只做可见性，不做门禁

新增第四条用例，把差异打进测试输出（console），**不判失败**。

理由：这是分发策略问题 —— 「Desktop 内置为准」还是「Pack 为准」需要维护者裁决，
不该由一条测试单方面卡住合并。但不报出来它就会继续无声累积。

```
[distribution-boundary] builtin 包版本双轨（Desktop 内置版优先，Pack 那份不会被用到）:
  dsh-compact: desktop=1.0.0 pack=1.0.1
  dsh-plugin-shield: desktop=0.1.2 pack=0.1.0
  dsh-settings-scroll-fix: desktop=2.0.3 pack=2.0.2
  dsh-unified-market: desktop=0.4.0 pack=0.4.1
```

**待裁决三个选项**：(A) 以 Desktop 内置为准，Pack 对齐或移除这 4 条；
(B) 以 Pack 为准，把新版同步进 Desktop assets；(C) 维持双轨但接受差异记账。
compaction 那条已按 A 处理完。

### 顺带修掉验收脚本里一条恒真假检查

`accept-full.mjs` 里原本有 `check('（模块图需在下方 pnpm/node 探针里逐包验证）', true, ...)`
—— 永远 PASS、不测任何东西，白占一个通过数。换成真检查：**补丁包的自包含相对导入
必须都能解析**（`./settings-compat.js` 这类）。这能抓到 create 模式漏文件、
files 白名单丢文件那类缺陷。

> 中间走过一次弯路：第一版去查 `@deepseek-ai/*` 能否被 createRequire 解析，
> 结果 5 条全红。那是假阴性 —— profile 插件由内核的 resolution router 供给内核包，
> 普通 createRequire 看不到那层路由。反证：`dsh-prompt-custom` 的
> `dsh-system-prompt` 解析失败但运行时 `fiberPhase=active`、设置卡正常。
> 改成只查相对导入后转绿。

## 第十二轮：把 seed 筛选规则收进版本控制（上一轮的「待跟进」落地了）

上一轮我在报告里写：把 `prepare-composition.mjs` 纳入版本控制，或把规则移进已入库组件。
这轮选了**后者**——生成脚本还依赖大量本地路径与构建上下文，整体入库不现实；
但**规则**完全可以。

### 新增 `scripts/repack/seed-bundles.mjs`（已入库）

```
SEED_BASE_BUNDLES                三个基座条目
shouldSeedBundle(entry, catalog) 单条判据：status 必须 preinstalled、且 catalog 无 compat
computeSeedBundles(entries)      整体计算（去重、保序、基座在前）
```

`prepare-composition.mjs` 改为 `import { shouldSeedBundle }` 调用，不再复制判据。
规则从此**只有一份事实源**，脚本重写也只是改一行调用。

### 5 条单测钉住它（`suite/test/seed-bundles.test.mjs`）

- compat 条目一律不进（含两个真实案例）
- 非 `preinstalled` 状态不进
- **皮肤与社区包仍然进** —— 专门钉住「被 `defaultEnabled` 误伤」那个坑
- 基座去重
- **用真实 composition 跑一遍**：断言 61 条、所有 compat 不在内、所有皮肤在内

### 端到端验证（不是「有实现没人调用」）

```
生成端 dry-run                computed bundles: 61
                              contains client-ui-custom: false
                              contains side-session: false
                              皮肤 15 个全保留、dsh-pet / theme-endfield 都在
实际跑 prepare-composition     exit 0，产出 seed 62 条（无重复条目）
                              removed: side-session, client-ui-custom（仅此两条）
distribution-boundary 再跑    「seed 里仍含 compat 条目」告警**不再输出**
bootstrap 与 dist 一致        items=72  drift=0
compact                       1.0.1 / 14643B / locallyRepacked=N（撤补丁后正确态）
全量 suite                    96/96
实机验收（seed 变干净后）      22 PASS / 0 FAIL
```

最后一条是重点：**清理 seed 没引入回归**，而告警不再输出证明共享规则真的接上了。

## 第十三轮：补上「工具真的注册了」这条验证

前十二轮的验收只证明到 `fiberPhase=active`，没证明插件的**功能**真的落地。
本轮补这个缺口 —— 因为 agent-teams 的修复目标就是「8 个 `agent_teams_*` 工具
能注册上」，只验到 active 就停下是不够的。

### 直接读工具注册表走不通

内核**没把 tools 暴露成 RPC**，实测这批端点全部 `not found`：

```
tools/list  tool/list  agent/tools  tools/inventory  toolInventory/list
tools/catalog  session/tools  sessions/tools  agentLoop/tools
```

唯一可用的是 `agentPresets/list`（返回预设 id，不含工具名）。

### 改用「active + 零工具错误」这条等价链

原理：`agent-teams` / `computer-user` 这类插件在 **activate 内部**就调
`ctx.tools.register(...)`。如果那里抛错，fiber 会直接 failed，不会是 active。
所以对这类插件：

```
fiberPhase === 'active'  ⟺  activate 全程没抛错  ⟹  ctx.tools.register 调用成功
```

加上「启动段日志无 tools 错误」这条独立佐证，即可成立。

### 实测

```
启动段无工具注册错误              PASS（runtime.log 与 dsh-web.log 都无 tools 错误）
静态 defineTool 数量               @nanmicoder/dsh-agent-teams = 10
agent-teams 降级警告               恰好一条，在预期位置，无其它异常
验收                            23 PASS / 0 FAIL（新增第 23 项）
```

`defineTool x10` 与真实工具数一致（create / add_member / create_task /
reassign_task / claim_task / update_task / send_message / status / delete /
list_members 那组），而插件 active 就说明这 10 处注册调用都跑过了。

### 顺带确认降级是「明说」而非「静默」

`[agent-teams] 内核未提供 subagents.registerContinuableSetup（0.2.x 改为
provider 模式）：成员模型选择的持久化/冷恢复已降级，其余功能正常。`

这条警告在验收输出里被列为 `INFO 已知降级` —— 功能降级必须可见，不能像我
先前遇到的 compact 那样静默 try/catch 吞掉。

## 第十四轮：全量重建（含壳编译）+ 修掉唯一的不可复现点

### 先补上「重建 full 调试构建」这件事的完整含义

此前我只验过 `--stage`（装配），没验过 `--shell`（编译 Rust 壳）。本轮跑完整全量：

```
node tools/build-variant.mjs fresh21      装配 + 编译壳，1.9 分钟，exit 0
  壳产物  dsh-eac-shell.exe 21036032B，时间戳 7:36:06（全新编译）
  实例启动 pid 79128，23 PASS / 0 FAIL
  截图    标题/侧栏/「会话管理」/壁纸/桌宠 全部正常
```

### 顺手量可复现性，量出一个真缺陷

「重建过了、问题还在不在」要能当证据，前提是构建可复现。于是做了对比：
同一 commit 连跑两遍，逐文件比 app/ 下的受控产物。

```
第一遍  controlledHash = 1cd1a23757a45f7f…   files=956
第二遍  controlledHash = 97f9d912c3d8479a…   files=956
changed: dsh-desktop/distribution-descriptor.json   ← 只有这一个
added / removed: 无
node_modules 签名两遍一致
```

**956 个受控产物里恰好只有 1 个不同**。打开看，是
`x-eac.generatedAt: new Date().toISOString()`。

### 改法：按可复现构建的通行约定取值

```
1. SOURCE_DATE_EPOCH（秒级 unix 时间）
2. 当前 HEAD 的 commit 时间（git log -1 --format=%cI）
3. 兜底当前时间（无 git 时，如源码 tar 解包）
```

不用固定常量的理由：那会让描述符在换 commit 时也不变，失去「这份产物由哪版源码、
何时生成」的信息价值。commit 时间既确定又真实。

### 验证

```
--stage 连跑两遍    controlledHash 8203e7fa… ×2    identical: true
全量重建连跑两遍    controlledHash 3d460f17… ×2    identical: true，files=956
tsc                  exit 0
实机验收             23 PASS / 0 FAIL
```

> 一个测量陷阱：第一次我拿「整棵树哈希」比，把 node_modules（pnpm 哈希目录名、
> mtime 元数据）的噪声算了进去，得出「不可复现」的错结论。改成「受控产物 hash
> + node_modules 的包名@版本签名」分开量之后才看清真实差异只有 1 个文件。
> 另外 `dsh-eac-shell.exe` 由 `--shell` 产出、`--stage` 不产它，跨参数对比会差
> 这一个文件 —— 已在脚本里显式排除并写明理由。

## 第十五轮：基线对比 —— main 本身是红的，我的分支反而是绿的

### 动机

前十四轮所有测试都在**我的分支**上跑。但「分支绿」不等于「合并后 main 绿」——
如果 main 本身有既有失败，合并后仍会红，只是失败归属变了。
本轮在干净的 detached worktree 上量了 main 基线。

### 结果

```
origin/main（未合任何 PR）     54 tests / 49 pass / 1 FAIL
我的分支（含 README 修复）      96 tests / 96 pass / 0 FAIL
```

**main 上那个失败**是：

```
✖ Git and Release metadata pin identical assets and use matching documentation
  actual:  '<h1 align="center">\r\n  <img src="docs/assets/EAC-Pack.svg" ...
  expected:'<h1 align="center">\r\n  <img src="docs/assets/EAC-Pack.svg" ...
  root README  ## 0.2.3：安装阶段级联取得完整资源
  suite README ## 0.2.4：安装阶段级联取得完整资源
```

正是我在**第七轮**诊断并修掉的那个既有缺陷（`6ab76c7` 只更新了 suite/README，
根 README 停在 0.2.3；断言要求两份逐字节相等）。

### 这条证据的意义

1. **合并 PR #14 会改善 main 的测试状态**（1 红 → 0 红），不会恶化；
2. 那 42 个新增测试（54 → 96）覆盖的是**新的守卫**（补丁字节闭合、分发归属、
   seed 规则、create 模式、files 白名单），不是把既有测试改宽；
3. 说明我前几轮反复强调的「干净检出才暴露的缺陷」不是假想 —— main 上现在就红着，
   只是在各人的脏工作区里看不出来（工作区文件陈旧时两份 README 恰好都是 0.2.3）。

### 附带核实：标准入口可用

```
npm test          96/96（走 package.json 的 scripts.test，不是只靠 node --test 直调）
npm run verify:kernel   0 命中，exit 0
```

## 第十六轮：澄清 lite/full 的真实差别 + 记录实例复制的硬约束

### 「lite 和 full 两个调试版」到底是什么

用户最初的要求是重建 lite 和 full 两个调试变体。查证后确认：**调试构建只有一个产物**。

`stage-resources.mjs:386` 固定写 `profile.txt = 'full'`，但 `install-profile.js:6` 的注释
说得清楚：那是**历史插件启停策略标记，不是产品档位**。而
`LITE_DEFAULT_DISABLED` 当前是**空数组**（ISO-005 收敛后，随包的 9 个插件全部是
核心组必需项，精简版反而要保留它们）。

所以：

- 同一份 `app\` 同时服务 lite 与 full；
- 真实差别是**装不装 EAC-Pack 的插件包** —— full 实例 `dsh.profile.bundles` 61 条
  （基座 3 + EAC-Pack 58），lite 只有基座 3 条。

本次验收覆盖 full 形态（`variants/fresh21`：61 bundles / 26 个 settings 命名空间 /
9 个目标插件全 active）。lite 形态走同一份构建、共享同一套修复。

### 试图复制目录造 lite 实例，撞了两堵墙（都是我的操作错误，但值得记）

**墙一：环境目录不可复制。** 复制整个变体后，sidecar 在环境初始化时拒绝接管：

```
Error: Refusing to adopt non-empty environment directory:
  ...\fresh21\data\dpx\dsh-environments\eac-stable
```

原因是环境目录里有两处写死的绝对路径 ——
`.dpx-environment.json` 的 `root` 与 `dsh-distribution.json` 的各资源 location。
这是**有意的隔离保障**（防误接管他人环境），不是缺陷。

**墙二：我自己的两个疏漏。** `variant.json` 的 `app` 字段照抄了原实例路径，
导致「壳启动了但日志空白、立刻 code=0 退出」（它跑的是别人的 exe）；
`logs\` 目录不会自动创建，`launch.mjs` 在 `fs.openSync` 那步 ENOENT。

三处都已写进 `lite/README.md` 的「一个实例不能靠复制目录造出来」一节，
并给出正确做法（复制整个变体但删掉 `data\`，改 `app` 字段，让它首次启动自建）。

### 顺带修正一处过时文档

`distribution-boundary.test.mjs` 写于第 11 轮，提示语还说「生成端规则在未入库的
`prepare-composition.mjs`」—— 但第 12 轮已把规则移进 `scripts/repack/seed-bundles.mjs`
并让生成端调用。那句提示会误导人按图索骥去找未入库脚本。已更正（`6299f07`）。

## 第十七轮：闭环 lite 形态验证 + 修掉端口冲突的静默失败

上一轮我承认「lite 形态未验证」是个未闭环项。这轮查清并闭环了。

### 上一轮失败的真因：端口冲突，而且它静默失败

上一轮我以为「复制环境目录导致拒绝接管」，那只是**其中一次**失败的原因。
这轮用全新自建 data 根重试，壳仍然在写入任何日志前 `code=0` 退出。

真因是：**壳在两个固定端口上监听** —— 19873（ws bridge bootstrap）与
49223（web 服务）。另一个变体（fresh21）正在跑并占着端口，于是新实例启动即退，
**但既不写日志也不报错**，日志里只有一行时间戳。

`launch.mjs` 只如实打了一行「壳已退出 code=0 signal=-」，看不出任何原因。
这就解释了为什么两次排查都走偏。

### lite 形态最终验证通过

停掉 fresh21 后重试，litefresh 正常启动（自动避让到端口 63233）：

```
profile bundles           2 条（只有 @deepseek-ai/dsh-base + dsh-web-app）
                          —— full 是 61 条（基座 3 + EAC-Pack 58）
settings 命名空间         20 个（纯内核，含内置 compact）
                          不含第三方插件命名空间（conversation-tweaks 等）
GUI 渲染                  rendered=true，52779B 截图
                          纯净原生界面、无皮肤/无桌宠/无侧栏扩展、「预览版说明」首启弹窗
```

截图对比很直观：**full 是深蓝皮肤 + 女仆壁纸 + 桌宠 + 「会话管理」侧栏项；
lite 是官方原生暗色界面、只有「新会话/插件/工作区/设置」四项。**
这就是 lite 与 full 的真实差别 —— 同一份构建产物，插件装与不装。

### 把静默失败改成可诊断

`launch.mjs` 的 `child.on('exit')` 增加 `probeEarlyExitReason()`：

- 日志 < 1KB（= 没正常跑起来）时触发；
- 同步探测 19873 / 49223 是否有监听：
  - 有 → 明确报「端口被占用」，并给出该变体自己的 stop 命令（枚举磁盘上现有变体名）；
  - 没有 → 说明「壳在写入任何日志前就退出」，并给出可手工复现以看到 Rust 输出的三条命令。

实测两条路径都验证过：

```
端口冲突时    诊断：端口被占用 —— 19873 上已有实例在监听。
              另一个变体很可能正在运行。先停掉它再启动本变体：
                node tools\launch.mjs --stop --variant fresh21  ...
资源树缺失时  资源树不完整，缺少：...\app\sidecar\server.js
              先运行 node tools/build.mjs 重新装配
```

### 一句话结论

「lite 和 full 两个调试版」= **一个构建产物、两种插件装配**。两者现在都有实机证据。

## 第十八轮：查清 GLM 缺口的真实范围 + 自审查出一个潜伏 bug

### 先纠正一个我持续十几轮的误判

我一直在说「`zcode` 是唯一 provider」，因此认为 GLM review 不可替代。这轮查了
`list_subagent_models`，**实际有 8 个 provider**：

```
codearts / buddy / workbuddy / lobsterai / trae / raccoon / zcode / qiu
```

逐个查可用模型：

| provider | 提供的模型 |
| --- | --- |
| zcode | **GLM-5.3-Flash**（唯一一个） |
| codearts / buddy / workbuddy / lobsterai / trae / raccoon / qiu | 全部只有 DeepSeek 系列 |

并实测 `codearts/deepseek-v4.1-flash` **能正常回复** —— 说明失效的是
**`zcode/GLM-5.3-Flash` 这一个特定路由**，不是整个子智能体机制。

结论：GLM review 确实无法完成（唯一 GLM 路由坏了，其余 provider 没有 GLM），
但「所有路由都不可用」这个说法是错的，之前据此放弃派发是过度推论。

### 试着派发独立 review，静默失败

用 `codearts/deepseek-v4.1-flash` 派了一个审查任务（审查 6 个具体点：create 模式
fail-closed、files 白名单边界、seed 规则漏洞、分发守卫判据、跑测试、git 状态）。
子智能体**没有回传任何报告**，`list_agents` 也查不到它。

于是改为自己按那份审查清单逐项验证。**这个 glob bug 就是这么查出来的。**

### 查出的真 bug：files 白名单的 glob 判据只看前缀

`scripts/repack/package-files.mjs` 原判据：

```js
const star = entry.indexOf('*');
if (star > 0 && filePath.startsWith(entry.slice(0, star))) return true;
```

`entry = 'lib/types/**/*.d.ts'` 对 `filePath = 'lib/types/helper.js'` 返回 **true**。
但 npm 的 glob 不会把 `.js` 匹配进 `*.d.ts`，该文件既没补进白名单、也不会被 pack
收走 —— **静默丢弃**。

讽刺之处：这个模块的文件头就写着「不在白名单的新文件会被静默丢弃 —— tgz 打包全绿，
运行期才炸」。**判据自己复现了一次它要防的失败模式。**

**影响面诚实说明**：当前 4 个 create 模式补丁包**未被触发** —— 它们补的文件都落在
`lib/` / `lib/index.js` 这类目录或精确条目下，不经过 glob 分支。所以这是**潜伏缺陷**，
不是正在发生的故障（证据：repack 后 bootstrap 0 项变化、产物字节未动）。

但只要将来出现「`files` 靠 `**/*.ext` 覆盖、而补丁新增的文件扩展名不同」的组合就会
中招，且症状极难排查。

### 改法与验证

glob 拆成「首个 `*` 前的前缀」+「最后一个 `*` 后的后缀」，两者都必须成立。
后缀仍含通配则按「未覆盖」处理（保守）。保持原取舍：宁可多加精确路径，不可误判已覆盖。

```
lib/types/foo.d.ts   vs lib/types/**/*.d.ts -> true    ok
lib/types/foo.js     vs lib/types/**/*.d.ts -> false   ok  ← 修复前为 true
library/x.js         vs lib                 -> false   ok（兄弟目录不误覆盖）
a.js                 vs a/**                -> false   ok（目录边界）
```

`package-files.test.mjs` 7/7（第 3 条改名并加 5 条断言，3 条是本次回归）；
全量 suite 96/96。实跑 `repack --only better-sidebar`（15 项逐条列的最严苛案例）：
日志出现 `files+= lib/settings-compat.js`，产物内 shim 确实存在；4 个 create 包
逐一核对 tgz 均含 shim。

## 第十九轮：独立验收审查回传，一次改掉三处 fail-open

上一轮我派出的独立审查子智能体**过了 40 多分钟才回传**（其间我以为它挂了，自己先修了
一格）。它的报告质量很高，逐条给了文件:行号 + 实测证据。我把三条**独立复现确认**后
才改，没有照单全改。

### ① 单星 `*` 被当成能跨 `/`（最严重）

上一轮我修了「只看前缀」，但**没区分 `*` 与 `**`**。于是：

```
isCoveredByFilesEntry('lib/a/top.js', 'lib/*.js')  →  true（错）
npm pack --dry-run（files:["lib/*.js"]）            →  只收 lib/top.js，不收 lib/a/top.js
```

**不是理论风险**：`dist/` 里已有 **10 个在销包**用单星条目 —— `dsh-raw-html` 的
`lib/*.js`/`tools/*.cjs`/`tools/*.py`、三个皮肤的 `locale/*.json` 与
`assets/icons/*.ico`。只要给这些包加一个「位于子目录」的 create 补丁文件，
npm 会静默丢弃、repack 全绿、运行期才炸 —— 与 `dsh-better-sidebar` 踩的坑同型。

改成按路径段匹配（DP 实现）：`*` 只匹配一个段、`**` 才跨段。

**与真实 npm 交叉验证**（不是「我认为 npm 如此」）：构造含嵌套结构的假包，
9 种 files 模式各跑一遍真实 `npm pack --dry-run --json`，逐文件比对判据与 npm
收录结果 —— **0 处不一致**。

### ② seed-bundles 在 catalog 缺失时 fail-open

```js
if (catalog && typeof catalog === 'object' && catalog.compat) return false;
return true;   // ← catalog 为 null 时落在这里
```

catalog 缺失 =「不知道是不是 compat 包」→ 被判成「可以进 bundles」。
而 compat 包进 bundles 会让 web boot fail-loud、整机 GUI 拒绝渲染。
改为 fail-closed：宁可少装一个插件，也不能让整机起不来。真实 composition
无缺 catalog 条目（实测 0），数量不变。

### ③ diff 夹带未登记文件被静默丢弃

`applySourcePatches` 只回读 manifest 登记的 `file.path`；一份 diff 若还含别的
create 文件，`git apply` 会在 scratch 里创建它们但**函数不会回读**，仍返回 success。
改为 apply 前后各列一次 scratch 文件集合，多出的非登记项就 throw。实测拦住
`b/smuggled.js` 并给出可操作提示。

> **顺带发现一条更隐蔽的同类通道（未修，已记录）**：`git apply` 对路径不匹配的
> 补丁会 **exit 0 + stderr "Skipped patch '...'"** —— 既不报错也不应用。
> 真正的 create diff 格式是**没有 `diff --git` 头**、直接从 `--- /dev/null` 起；
> 带 `diff --git` 头时 `-p1` 会算错路径并静默跳过。当前代码只看 exit code，
> 不检查 stderr 里的 "Skipped"。实际有 hash 校验兜着（文件内容不对会报错），
> 但建议后续把 stderr 含 "Skipped" 也视为失败。

### 审查员还指出的、我认同但未在本轮修的

- `distribution-boundary.test.mjs` 的「反向自测」自己重写了一遍 `isConflict`，
  没走真实解析路径 → 形同虚设，无法发现 id 命名空间不一致（distribution 有 14 条
  用 `dsh-<id>`、catalog 用 `<id>`）导致的漏判；
- 该文件 `assert.ok(Array.isArray(offenders))` 恒真；
- `patches/files/_shared/settings-compat.js.diff` 是无引用死文件。

这三项属于「测试自身的质量」而非产品缺陷，已记入待办。

### 验证

```
全量 suite          98/98（96 + 单星回归 + catalog fail-closed 回归）
补丁重放 11 个包    ALL CLEAN（守卫未误伤正常补丁）
repack better-sidebar   files+= lib/settings-compat.js，产物含 shim
repack raw-html         成功（该包 files 用单星条目）
单星边界 17 条断言  全对（含 locale/sub、assets/icons/x 真实形态）
与 npm pack 交叉验证  9 模式 0 不一致
gate 0 命中 / tsc 0 / 实机 23 PASS 0 FAIL
```

{% hint style="info" %}
这一轮最值得记的一点：**审查员报的三条我都自己复现过才改**。其中第 ③ 条我
第一次复现时误判为「守卫没生效」，实际是我自己写验证脚本时把 `entry` 传成了
字符串（该参数要 `{name, version}` 对象），导致函数在查找阶段就 `return []`。
如果不复现、直接照报告改代码，就会把正确的实现改坏。
{% endhint %}

## 第二十轮：把「守卫自身失效」的四类问题清掉

上一轮审查员指出的是**测试自身的质量**问题。这类问题比产品缺陷更危险：
一个永远绿的测试会让人以为「已经守住了」。逐条复现后处理。

### ① 反向自测自己重写判据（形同虚设）

原用例：

```js
const isConflict = (e) => e.distributionClass === 'builtin' || e.delivery === 'bundled';
assert.equal(isConflict(compact), true);
```

把被测逻辑抄一遍再断言它自己 —— 对**解析链**的缺陷完全视而不见。

新增 `scripts/repack/distribution-entry.mjs`，判定抽成唯一实现：
`candidateIds` / `findDistributionEntry` / `isDesktopBuiltin` / `findBuiltinConflicts`。
测试与主守卫都调它。

### ② id 命名空间不一致导致静默漏判（真问题）

catalog 的 id 用裸名（`session-manager`），而 `.sync/plugin-distribution.json`
里有 **14 条**用 `dsh-<id>`。字面相等查找会漏掉它们，全部走「找不到 → 放行」。

实测后果：11 个补丁包里 3 个走放行分支，其中 `dsh-session-manager`、
`dsh-webui-prompt-optimizer` 在分发表里**真实存在**。当前结论碰巧正确
（它们不是 builtin），但判据本身是错的。

改为双向归一化查找。验证：`dsh-` 前缀条目 **12 个，归一化命中 12 个**。

### ③ 两处恒真断言

- `assert.ok(Array.isArray(offenders))` → `assert.deepEqual(offenders, [])`
  （seed 已过滤干净、实测 0 残留，可以真断言了）
- `assert.ok(Array.isArray(drift))` → 该用例是信息性的（版本双轨需维护者裁决），
  改为两条实质检查：drift 每条格式可解析 + builtin 条目存在时必须至少扫到一个
  对应目录（能抓目录解析错误导致的静默空输出）

### ④ 删除无引用死文件

`patches/files/_shared/settings-compat.js.diff`（3524B / 67 行）：manifest 引用数
**0**，生成器实际读的是 `_shared/settings-compat.js`（7126B，无 .diff 后缀）。
内容与 4 份在用的 `settings-compat.js.diff`（`e77526438ca1a5f1`，167 行）**字节不同**
—— 早期版本残留。删除后重打包照常工作。

### ⑤ 顺手补上 `git apply` 的静默跳过通道

`git apply` 对路径不匹配的补丁会 **exit 0 + stderr `Skipped patch`**。原代码
只 catch 非零退出，成功时不读 stderr。实测三种触发条件：

```
a) diff 要 modify 的文件在 scratch 里不存在         Skipped patch 'x.js'.
b) create diff 带 `diff --git` 头、-p1 剥前缀不符   Skipped patch 'y.js'.
c) 要 create 的文件在 scratch 里已存在              Skipped patch 'z.js'.
```

(b) 值得记：本仓 create diff 的约定是**不带 `diff --git` 头**、直接从
`--- /dev/null` 起。我上一轮手工造验证 diff 时带了头，被静默跳过，误以为
「守卫没生效」，排查了好几轮。

当前有 `outputSha256` 兜底，坏补丁不会溜过去；但报错会指向「hash mismatch」
而非真因「根本没应用」。把 stderr 纳入判定后，报错直接指向真因。

**诚实标注**：这条没有独立自动化用例。我试了 4 种场景想构造「只触发 Skipped
不触发夹带守卫」，每次都被另一条守卫先拦住 —— 说明两道守卫互补、覆盖面比单条更全。
本项属防御性改进（已有 hash 兜底），不构成未闭环缺口。

### 验证

```
全量 suite            98/98
补丁重放 11 个包      ALL CLEAN（Skipped 检测未误伤正常补丁）
repack better-sidebar / agent-teams / session-manager  三个包全部 OK
gate 0 命中 / tsc 0 / 实机 23 PASS 0 FAIL
distribution-boundary  4/4（反向自测走真实实现，含归一化回归 5 条断言）
```

## 第二十一轮：我上一轮的「修复」是假修复，这轮改成真的

### 发现过程

本轮派审查员审最近两个提交，我在等它回传时先自查了一个点：
`b85aebe` 里我加的 `git apply` Skipped 检测，变量叫 `applyStderr`，但值是
`execFileSync(...)` 的返回值。

实测 `execFileSync` 在成功路径**只返回 stdout**：

```
case A 两者都输出   return = "TO-STDOUT\n"
case B 只有 stderr  return = ""
case C 只有 stdout  return = "only-stdout\n"
case D 都没有       return = ""
```

而 `Skipped patch` 写在 **stderr** → **这段检测永远不会触发**。
它是一段「看起来防御了、实际没生效」的假代码，比不加更糟 ——
因为注释在撒谎，下一个人会以为这里已经有保护。

### 更深的发现：不带 `-v` 时 git 连信号都不给

继续跑完整矩阵（5 种场景 × 带/不带 `-v`）：

| 场景 | 不带 `-v` | 带 `-v` |
| --- | --- | --- |
| create + `diff --git` 头 + 空 scratch | exit 0, stderr **空** | exit 0, `Skipped patch` |
| create + `diff --git` 头 + 目标已存在 | exit 0, stderr **空** | exit 0, `Skipped patch` |
| create + 无头（本仓约定） | exit 0, **文件正确创建** | 同左 |
| modify + 无头 + 目标不存在 | exit 1, "No such file" | 同左 |
| modify + 带 `diff --git` 头 + 目标不存在 | exit 0, stderr **空** | exit 0, `Skipped patch` |

**`Skipped patch` 只在加 `-v` 时出现。** 生产代码原来没加 `-v`，
所以它连「我跳过了」这个信号都收不到 —— 静默跳过是真正静默的。

同时这也解释了我上一轮为什么会误判：我当时用 `-v` 手工复现，看到了 Skipped，
就以为不带 `-v` 也会有同样的 stderr。

### 改法

1. `execFileSync` → `spawnSync`（后者能读到 stderr）
2. **加 `-v`** —— 它不是调试开关，而是这条检测的唯一信号源
3. 判定顺序：先查 stderr 里的 `Skipped patch`（报错能指向真因），再查退出码

实测确认加 `-v` 后正常补丁**不会被误判**：11 个补丁重放 ALL CLEAN，
`repack --only better-sidebar/agent-teams` 均成功产出。

### 诚实标注：这条检测仍没有端到端自动化用例

我试了 **6 种**构造想让 `applySourcePatches` 停在 Skipped 分支，
每次都被别的守卫先拦住（夹带文件 / input 校验 / create target 已存在 / output hash）。
这说明：

- 各道守卫**互补**，实际覆盖面比任何单条都全；
- `Skipped` 分支在当前代码结构下几乎不可达 —— 真正保证正确性的是
  `outputSha256` 校验；
- 本项的价值是**让报错指向真因**（"Skipped" 而非含糊的 "output mismatch"），
  不是新增一道必需防线。

### 这一轮的教训

「我加了防御代码」和「防御真的生效」是两件事。上一轮我在提交信息里写了
「把 stderr 纳入判定」，还写了「诚实标注：没有独立用例」—— 但**没验证机制本身**，
于是交付了一段死代码。这轮先验证机制（`execFileSync` 到底返回什么），
发现是假的，才找到真做法。

对应到验收方法：**任何"防御性"改动都必须先证明信号源存在**，
否则它只是注释，不是代码。

## 第二十二轮：审查员中途失败，改为自查；顺带发现并修掉一个流程陷阱

### 派出的审查员这次没跑完

`codearts/deepseek-v4.1-flash` 的审查任务中途失败，最后一句停在
「Now let me read the full test file...」—— 没回传任何结论。
这是它第二次出问题（上一次是首次派发静默失败、重派才成功）。

于是我把它本该检查的两点自己查了。

### ① 验证「删除死文件」确实安全

全仓搜索 `_shared/settings-compat.js.diff` 的引用（含 `.cache` / `scripts` / `suite`）：

```
零引用 ✓
```

且 `_shared` 目录现在只剩必需的 `settings-compat.js`（7126B / CR=0 /
sha `7903a521…`），**4 个 create 条目的 `outputSha256` 全部等于它**。
生成器读的也是这个路径。删除没有破坏任何链路。

顺带确认 4 个 create 包都能重打包，产物内 `package/lib/settings-compat.js` 都在：

```
@deepseek-ai/dsh-conversation-tweaks   shim in tgz: true
@deepseek-ai/dsh-prompt-custom         shim in tgz: true
@deepseek-ai/dsh-openclaw-bridge       shim in tgz: true
dsh-better-sidebar                     shim in tgz: true
```

（前 3 个包的 `files` 字段是 `undefined`，npm 收全部内容，所以不需要 `files+=`
补齐；只有 `better-sidebar` 有 16 项白名单、需要补。这是正确行为不是缺陷。）

### ② 我自己踩了一个流程陷阱，顺手修掉

重打包 4 个 create 包做回归后跑测试，报：

```
✖ bootstrap manifest covers the catalog and pins the patched hashes
  AssertionError: @deepseek-ai/dsh-conversation-tweaks: manifest hash must match dist
    actual:   c2d03c43…
    expected: 62342254…
```

原因：`repack.mjs --only <pkg>` 会改变 tgz 的 sha256，但**不会**回头改
`suite/assets/bootstrap.json`。而那个同步脚本原先只存在于 `.cache/`
（**gitignored**）—— 等于「只有本机作者知道的一步」，别人踩红只会以为是自己改坏了。

改法：搬到 `scripts/repack/sync-bootstrap.mjs`（已入库），修正 `ROOT` 层级
（`.cache/` 深 1 层 → `scripts/repack/` 深 2 层），头部写明「为什么必须有这一步、
什么时候要跑」。同时同步本次产生的 3 条 hash。

```
node scripts/repack/sync-bootstrap.mjs  →  bootstrap items updated: 0（幂等）
全量 suite                              →  98/98
```

**待跟进**：更彻底的做法是让 `repack.mjs` 全量跑完时自动调用本脚本，
让「人忘了跑」这个失败模式彻底消失。本次先把这一步变成可发现的。

### 验证

```
全量 suite        98/98
补丁重放          ALL CLEAN
gate              0 命中
4 个 create 包    重打包成功，shim 均在产物内
实机              23 PASS / 0 FAIL
```

## 第二十三轮：把上一轮的「待跟进」做完 —— 自动同步，不再依赖人记

上一轮把 bootstrap 同步脚本从 `.cache/`（gitignored）搬进 `scripts/repack/`，
解决了「别人不知道有这一步」。但只要还是人工调用，就仍会漏 —— 上一轮我自己就漏过。

这轮接进 `repack.mjs` 收尾，重打包即自动同步。

### 实现

`sync-bootstrap.mjs` 改成**双用途**：
- 导出 `syncBootstrapEntries({ names, log, dryRun })` 供 repack 调用；
- 保留 CLI 入口，靠 `invokedDirectly` 判定，import 时不自动执行。

`repack.mjs` 在写完 `index.json` / 清完孤儿后调用，同步范围**刻意收窄**：

| 模式 | 同步范围 |
| --- | --- |
| 全量 | 所有已登记的补丁包 |
| `--only` | 只同步「本轮重建 **且** 已登记」的包 |

后者避免单包重打包时顺手改到别人的条目（dist 里其它包可能带跨分支污染）。

同步失败**不判定整轮 repack 失败**（产物本身是对的，bootstrap 可事后补），
但会打 `WARN` 并给出补救命令，避免又变成静默漏一步。

### 闭环验证：真的测了「红 → 自动修复 → 绿」

```
① 故意把 bootstrap 里 dsh-better-sidebar 的 sha256 改成 64 个 0
② node --test suite/test/source-patches.test.mjs
     ℹ pass 8 / fail 1
     AssertionError: dsh-better-sidebar: manifest hash must match dist
③ node scripts/repack/repack.mjs --only better-sidebar
     [repack] 同步 bootstrap.json：1 条
④ node --test suite/test/source-patches.test.mjs
     ℹ pass 9 / fail 0
```

> 第 ② 步我第一次跑错了文件（`full-package.test.mjs` 里没有这条断言，
> 它在 `source-patches.test.mjs:222`）。所以第一次「没变红」是我验证方式错、
> 不是功能没生效 —— 这类「验证方法本身错了」比「功能错了」更难发现，
> 因为它的表现是「一切正常」。

### 验证

```
全量 suite             98/98
CLI 模式（幂等）       bootstrap items updated: 0
import 模式            不自动写文件，dryRun 可算变更数
--only better-sidebar  自动同步 1 条
实机                   23 PASS / 0 FAIL
```

## 第二十四轮：验收脚本的覆盖漏洞 —— 6 个补丁包从未被检查过

### 发现

这轮做收尾审计，核对了 manifest 的 12 个补丁包（11 个补丁 + compact）在实机的
`fiberPhase`：**12/12 全部 active**。但随即发现：`accept-full.mjs` 的
`PROBES` 数组**只手工列了 6 个包**。

也就是说，此前十几轮报告里那个「23 PASS / 0 FAIL」，**有 6 个补丁包完全没被验证**
—— 漏掉的是 `settings-groups` / `balance` / `wallpaper-engine` /
`session-manager` / `webui-prompt-optimizer` / `agent-teams`。它们即使全部坏掉，
验收依然全绿。

这是比"某个测试写错"更根本的问题：**验收的口径不完整**。

### 改法：从 manifest 动态生成，而不是手工列

```js
// 之前：手工 6 项
const PROBES = [ {...}, {...}, ... ];

// 现在：manifest 里登记了什么就核什么
const PROBES = manifest.patches.map((p) => ({ pkg: p.name, logMark: null }));
```

新增补丁自动纳入覆盖，不再依赖有人记得同步这份列表。

### 反向验证：覆盖真的会生效吗

往 manifest 里临时注入一个不存在的假包 `no-such-package-xyz`：

```
FAIL  补丁包 no-such-package-xyz 已安装 — profile 内缺失
FAIL  插件 no-such-package-xyz 激活 — 未安装
=== 合计：28 PASS / 2 FAIL
```

恢复后回到 28 PASS / 0 FAIL。**证明这条覆盖不是摆设**——新增条目会被真的检查。

### 覆盖变化

```
改前：23 PASS / 0 FAIL（实际只核了 6 个包）
改后：28 PASS / 0 FAIL（核了 manifest 里全部 11 个补丁包 + 其他项）
```

多出的 5 项是此前从未被验证的插件激活检查。

### 这一轮的意义

前面二十几轮我一直在修「代码里的 bug」。这轮发现的是**验收本身的 bug** ——
它更隐蔽，因为验收失败才会暴露问题，而验收漏检永远不会失败。
「全绿」只有在**覆盖完整**时才有意义。

## 第二十五轮：一次失败的自动化尝试，以及一个真实的覆盖修复

### 真实的覆盖修复（已生效）

`accept-full.mjs` 的 `PROBES` 原来手工列 6 个包，而 manifest 有 11 个补丁。
改成动态生成：

```js
const PROBES = manifest.patches.map((p) => ({ pkg: p.name, logMark: null }));
```

**反证**：往 manifest 注入不存在的假包 → `28 PASS / 2 FAIL`；恢复 → `28 PASS / 0 FAIL`。
覆盖确实生效，不是摆设。

顺带确认实机 **12/12** 补丁插件 `fiberPhase=active`（含 compact 与 agent-teams）。

### 失败的自动化尝试（如实记录）

我想给「设置卡是否有内容」加自动检查（因为 `cdp-acceptance.mjs` 只验证
「分区可点开」，证明不了卡里非空）。做了三版，**三次都错**：

| 版本 | 结果 | 错法 |
| --- | --- | --- |
| 第一版 | 导航枚举为空 | 过滤条件与 `cdp-acceptance.mjs` 不一致（`left>420` vs `innerWidth*0.42`，宽度 20 vs 40） |
| 第二版 | 5 项全 PASS | 取整个 panel 而非内容区 → 关键词在整页任何地方都命中；控件数 11138、文本被截到 4000，判定退化成「页面里有这个词」 |
| 第三版 | 5 项全 FAIL | 改成只取内容区，但兄弟容器选择器选到了空元素 |

三次错的方向不同：**一次假阴性、一次假阳性**。我没有继续调 —— 已有截图证据充分，
且这类工具调试成本高于收益。

### 为什么值得记而不是藏起来

第二版那 5 个「PASS」是最危险的状态：如果我当时就收下它，
报告里会多一条「设置卡内容自动化验证已覆盖」，而它什么都没验证。

这也解释了前几轮同一个模式：**自动化验证自己也会骗人**。所以对「卡片有内容」
这件事，我保留**人工看截图**作为证据（`26-tab-26` 「自动压缩」实测 3 控件/341 字），
而不是用一版还没验证可靠的自动工具替代它。

### 当前证据状态

| 项 | 证据类型 | 强度 |
| --- | --- | --- |
| 12/12 插件 active | RPC `fiberPhase`（权威口径） | 强 |
| 28 PASS / 0 FAIL | 验收脚本，覆盖 manifest 全部补丁 | 强（有反证） |
| 设置卡有内容 | 人工看截图（3 张已验证） | 中（非全自动覆盖） |
| 补丁字节闭合 | 逐文件 sha256 + tgz 解包核对 | 强 |

## 第二十六轮：better-sidebar 缺设置卡 —— 又一次「以为修好了其实没生效」

### 发现问题

换了个思路做设置卡验证：不抓 DOM（上一轮三次都失败），改查**驱动 UI 的数据源**
`settings/describe` 的 schema。26 个命名空间里逐个核对，发现 `better-sidebar`
**没有命名空间** —— 但它的 `fiberPhase=active`、侧栏和「产出文件」入口全都正常。

属于静默缺一块 UI。

### 根因：根 Config 没标 volatile

内核判定设置面的路径：

```js
schema(entry) { return entry.fiber?.runtime?.Config }   // 只要求有 toJSON
function volatileForm(schema) {
    if (schema.meta.volatile) return plainSchema(schema);  // ← 关键
    if (schema.type === 'object') { /* 递归子字段 */ }
    // 都不满足 → undefined → entry 被跳过，设置卡不生成
}
```

`better-sidebar` 的 `Config` 已导出但没 volatile 标记，于是走到 `undefined`。

### 我又踩了同一个坑：`volatile()` 方法根本不存在

第一版修复我写的是（在另外 6 个插件上用过的写法）：

```js
export const Config = typeof BaseConfig.volatile === 'function' ? BaseConfig.volatile() : BaseConfig;
```

实测**本仓 schemastery 3.18.0 实例上没有 `volatile()` 方法**：

```
base.volatile → undefined
实例方法: ~standard, toJSON, set, push, i18n, extra, required, ...
```

那个三元表达式永远走 else 分支，**等于什么也没做**。装上产物后命名空间仍缺失，
我才发现。

正确做法是直接写 meta（实测有效）：

```js
if (BaseConfig.meta && typeof BaseConfig.meta === 'object') {
    BaseConfig.meta.volatile = true;
}
const Config = BaseConfig;
```

`base.meta.volatile = true` 会反映到序列化输出：`"meta":{"default":{},"volatile":true}` ——
正是 `volatileForm()` 读的字段。

### 那 6 个「已修好」的插件是假的好吗？

**不是。** 它们另有机制：`apply()` 里走 `createSettingsScope()`（垫片在
`describe()`/`update()` 之上重建 scope），不依赖 `Config.meta.volatile`。
所以它们的设置面确实存在。

但这暴露一个更麻烦的事实：**同一段看起来一样的代码，在不同插件里可能一个生效一个不生效**。
不能靠「我上次这样写成功了」推断这次也行。

### 补丁生成上的第二个坑（已避）

第一版生成脚本从 `.cache/eac-src` 的**原始文件**重建 diff，把原有的
`createSettingsScope` 修复（2 个 hunk）整个丢掉了 —— 会静默回退一个已知修复。

正确做法：先在临时目录把**现有 diff 打上**得到「已补丁态」，再叠加新改动，最后用
「原始 → 最终」生成合并 diff。生成前后都断言 `createSettingsScope` 仍在。最终 4 个 hunk。

### 实测

```
修前  namespaces 26，无 sidebar
修后  namespaces 27，含 `better-sidebar`
      （注意不是 `dsh-better-sidebar` —— ns 由 Config 注册路径决定，不是包名前缀）
      refs=10，8 个字段全部就位：
      readLimit 524288 / mediaLimit 20971520 / uploadLimit 134217728 /
      listLimit 1000 / terminalsPerSession 3 / reconnectGraceMs 30000 / shell "" / shellArgs []
```

设置卡检查：`ok=6 empty=0 missing=0`。
全量 suite 98/98、gate 0 命中、replay ALL CLEAN、实机 28 PASS / 0 FAIL。

## 第二十七轮：更正上一轮的错误判断 —— `volatile()` 是否存在取决于 import 的 specifier

### 上一轮我写错了

上一轮修 `better-sidebar` 缺设置卡时，我断言「本仓 schemastery 3.18.0 实例上没有
`volatile()` 方法，所以那个三元守卫永远无效」，还把这条错误结论写进了补丁注释。

**前半句对、后半句错**。

### 实测澄清

本仓有**两份** schemastery：

| specifier | 版本 | 有 `.volatile()` | 谁在用 |
| --- | --- | --- | --- |
| `@deepseek-ai/schemastery` | 3.18.4 | **有** | conversation-tweaks / openclaw-bridge / prompt-custom / compact / soul-md |
| 裸名 `schemastery` | 3.18.0 | **没有** | better-sidebar / theme-endfield |

```
@deepseek-ai/schemastery → base.volatile === 'function'   ✔
schemastery（裸名）      → base.volatile === undefined    ✘
```

所以那个到处复制的三元守卫**对 5 个插件有效、只对 2 个 import 裸名的静默 no-op**。
代码长得一样，效果不同，差别只在 import 行。

我上一轮把「在这些插件上用过」当成「这个写法本身成立」——这是错的。

全盘审计（`tools/audit-schemastery-spec.mjs`）输出证实了这一点：

```
conversation-tweaks  spec=@deepseek-ai/schemastery  → 有效
openclaw-bridge      spec=@deepseek-ai/schemastery  → 有效
prompt-custom        spec=@deepseek-ai/schemastery  → 有效
compact              spec=@deepseek-ai/schemastery  → 有效
soul-md              spec=@deepseek-ai/schemastery  → 有效
theme-endfield       spec=schemastery(裸名)         → 三元失效
better-sidebar       spec=schemastery(裸名)         → 三元失效（已改 meta 写法）
```

### 本轮改动

1. 更正 `better-sidebar` 补丁注释：说清是 **specifier 差异**，不是「方法不存在」；
2. `patches/README.md` 新增一节「volatile() availability depends on the
   schemastery specifier」，含对照表与实测输出，并提醒：动这块之前先看 import 行。

### 验证

```
补丁重放        ALL CLEAN
重打包          OK 2478606B
全量 suite      98/98
实机            28 PASS / 0 FAIL
设置卡检查      ok=6 empty=0 missing=0
                better-sidebar: 8 个字段
命名空间        27 个（含 better-sidebar）
```

### 一条方法论

「这段代码我在别处用过、有效」不足以证明「这段代码在这里有效」。
这次差异只有一行 import，症状是**完全没有设置卡**（而不是报错）。
写成文档比写成注释更容易被下一个人看到，所以两边都写了。

## 第二十八轮：截图证实「设置卡修好了」这句话说得太早

### 做了什么

上两轮修好 `better-sidebar` 的设置面后，我只验证了**后端** `settings/describe` 里有
命名空间与字段。这轮补一张截图做视觉确认——结果发现**前端是空白的**。

### 证据

用 CDP 直接读「侧边卡片」分区的 DOM 文本（不靠截图裁剪）：

```
click: ok
{
  fullLen: 188,
  afterTab: '侧边卡片\n皮肤管理\nWallpaper Engine\n打开配置文件\n关闭',
  contentControls: 2
}
```

`afterTab` 显示「侧边卡片」之后**直接就是下一个 tab 名** —— 右侧内容区没有任何内容。
`fullLen=188` 是整页文本长度，其中绝大部分是左导航标签本身。

截图（`sidebar-card-settings2.png`）与之一致：右侧一片空白，只有「打开配置文件」按钮。

### 这不是我引入的

本次补丁只改 `lib/index.js`（`git diff --stat 3daa79c..HEAD` 只有这一个文件），
`client.js` 未动。所以「侧边卡片」分区空白是**既有的客户端问题**。

### 事实分层（我上一轮的表述有问题）

| 层 | 状态 | 证据 |
| --- | --- | --- |
| 后端设置面 | ✅ 已修好 | `settings/describe` 有 `better-sidebar`，8 个字段、默认值正确 |
| 前端卡片渲染 | ❌ 空白 | DOM 文本 188 字符、右侧 0 个内容控件 |
| 插件主功能 | ✅ 正常 | 侧栏、会话管理、产出文件入口都在工作 |

上一轮我在报告里写「设置卡出现了」——**那句话对后端成立、对前端不成立**。
准确说法应是「后端设置面建立了」，而不是「设置卡能用了」。

### 已排查但未定位的部分

- `SideCardSection` 注册在 `settings.section`（0.2.x 标准 slot，内核自己也在用），
  id/label/order 都正确；
- 它的 host 侧 API 是通的：`POST /sidebar/api/settings.get` → `{"ok":true,"value":{...}}`；
- `inject: ['slots','sessions','connection','workspaces','locale','modules']`
  全部是内核提供的服务；
- 没有 slot crash（`cdp-130-raw` captured=0）；
- 它的 `inject: () => ({ store, service })` 与内核渲染时传的 `{ close }` 不冲突
  （内核自己的 settings-account 也是同样写法）。

**没定位到根因**。下一步应在 `SideCardSection` 组件的 `store` 初始化上继续查
（`createSidebarStore()` 的初始数据来源），而不是继续猜 slot 契约。

### 本轮结论

- 上两轮的后端修复是**真实且有效**的（schema 层有硬证据）；
- 但「设置卡可用」这个更强的结论**尚未成立**，需要前端渲染证据；
- 这条列为本轮发现的**未闭环项**，如实记录而非掩饰。

## 第二十九轮：继续追「侧边卡片」空白 —— 未定位，但排除了几个错误方向

### 本轮排除的假设

| 假设 | 验证方式 | 结论 |
| --- | --- | --- |
| 后端 API 不通 | `POST /sidebar/api/settings.get` | **排除** —— 返回 `{"ok":true,"value":{...}}` |
| 注册时抛错被 `fail()` 吞掉 | 抓 console + 页面左下角红条 | **排除** —— 无 fail 红条、无 better-sidebar 的 `console.error` |
| 我的补丁引入 | `git diff --stat 3daa79c..HEAD` | **排除** —— 只改 `index.js`，`client.js` 未动 |
| 组件无条件渲染差异 | 读 `SideCardSection` 函数体 | **排除** —— 无条件返回完整 DOM（intro / versionBadge / group 等） |

### 已确认的边界

- `settings.section` 是 0.2.x 标准 slot，内核自己（settings-account / settings-models /
  settings-plugins / agent-preset）都在用同一套注册形态；
- 该插件的 `inject: ['slots','sessions','connection','workspaces','locale','modules']`
  全部是内核提供的服务；
- 截图里「侧边卡片」**被高亮选中**（蓝色背景），右侧无内容 —— 说明 slot
  `{ only: active }` 匹配成功、组件被调用，但输出为空。

### 没定位到根因

`SideCardSection` 为什么渲染为空，本轮没查出来。

### 本轮我做错了什么（值得记）

**探测工具三次失效，而我每次都先怀疑产品。**

| 工具 | 错误 | 表现 |
| --- | --- | --- |
| `probe-tab-text.mjs` | 控件计数口径不稳 | `contentControls` 在 `2` / `23` 之间跳变 |
| `cdp-shot-tab.mjs` | 未滚动导航就找 tab | `not-found` / `clicked` 交替出现 |
| `probe-section-dims.mjs` | `options` 选择器抓到别的插件 DOM | 量到 `webui-po-option`（来自 prompt-optimizer） |

每次结果不一致，我的第一反应是「产品行为不稳定」，而不是「我的工具不可靠」。
这是错的顺序：**应该先证明工具稳定，再相信工具的输出**。

### 保留的可信证据

两张截图用**同一个工具、同一套流程**拍出来：

- `sidebar-scrolled.png` —— 导航已滚动、「侧边卡片」高亮、右侧空白
- `persona-check.png` —— 同一工具，人设卡完整渲染（6 张预设卡 + 文本框 + 保存按钮）

一有一无，说明**工具基本可信，结论成立**：空白是真实的。

### 结论

- 后端设置面修复是**真实且有效的**（schema 硬证据）；
- 前端「侧边卡片」空白是**既有缺陷**，不是我引入的，**根因未定位**；
- 这条继续列为未闭环项。

## 第三十轮：「侧边卡片」空白终于定位 —— 又是旧图标名

### 定位方式（前三轮全错在哪）

前三轮我一直在**猜 DOM 选择器**：控件数在 2 / 23 之间跳变、`not-found` 与 `clicked`
交替、抓到别的插件的 DOM。每次结果不一致，我第一反应是「产品行为不稳定」。

这轮换个做法——**一行 `outerHTML` 展开容器**，立刻看到决定性证据：

```html
<div data-slot="settings.section" style="display: contents;">
  <div data-slot-error="settings.section"></div>     ← 空白的真正原因
</div>
```

`data-slot-error` 是内核 `SlotErrorBoundary` 抓到组件崩溃后渲染的占位符。
接着 hook `console.error` 取原始错误：

```
slot entry crashed in 'settings.section':
  Error: Minified React error #130 ... args[]=undefined
```

**与 session-manager、prompt-optimizer 完全同一类缺陷** —— `SideCardSection`
内部 `jsx(undefined)`。

### 根因

扫描该插件 client 的全部 32 个 primitives 符号，**24 个在内核导出表里不存在**：

```
IconBranchOutline16  IconCheckOutline16  IconChevronDownOutline14  IconChevronLeftOutline14
IconChevronRightOutline14  IconCloseFill14  IconCloseOutline16  IconCodeOutline16
IconCopyOutline16  IconDownloadOutline16  IconFolderOpen16  IconLinkOutline14
IconLinkOutline16  IconNewChatOutline16  IconPanelLeftOutline16  IconPlusOutline16
IconRefreshOutline14  IconRefreshOutline16  IconSendOutline16  IconSettingsOutline16
IconStopFill16  IconThinkOutline16  IconTrashOutline16  IconWarningOutline16
```

0.2.x 的 primitives 只导出 `<Name>Regular` / `<Name>Medium`，旧尺寸后缀已被移除。

### 改法

按尺寸语义映射：**16 → Medium，14 → Regular**（与前几轮一致）。共替换 **56 处**。
生成时先在「已补丁态」上叠加以保留既有修复，再用内核导出表逐个校验。

### 验证

```
替换处数          56
旧名残留          0
Medium / Regular  44 / 12
内核导出表校验    32 个符号全部存在
补丁重放          ALL CLEAN
重打包            OK 2478653B
全量 suite        98/98
实机验收          28 PASS / 0 FAIL
data-slot-error   null（之前是 "settings.section"）
```

截图对比（同一分区）：

| | textLen | 截图 |
| --- | --- | --- |
| 修前 | 188 | 右侧全空，只有「打开配置文件」 |
| 修后 | 749 | 完整渲染 |

修后卡片：版本徽章 `DSH-better-sidebar v0.15.2`；常规分组（新会话默认打开 /
默认宽度占比 35% / 聊天区文件在侧边栏打开 / 位置兼容模式）；侧边栏内容 7 项
（源代码管理 / 任务管理 / 侧边对话 beta / 终端 / 浏览器 / 文件 …）各带开关。

### 三轮走弯路的原因（值得记）

**正确的第一条命令应该是「展开容器看结构」** —— 一行 `outerHTML` 就能看到
`data-slot-error`，抵得上三轮探测。

而猜 DOM 选择器的问题在于：**猜错了不报错，只会给出看起来合理但矛盾的读数**。
我把那些矛盾读数解释成「产品不稳定」，而不是「工具不可靠」，于是越查越偏。

## 第三十一轮：从「撞见一个修一个」改成「主动全局扫描」

### 为什么要扫

前几轮修同类图标缺陷都是偶然撞见的：session-manager、prompt-optimizer、
better-sidebar 的 client.js。这轮把「扫描」当工具用而不是等它再次发生。

扫描方法：把 profile 里全部 **5077 个 js 文件**里引用
`_deepseek_ai_dsh_client_ui_primitives.X` 的符号抽出来，逐个对内核导出表验证。

### 扫出 4 个遗漏文件

| 文件 | 缺失符号数 |
| --- | --- |
| `dsh-better-sidebar/lib/client-registry.js` | 24 |
| `dsh-better-sidebar/lib/client-editor.js` | 1 |
| `dsh-better-sidebar/lib/client-mermaid.js` | 1 |
| `@nanmicoder/dsh-agent-teams/lib/client.js` | 3 |

前三个是**懒加载分片** —— 只在用户打开编辑器 / mermaid 视图时才加载。
这正是它们一直没被发现的原因：启动验收看不到，平时也不打开那个视图。
一旦打开就是 React #130，整个视图渲染成空 div。

### 改法

同一映射规则（16 → Medium，14 → Regular），批量替换 **61 处**。
生成脚本三条约束：先在已补丁态叠加（避免覆盖既有修复）、只改「内核不存在但
有对应变体」的符号、生成后逐个校验导出表否则 throw。

### 验证

```
补丁重放      ALL CLEAN（better-sidebar 6 文件 / agent-teams 2 文件）
重打包        两个包 OK，bootstrap 自动同步
产物断言（逐文件 tar 解包）
  client-editor.js    1,663,343 B  旧名 0
  client-mermaid.js   6,990,860 B  旧名 0
  client-registry.js    638,124 B  旧名 0
  agent-teams/client.js 115,007 B  旧名 0
全量 suite     98/98
实机验收       28 PASS / 0 FAIL
全局符号审计   5077 文件 → 缺失符号引用 0
```

### 诚实标注：懒加载探针覆盖有限

探针脚本尝试点右侧侧边栏各 tab 触发懒加载，但那次右侧只有「工作区内修改 /
模式 / 收起」三个可点元素 —— 编辑器/文件视图没有真正打开。所以
「探针 0 错误」**不能证明分片运行时不崩**。

硬的证据是**产物内容断言**：三个分片在 tgz 里旧图标名残留为 0。这排除了
「本来就是坏的」这一半；剩下「运行时是否还有别的崩溃原因」未验证，
需要手工打开编辑器视图确认。

### 这一轮的方法论收获

同类缺陷在语义上是**可判定**的：引用内核导出表里不存在的符号就是错的。
不必等它真的崩一次才发现。把「扫描」变成工具后，一次找全了 4 个，
而此前三轮各发现 1 个。

## 第三十二轮：门禁补上客户端检查 —— 把「修好」变成「不会再犯」

### 门禁此前有个错误的假设

`kernel-compat.mjs` 原来**整体跳过 240 个客户端 bundle**，理由是
「不经 Node ESM 链接期」。这个理由只对「具名导入缺失 → link-time SyntaxError」
成立，对客户端不成立：

客户端 bundle 常写 `_deepseek_ai_dsh_client_ui_primitives.IconX16`。符号不存在时
不抛 SyntaxError，而是拿到 `undefined`，随后 `jsx(undefined)` 触发 **React #130**，
整个 slot 渲染成空 div —— **没有任何报错文案**。

实测代价：better-sidebar / session-manager / prompt-optimizer 三个插件都因此
静默缺 UI，其中 better-sidebar 的设置卡**修了三轮**才定位到（前两轮都在猜 DOM）。

### 改法

`scanPluginImports` 现在扫两类引用：

| 类别 | 形态 | 缺失后果 |
| --- | --- | --- |
| 服务端具名导入 | `import { A } from '@deepseek-ai/x'` | link-time SyntaxError |
| 客户端成员访问 | `_deepseek_ai_dsh_client_ui_primitives.A` / `<alias>.A` | 运行时 undefined → React #130 |

别名**从同一文件的 import/require 语句动态提取**，不用硬编码猜测
（`primitives.` / `prims.` 这类既漏又误报）。

### 门禁立刻抓到一个真实缺陷

扩展后第一次跑就红了：

```
✗ 命中 3 处：@ha-na-bi/dsh-client-ui-custom@0.1.0-rc.6 lib/client.js
    IconChevronDownOutline14 / IconCheckOutline16 / IconCopyOutline16
```

处置：**豁免而非修**，理由写进 allowlist 注释 ——
1. 该包 `compat: "eac-fork"` + `defaultEnabled: false`，运行时被
   `stripIncompatibleProfileBundles()` 剥离、永不激活（实测注入后会被剥回）；
2. 源码不在任何 cache，只能从 tgz 反向修补 = fork 上游实现，违反红线；
3. 它依赖 EAC 分叉内核专有服务，图标只是冰山一角。

### 反向验证：门禁真的会红

往 better-sidebar 产物追加一行 `_deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16`，
重打 tgz 后跑门禁：

```
✗ 命中 1 处不兼容 … IconWarningOutline16 → 内核不导出
exit=1
```

恢复后重回 `✓ 通过`。**证明这条检查不是摆设。**

### 验证

```
verify:kernel         ✓ 通过（客户端 240 文件纳入检查，豁免 3 处）
反向注入验证          exit=1，精确报出符号名
kernel-compat.test    16/16
全量 suite            98/98
补丁重放              ALL CLEAN
实机                  28 PASS / 0 FAIL
```

### 这一轮的意义

前几轮是「发现并修好」；这一轮是把「修好」升级成「**不会再犯**」。
同类缺陷（旧图标名）在语义上可判定，那就应该在门禁里拦下，而不是依赖
下一个人的运气或耐心。

## 第三十三轮：把分散的检查固化成一次「五维总检」

### 背景

三十多轮下来，验收检查散落在十几个脚本里，每个对应一次踩过的坑。这轮把它们
收拢成一个可重复执行的入口：`tools/verify-all.mjs`。

### 五个维度（每个都对应一次真实踩坑）

| 维度 | 检查内容 | 对应哪次踩坑 |
| --- | --- | --- |
| 插件激活 | manifest 里每个补丁包在实机的 `fiberPhase` | agent-teams 曾 failed 但不阻塞应用 |
| 设置面 | 每个补丁插件的命名空间 + 可渲染字段数 | compact / better-sidebar 曾经有卡无字段或干脆没卡 |
| 图标面 | 客户端/服务端引用 primitives 的符号是否都在导出表 | 三个插件都因此静默缺 UI |
| 补丁字节 | profile 装的文件 vs manifest 的 `outputSha256` | 多次「补丁没生效」都靠这条发现 |
| 启动审计 | 最近一次 boot 有无 `did not activate` | 曾因一条失败整机拒绝渲染 |

### 一次运行的结果

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无

合计：5 PASS / 0 FAIL
```

### 反向验证：总检真的会红

改坏 `dsh-session-manager/lib/client.js` 的首字节：

```
**FAIL**  补丁文件字节闭合 — dsh-session-manager/lib/client.js: drift
合计：4 PASS / 1 FAIL
```

恢复后回到 `5 PASS / 0 FAIL`。**证明不是摆设。**

### 顺带确认的运行时事实

`pluginInventory/list` 共 256 个条目：**216 active / 40 null**。
逐条核对那 40 个，**全部 `enabled=false`**（未启用的可选工具与皮肤），
不是失败 —— 之前只盯「失败的 1 个」，没看过这个分布。

### 顺带清理

`tools/` 里累积了 80 多个脚本，其中 6 个是这几轮失败方向的探测脚本
（`probe-fiber` / `probe-tab-text` / `probe-only-filter` 等）。它们已被证明不可靠，
留着会误导后来者，删除。

保留 `probe-slot-error.mjs` —— 它是唯一能抓到 `data-slot-error` 的工具，
正是靠它才定位到 better-sidebar 空白的根因。

## 第三十四轮：清空 dist 全量重建，验证 25 个补丁文件逐字节可复现

### 做了什么

把 `dist/` 整个清空跑全量 `repack.mjs`。这是 plan v4 明确要求的动作，而最近几轮
新增了 4 个补丁文件（agent-teams client + better-sidebar 的 3 个懒加载分片），
必须确认它们能从源码重建。

```
清空 dist → 0 tgz
全量重建  → exit 0，2.7 分钟，72 个 tgz
补丁字节  → 25/25 吻合，0 问题
```

### 顺带查清一个「看起来像 bug」的现象

重建后 `bootstrap.json` 有 2 条变更（balance 5345→5281B、settings-groups
5895→5887B），git 上看着像异常。逐层核对：

1. 两个包**都只有 `lib/client.js` 一个补丁文件**，产物内该文件哈希与 manifest
   `outputSha256` **完全一致**（`583bef8cf85c` / `9f949075503f`）；
2. 再打一次同一个包，tgz sha 稳定不变（`82cd2e34590e`）—— 打包本身是确定的；
3. 全量比对 bootstrap vs dist：**18 处 drift，其中补丁包 0 处**，全在非补丁包上。

结论：非补丁包的 tgz 字节在本地重建时会变（上游 pinned ref + 打包元数据），
bootstrap 作为发布面清单不跟着变；**补丁包必须逐字节稳定，实测 0 drift**。
设计预期，不是缺陷。

这条认知已写进 `verify-all.mjs` 作为第六个维度：
**只断言补丁包的 bootstrap 一致性，非补丁包不管**。

### 六维总检

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包

合计：6 PASS / 0 FAIL
```

### 验证汇总

```
全量 suite      98/98
kernel 门禁     ✓ 通过
补丁重放        ALL CLEAN
```

## 第三十五轮：清空重建会丢 16 个包的 dsh.bundle —— 上一轮我只验了一半

### 上一轮的盲区

上一轮做了「清空 dist 全量重建」，我当时验到「25 个补丁文件字节吻合」就收了。
这轮把重建产物装回实例，启动日志出现：

```
dsh: skipping profile bundle "@deepseek-ai/dsh-balance":
  Error: profile bundle ... declares no dsh.bundle in its package.json
... conversation-tweaks / openclaw-bridge / prompt-custom / settings-groups 同样
dsh: warning: 1 entry did not activate
```

### 逐层查明

1. seed 的 `dsh.profile.bundles` 有 **62 个包**，内核按 bundle 行加载时要求每个包
   自带 `dsh.bundle` 声明；
2. repack 产物里 **16 个包没有**这个声明；
3. 于是被**静默跳过** —— 设置面、功能全没了，而启动审计只给一行
   `1 entry did not activate`，极难归因。

修复办法本来就有：`ensure-bundles.mjs` 会补 `dsh.bundle.patch` 并重打 tgz
（实测补了 **23 个包**）。但它只能手工跑，属于「只有本机作者知道的一步」。

### 改法：接进 repack 收尾

顺序在 `sync-bootstrap` **之前** —— 前者改 tgz 字节，后者才能把新 hash 写进去。
`--only` 模式跳过（dist 不完整无法判定），失败不判定整轮失败但 `WARN`。

### 端到端验证

```
清空 dist → 全量重建
[repack] 已补齐 dsh.bundle 声明（ensure-bundles）
[repack] 同步 bootstrap.json：5 条
[repack] 完成：dist/ 共 72 个 tgz
exit=0，3.6 分钟

重建后核查 seed 62 个 bundle → 缺 dsh.bundle: 0
全量 suite        98/98
kernel 门禁        ✓
实机启动          零跳过、零激活失败
六维总检          6 PASS / 0 FAIL
```

### 这轮我自己踩的两个坑

1. **装回产物时用 `cpSync` 覆盖整个包目录**，把 pnpm 写进 package.json 的
   `dsh.bundle` 也覆盖掉了，造成同一批包再次被跳过。正确做法：从 dist 的 tgz
   解包（里面已含 ensure-bundles 补写的声明）。
2. **`pnpm install` 会把 `dsh-our-free-model` 移除**（它不在 profile 的
   dependencies 里），需要从 dist 单独装回。

### 教训

「字节吻合」只证明**补丁被正确应用**，不证明**产物能被内核加载**。
这两件事之间还有 bundle 声明这一步 —— 上一轮我只验了前者。

## 第三十六轮：把「字节吻合 ≠ 能被加载」这条教训变成守卫

### 上一轮的盲区

上一轮清空 dist 重建后，我验了「25 个补丁文件字节吻合」就收工了。但装回实例后
启动日志出现 16 个 `skipping profile bundle ... declares no dsh.bundle`。

**「补丁字节闭合」与「产物能被内核加载」是两个不同的断言**：

| 断言 | 验什么 | 挡不住什么 |
| --- | --- | --- |
| 补丁字节闭合 | 补丁文件内容 == manifest 的 `outputSha256` | `package.json` 里 `dsh.bundle` 是否在 |
| 产物可加载性 | seed bundles 里每个包都自带 `dsh.bundle` | — |

`dsh.bundle` 由 `ensure-bundles.mjs` 事后补写并重打 tgz，所以前一条永远全绿、
后一条可能全红。

### 新增 `suite/test/artifact-loadable.test.mjs`

判据：seed 的 `dsh.profile.bundles` 里每个包，若存在于 dist，则其 tgz 内的
`package.json` 必须含 `dsh.bundle`。

不在 dist 的包不算失败 —— `@deepseek-ai/dsh-base` / `dsh-web-app` /
`eac-plugin-suite` 由内核或桌面壳提供。

fail-open：dist 或 seed 不存在时 skip，与其它守卫口径一致。

### 反向验证：真的会红

临时从 `@deepseek-ai/dsh-balance` 的 tgz 删掉 `dsh.bundle`，重打后跑测试：

```
ℹ pass 0 / fail 1
缺失：
  @deepseek-ai/dsh-balance
```

恢复后回到 `pass 1 / fail 0`。**证明守卫不是摆设。**

### 验证

```
artifact-loadable.test   1/1（62 个 seed bundle，59 个 dist 覆盖，全自带 dsh.bundle）
全量 suite               99/99（原 98 + 新增 1）
kernel 门禁              ✓
实机六维                 6 PASS / 0 FAIL
```

## 第三十七轮：补上功能面验收 —— 从「插件活着」到「功能真的通」

### 为什么要补这一维

`fiberPhase=active` 只证明插件 activate 了。前面几轮已经两次踩过「插件 active
但功能面缺失」的坑（设置卡空白、图标 undefined 导致整块 UI 消失）。

这轮补上第四类证据：**host 侧端点真的可达**。

### 第一版我猜错了全部 3 个路径

按「看起来合理」的路径去探测，结果 3 个 404：

```
/prompt-optimizer/api/config    ← 该插件是 kind:"exact"，只注册 ROUTE_PATH 本身
POST /session-manager/api       ← 该插件只有 /delete 与 /unarchive
/theme-endfield/audio/health    ← prefix 路由，但真实子路径是 /audio/state
```

**三个失败全是我路径猜错，不是缺陷。**

### 改法：路径与方法一律从源码抽，不猜

`tools/verify-endpoints.mjs` 现在：

- `kind: "exact"` → 只打注册路径本身；
- `kind: "prefix"` → 从 handler 里的
  `req.method === "POST" && path/pathname === "/x"` 反推子路径与方法；
- 常量路径（`ROUTE_PATH` / `SIDEBAR_API_PREFIX` / `API_PREFIX`）从 `const X = "..."` 抽。

改完再跑：

```
PASS  better-sidebar   POST /sidebar/api/settings.get        → 200 {"ok":true,...}
PASS  openclaw-bridge  GET  /openclaw-bridge/health          → 200 {"ok":true,"version":"0.7.0",...}
PASS  prompt-optimizer POST /api/dsh-webui-prompt-optimizer   → 400 {"error":"provider / model / text 不能为空"}
PASS  picturereader    GET  /picturereader/models             → 200 [{"provider":"deepseek-official",...}]
PASS  session-manager  POST /session-manager/api/delete       → 400 {"error":"sessionId 必填"}
PASS  session-manager  POST /session-manager/api/unarchive    → 400 {"error":"sessionId 必填"}
PASS  theme-endfield   GET  /theme-endfield/audio/state       → 200 {"enabled":false,"volume":100,...}

合计：7 PASS / 0 FAIL
```

注意那两个 400：它们返回的是**「参数必填」**，恰好证明路由真实存在、只是我故意没传参。
这比 200 更能说明路由是活的（200 也可能来自兜底 handler）。

### 七维总检

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包
PASS  补丁插件功能端点可达 — 7 PASS / 0 FAIL

合计：7 PASS / 0 FAIL
```

### 教训（与第三十轮同型）

**又是「猜选择器/猜路径」出的错。** 上上次猜 DOM 选择器失败三次，这次猜 URL 路径
失败三个。两次的共同点：猜错了不报错，只会给出一个看起来像「产品坏了」的结果。

正确做法一致：**从权威来源读**（DOM 就读 fiber/outerHTML，路由就读源码里的注册语句）。

## 第三十八轮：全新实例端到端验收 —— 从零构建，七维全绿

### 为什么再验一次

前面三十多轮都在既有实例（`fresh21`）上验证。这轮从**零**走一遍完整路径，
确认交付物不是「这台机器上碰巧还能用」：

```
1. build-variant.mjs final        装配 + 编译壳，exit 0，commit 7b86909f
2. launch --variant final         全新数据根，profile 只有 2 个基座 bundle
3. 初始七维总检                    3 PASS / 4 FAIL（11 个补丁包"未安装"）
4. 装 11 个补丁包 + pnpm install   11/11 安装成功
5. 再跑七维总检                    7 PASS / 0 FAIL
6. 截图                           渲染正常，侧栏底部有「会话管理」（session-manager 生效）
```

**第 3 步的 4 个 FAIL 是正确行为**：全新实例本来就没有这些包，
验收脚本如实报「未安装」而不是「坏了」——这正是它应该做的区分。

### 全新实例的结果

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包
PASS  补丁插件功能端点可达 — 5 PASS / 0 FAIL

合计：7 PASS / 0 FAIL
```

功能端点只测到 5 个（少 `picturereader` 与 `theme-endfield`）—— 那两个插件不在
这个 lite 基础配置里，属正常差异；`fresh21` 上仍是 7 PASS。

### 顺带修掉我自己的判定 bug

集成 `verify-endpoints` 到总检时，我用**子进程退出码**判定成败。但该脚本在输出后
会因 Node 的 uv 句柄断言以 `exit 1` 结束，于是出现「输出写着 5 PASS / 0 FAIL、
总检却判 FAIL」的矛盾。

改为**只解析输出里的统计行，不看退出码**。这类「用错的信号源判定」与前面几轮
（`execFileSync` 拿 stdout、猜 DOM 选择器、猜 URL 路径）是同一类错误。

## 第三十九轮：退役 dsh-dafeiyu（用户指出口）

### 用户指出

> 「这个应该是 dfy 插件吧、我记得好像让他退役了」

截图里那个 Q 版女仆桌宠，查证是 `dsh-dafeiyu`（大肥鱼桌面伴侣）。

### 查证：一个三方矛盾状态

| 来源 | 值 |
| --- | --- |
| 分发表 `.sync/plugin-distribution.json` | `distributionClass: external` / `delivery: market` |
| Pack `catalog/eac.json` | `defaultEnabled: true` |
| 实际 | seed bundles 里有、dist 产物有、实机 `fiberPhase=active` |

关键佐证：`dsh-desktop/assets/plugins/dsh-dafeiyu` **不存在** —— 它不随桌面壳分发，
只经 Pack 分发。所以分发表的 `external/market` 是事实，catalog 的
`defaultEnabled: true` 是没跟着改的陈旧值。

### 影响面调查（比预想严重，需先确认再动手）

分发表里 **20 个 `external/market` 包中有 16 个仍留在 seed bundles**，其中 5 个
正是已打补丁的包：`computer-user` / `openclaw-bridge` / `settings-groups` /
`agent-teams` / `webui-prompt-optimizer`。

若按「external 一律退役」执行，这 5 个会连同修复一起消失。经用户裁决：
**只处置 `dafeiyu`**，其余记入遗留。

### 改法

1. 两份 catalog 的 `dafeiyu.defaultEnabled`: `true` → `false`；
2. `seed-bundles.mjs` 新增 `RETIRED_SEED_BUNDLES` 显式清单（不按类清退，
   避免误伤带补丁的包）。

### 加完退役清单它没生效 —— 第三次同类问题

重生成 seed 后 `dafeiyu` **仍在 bundles 里**。原因是生成端调用：

```js
if (!shouldSeedBundle({ status }, cat)) continue;   // ← 没传 name
```

退役清单按 `entry.name` 查，传 `{status}` 进去永远命中不了 —— **规则静默失效**。

改为 `shouldSeedBundle({ status, name: e.name }, cat)` 后生效。

并加回归测试明确这个调用契约：「没传 name → 退役规则不生效」也写成断言，
避免下次再踩。

### 验证

```
computeSeedBundles 重算：bundles 62 -> 61，含 dafeiyu: false
  computer-user / openclaw-bridge / settings-groups / agent-teams /
  webui-prompt-optimizer               全部仍在 ✓
重生成 seed：61 条，含 dafeiyu: false
实机 profile：60 条（移除后），node_modules 与 dependencies 均已清
pluginInventory：条目 256 -> 255，dafeiyu 已移除
补丁插件 active：11/11
全量 suite    100/100
七维总检      7 PASS / 0 FAIL
```

### 第三次「加了规则但没生效」

| # | 情形 | 错在哪 |
| --- | --- | --- |
| 1 | `execFileSync` 拿 stdout，Skipped 在 stderr | 信号源错 |
| 2 | `git apply` 不带 `-v` 连信号都没有 | 无信号源 |
| 3 | 调用方漏传 `name`，退役规则查不到键 | 接口契约未验证 |

共同点：**新加的判定逻辑与既有调用方之间的接口没被验证**。
所以规则加上后，必须用「规则应该生效的那个输入」真跑一遍看结果。

### 遗留（需后续裁决）

其余 15 个 `external/market` 包仍留在 seed bundles，与分发表口径不符。
它们是否也该退役需逐个判断（其中 5 个带补丁，不能简单清退）。

## 第四十轮：上一轮遗留的那 15 个包，查清了 —— 不该退役

### 查证结论

上一轮退役 dafeiyu 时发现 20 个 `external/market` 包里有 16 个仍在 seed bundles。
这轮逐个查证，结论是**它们不该退役**，性质与 dafeiyu 不同。

| | dsh-dafeiyu | 其余 15 个 |
| --- | --- | --- |
| 桌面壳内置资产 | 无 | 无 |
| **dist 产物** | **有** | **有** |
| 用户记忆 | 「已退役」 | 无 |
| 结论 | 按退役处置（已做） | **不退役**，只是标注不准 |

`external` 20 个里 **17 个在 dist 产物中**（确实随 Pack 分发），只有
`dsh-stt` / `dsh-undo` / `plugin-wizard` 是真正的纯市场包 —— 它们不在 catalog、
不在 seed、不在 dist，**状态完全正确**。

### 为什么标注不准不影响功能

`distributionClass` 经 `PLUGIN_DISTRIBUTION_CLASSES`
（`plugin-sync-registry.ts:259` → `plugin-ops.ts:179` / `companion-sync.ts:1238`）
**只用于行/UI 的分级标签展示**，不参与「是否安装」「是否进启动清单」的判定 ——
后两者分别由 dist 与 `seed-bundles.mjs` 决定。

后果是「插件市场页把已随包安装的包显示成市场按需」，功能本身不受影响。

### 产出

1. `lite/DECISION-distribution-class-20261021.md` —— 三种可选口径：
   A 修正标注为 `recommended/pack`（推荐）、B 承认「随包先装、后续可市场更新」
   并补文档与 UI 区分、C 真迁到市场（**不建议**，会让 5 个补丁失去作用对象）；
2. `distribution-boundary.test.mjs` 追加**信息性**用例，把「标 external 但有 dist
   产物」的集合打印出来（17 个）。不判失败 —— 它记录差异、让漂移可见，
   但不替维护者做决定。

### 验证

```
distribution-boundary   5/5（输出 17 个待裁决包名）
全量 suite              101/101
kernel 门禁             ✓
实机七维                7 PASS / 0 FAIL
dafeiyu 仍已退役        profile 不含它
```

## 第四十一轮：把「规则静默失效」的防法下沉到规则自己身上

### 第三次同类问题后，改了防法

前三轮出现三次「规则写了但没生效」：

| # | 情形 | 错在哪 | 上一轮的防法 |
| --- | --- | --- | --- |
| 1 | `execFileSync` 拿 stdout，Skipped 在 stderr | 信号源错 | 先证明信号源存在 |
| 2 | `git apply` 不带 `-v` 连信号都没有 | 无信号源 | 同上 |
| 3 | 调用方漏传 `name`，退役清单查不到键 | 接口契约未验证 | 只加了一条测试**记录**该行为 |

第 3 次的防法不够：把「没传 name → 退役不生效」写成断言，只是记录了已知问题，
没有阻止下一个人再犯。

### 这轮：契约检查下沉到规则入口

```js
if (typeof entry.name !== 'string' || entry.name === '') {
  throw new Error('shouldSeedBundle: entry.name 是必需字段（退役清单按 name 判定）。...')
}
```

缺输入就 throw，而不是让一条安全规则悄悄变成 no-op。

**这是两次防法的区别**：
- 前两次是「验证外部环境有信号」；
- 这次是「不依赖调用方自觉」—— 把契约检查放进规则自己身上。

### 同步更新

`seed-bundles.test.mjs` 里 8 处只传 `{ status }` 的调用补上 `name`；
「没传 name → 退役不生效」那条断言改为：

```js
assert.throws(() => shouldSeedBundle({ status: 'preinstalled' }, {}), /entry\.name 是必需字段/);
```

### 验证

```
seed-bundles.test   7/7
全量 suite          101/101
生成端重跑          bundles 61，含 dafeiyu: false（正常）
kernel 门禁         ✓
补丁重放            ALL CLEAN
实机七维            7 PASS / 0 FAIL
```

## 第四十二轮：目标逐项核对（收尾审计）

### 核对结果

| 目标项 | 证据 | 状态 |
| --- | --- | --- |
| 阶段0① source-patches 创件 diff | 4 个 create 条目在用，有单测 | 达成 |
| 阶段0② client-ui-custom 裁决 | `compat: eac-fork` / `defaultEnabled: false`，运行时自动剥离 | 达成 |
| 阶段0③ better-sidebar 方案 | 6 个补丁文件（index / client / shim / editor / mermaid / registry） | 达成 |
| 阶段1 清 dist 全量重建 | 从空目录 → 72 tgz，exit 0 | 达成 |
| 阶段1 4 个 PR 合入 main | **未达成** —— 合并权限 404，需人工批准 | 阻塞 |
| 阶段2 插件补丁 + verify:kernel | 11 个补丁，门禁 0 命中 | 达成 |
| 阶段3 GLM-5.3-Flash review | **未达成** —— 唯一 GLM 路由失效（8 provider 里只有 zcode 有 GLM） | 阻塞 |
| 阶段4 重建 + 截图逐项测试 | 全量重建 exit 0；七维总检 7 PASS；27 个设置分区可点 | 达成 |
| 阶段5 修复 → commit → 重测 | 30+ 次提交，每次修完都重测 | 达成 |

### 另一佐证：全新实例复现

用 `final` 变体（从源码全新构建、独立数据根）重跑七维总检：

```
PASS  补丁插件全部 active — 11/11
PASS  设置面命名空间齐全且有字段 — 6 个
PASS  补丁包无缺失 primitives 符号 — 282 个导出符号全覆盖
PASS  补丁文件字节闭合 — 25 个文件
PASS  最近一次启动无激活失败 — 无
PASS  bootstrap 与 dist 的补丁包条目一致 — 11 个补丁包
PASS  补丁插件功能端点可达 — 5 PASS / 0 FAIL

合计：7 PASS / 0 FAIL
```

截图：全新实例渲染完整，左侧栏底部有「会话管理」（session-manager 补丁生效），
**无 dafeiyu 桌宠**（已退役）。

### 最终指标

```
EAC-Pack  354ccb5  干净  101/101 测试  gate 0 命中  replay ALL CLEAN
                 11 个补丁  72 个产物  符号审计 0 缺失
EAC-Desktop 7b86909f  干净  tsc exit 0
实机（两个实例）    7 PASS / 0 FAIL
```

### 三项阻塞（均非技术问题）

1. **合并两个 PR** —— `merge` API 返回 404（无 push 权限），仓库规则要求
   「必须由推代码者以外的人批准」。`#14` 46 文件 / 5745 增 / 229 删，
   `#488` mergeable=true。
2. **GLM-5.3-Flash review** —— 8 个 provider 中只有 `zcode` 提供 GLM，
   而该路由失效（15+ 次尝试全失败）。其余 7 个只有 DeepSeek 系列。
3. **两项待裁决** —— 分发表标注口径（[备忘](DECISION-distribution-class-20261021.md)）、
   builtin 版本双轨 4 条。

## 第四十三轮：纠正一个我自己的错误判定 —— GLM 不是「路由失效」，是「账号限流」

### 我之前错在哪

前面若干轮，我一直把「GLM-5.3-Flash 子智能体全部失败」判定成：

> 8 个 provider 里只有 `zcode` 宣称支持 GLM，而该路由**失效**（15+ 次尝试全失败），
> 其余 7 个只有 DeepSeek 系列 → **GLM review 真做不了**

我据此写进了验收报告的「阻塞项」。**这个结论是错的。**

### 真实原因

正确信息就明明白白在 `~/.dsh/jet-hub/state.json` 里：

```json
{"id":"zcode-04727cce","provider":"zcode","nickname":"ZCode baikai","enabled":true,
 "credentialRef":"ZCODE_ACCOUNT_11B84272",
 "modelRateLimits":{"GLM-5.3-Flash":1792598400000}}
```

`1792598400000` = **2026-10-22 00:00 +08:00** —— 这是**限流解除时间**，不是路由故障。

账号当天额度用完了。工具 `list_subagent_models` 依然正常返回
`zcode/GLM-5.3-Flash —— GLM-5.3-Flash`，因为那个接口只读路由表，不读额度。

### 新增工具 `tools/check-provider-limits.mjs`

读 `jet-hub/state.json` 的 `modelRateLimits`，输出全 provider 的限流状态：

```
**限流**  buddy        deepseek-v4.1-flash   解除剩余 2h38m
**限流**  workbuddy    deepseek-v4.1-flash   解除剩余 57m
**限流**  zcode        GLM-5.3-Flash         解除剩余 9h28m
可用      codearts/lobsterai/raccoon/...  （13 个）

合计：14 可用 / 3 限流
```

`modelRateLimits[model]` 的语义是「限流解除时间戳（毫秒）」，大于当前时间即此刻不可用；
没有该字段 = 无限流记录。

### 这条错误的性质

和本仓反复出现的其它错误**是同一类**：

| 轮次 | 错误 | 正确做法 |
| --- | --- | --- |
| 30 | 猜 DOM 选择器 → 三次失败 | 展开 outerHTML 看 `data-slot-error` |
| 37 | 猜 URL 路径 → 三个 404 | 读源码里的路由注册 |
| 38 | 用子进程退出码判定 | 解析输出里的统计行 |
| **43** | **「拿不到结果」→「那条路不通」** | **查那条路自己的状态信号** |

共同点：**把「我这边没成功」直接当成「对方不可用」**，跳过了查证。

### 对目标状态的影响

「阶段3 GLM-5.3-Flash review」的阻塞性质**改变了**：

- 原判：路由失效，**永久不可用** → 目标无法完成
- 实际：账号限流至 **2026-10-22 00:00**（还剩 9h28m）→ **到点即可执行**

所以这一项不是「做不到」，而是「此刻排不上队」。目标仍是 active，
但阻塞原因从「能力缺失」降级为「时间窗未到」。

## 第四十四轮：GLM review 的第三层原因 —— allowedModels 是 session 创建时冻结的

### 用户给了关键线索

截图显示 **TRAE（字节）下也有 `glm-5.3-flash`**。我上一轮只查了 zcode，
漏掉了这条路由 —— 而 `list_subagent_models(trae)` 只列
`deepseek-v4.1-flash`，**目录里看不到 GLM**，所以之前没发现。

这正是工具说明里那句「catalog membership is advisory: an adapter may accept an
unlisted model id」的实例。

### 逐层查证

**第一层：路由存在，但被 session 拒绝**

```
trae/glm-5.3-flash   → child LLM route "trae/glm-5.3-flash" is not allowed for this Session
trae/kimi-k3         → 同样 not allowed
trae/deepseek-v4.1-flash → 通过（探测成功）
zcode/GLM-5.3-Flash  → 通过白名单，但账号限流
```

**第二层：白名单在哪**

`~/.dsh/profiles/desktop/cordis.yml`：

```yaml
- id: subagent-model-selection-settings
  config:
    enabled: true
    allowedModels:
      - provider: raccoon
        model: sn-deepseek-v4-1-flash
      - provider: zcode
        model: GLM-5.3-Flash
      - provider: trae
        model: glm-5.3-flash        ← 在白名单里！
      - provider: trae
        model: deepseek-v4.1-flash
      - provider: trae
        model: kimi-k3              ← 也在白名单里
```

**第三层：为什么白名单里有却被拒**

时间线对不上：

| 项 | 时间 |
| --- | --- |
| 当前 session 创建 | **10/16 23:24** |
| `cordis.yml` 修改（新白名单落盘） | **10/21 02:24** |

session 创建比配置修改**早 5 天**。DSH 源码里这个策略的注释写得很清楚：

```
/** Enforce a settings-owned route list at the operation that creates the child.
 *  Pure inheritance remains outside this policy ...
 *  @param policy - Selection authority **captured for this Session**. */
```

`allowedModels` 通过 session event `subagent/model-selection-policy` 注入，
在 **session 创建时冻结**，之后配置文件怎么改都不影响当前 session。

还有一层：GUI 进程启动于 **10/18 20:32**，也在配置修改之前。

### 所以这是第三层原因

| 层 | 现象 | 真实原因 |
| --- | --- | --- |
| 1 | zcode/GLM 全失败 | **账号限流**（到 10-22 00:00）—— 上一轮查清 |
| 2 | trae/GLM 被拒 | 不在**旧**白名单 |
| 3 | 白名单里有却仍被拒 | **session 创建时冻结**，不热更新 |

三层叠在一起，任何一层单独看都会得出「GLM 不可用」的错误结论。

### 解法

`allowedModels` 要生效必须**新开 session**（当前 session 冻结于 10/16）。
这属于操作层面的动作，我不应擅自重启用户的 GUI 主进程 —— 那会中断当前对话。

### 又一条同类教训

这轮的错误与前面几次同型，但换了个方向：

| 轮次 | 我做了什么 | 应该做什么 |
| --- | --- | --- |
| 30 | 猜 DOM 选择器 | 看实际 DOM 结构 |
| 37 | 猜 URL 路径 | 读源码路由注册 |
| 43 | 「拿不到结果」= 路不通 | 查对方状态（限流） |
| **44** | **只查了一个 provider** | **把线索（截图）当提示去穷尽** |

第 44 轮的特殊性：**用户已经把答案截图给我了，我却在另一条路上继续查**。
上一轮我查了 zcode 的限流就下结论「GLM 真做不了」，没注意到 trae 也提供。

## 门槛状态

```
EAC-Pack   source-patches.test.mjs     9/9
           package-files.test.mjs       7/7（第五轮新增）
           全量 suite                  87/87（原 80 + 新增 7）
           kernel-compat               0 命中（原 10 命中 / 58 处具名导入 → 7 处）
           补丁重放 + node --check      ALL CLEAN（9 个补丁包）
           全量重建（空 dist）          exit 0，72 tgz，补丁字节闭合 9/9 DRIFT 0
EAC-Desktop tsc -p tsconfig.json        exit 0（两个基线都验证）
           全量桌面套件                 691 pass / 3 fail / 44 skip
             3 个失败全在 update-portable.test.ts，已用基线 9c350f42 复现同样失败
```

### 第五轮补的测试（`ensurePatchedFiles`）

它是「补丁新建的文件能否活到 tgz 里」的唯一保障，防的正是 `npm pack` 静默丢
文件这类**打包全绿、运行期才炸**的缺陷 —— 但此前零测试覆盖，且没法测：它写在
顶层即执行的 `repack.mjs` 里（一 import 就跑完整条 300 MB 管线）。

抽成 `scripts/repack/package-files.mjs`（行为不变，实测 `--only better-sidebar`
仍输出 `files+= lib/settings-compat.js`），补 7 个用例：精确路径 / 目录前缀 /
glob 前缀三种判断，外加两个反例 —— `lib/index.js` 不覆盖 `lib/index.js.map`，
`lib/` 不吞 `library/x.js`。

## 最后一个启动失败：`agent-teams`

`ctx.subagents.registerContinuableSetup is not a function`。内核 `SubagentRuntime`
公开方法里没有它，改成了 provider 模式（`registerProvider` + `observeActivation`）。
这是 API 重构，不是改名；迁过去要重写子代理创建/冷恢复/durable record 三处语义，
补丁无法安全完成。

已写裁决备忘 `lite/DECISION-agent-teams-20261021.md`，给出 A（等上游，推荐）/
B（标 compat 拦截）/ C（降 external）三个选项。当前失败是**降级**不致命：应用整体可用。

## 仍需你执行（治理边界，不是技术阻塞）

我对 `Ebony-Vinyl/EAC-Desktop` 有 `push: true`，对 `Ebony-Vinyl/EAC-Pack` 只有
`pull: true`。

PR #488 尝试直接合入时被仓库规则拦下：

```
gh api -X PUT repos/Ebony-Vinyl/EAC-Desktop/pulls/488/merge
→ Repository rule violations found
  New changes require approval from someone other than the last pusher.
```

**「必须由推代码者以外的人批准」** —— 我既是作者又是 pusher，所以这条路对我永久关闭。
需要你（或另一位有权限者）review 后 merge，两个 PR 都是 `mergeable=true`，无冲突。

EAC-Pack 侧我只能推到 fork 并开 PR（`push:false`），合入同样需要你操作。

## 环境副作用（可重建）

- `lite/variants/fresh21/`：本次验证实例
- `lite/variants/fullreal/`：profile 被 pnpm 重装过
- `EAC-Full-Build-20261004/prepare-composition.mjs`：改 1 处（未入库的构建工作区脚本）
- full-pack seed `package.json`：按新规则重写，原文件备份 `package.json.bak-compat`
- `EAC-Pack/.cache/`：若干一次性工具（已 gitignore）

---

## 第四十五轮：GLM 路由确认不可用；改用可用路由完成对抗审查，抓到 5 个真问题

### 45.1 前置检查结果：限流解除，但 GLM 路由本身不通

按提醒执行三步检查：

| 步骤 | 结果 |
| --- | --- |
| 1. `check-provider-limits.mjs` | zcode / GLM-5.3-Flash **已无限流记录**（`modelRateLimits` 为空） |
| 2. 试派 subagent 验证白名单 | `trae/glm-5.3-flash` → **`is not allowed for this Session`**（白名单确实冻结） |
| 3. 改用 zcode 路由 | **两次派发均静默失败、零输出、无 closing message** |

对照实验（关键）：同一时刻用 `trae/deepseek-v4.1-flash` 派发，**成功返回**。
说明 subagent 机制正常，**是 zcode/GLM-5.3-Flash 这条路由实际不可用**。

另外 `list_subagent_models(trae)` 只 advertised `deepseek-v4.1-flash`，
提醒里写的 `trae/glm-5.3-flash` 在当前注册表里根本不存在。

结论：**「限流解除」不等于「路由可用」**。第三层原因（session 冻结）确实解除了，
但暴露了第四层：该路由在本环境不可用。不再耗时重试 GLM。

### 45.2 改用可用路由做定向对抗审查

拆成两个小任务（避免上次 12.8M token 的 runaway）：

- 任务 A：审查 `source-patches.mjs`（创建模式与路径安全）
- 任务 B：审查 `package-files.mjs`（glob DP 匹配）——**该 subagent 同样静默失败**，
  由我自行逐边界实测替代

### 45.3 任务 A 的发现：5 条，全部先复现再修

#### ① 多文件补丁失败无回滚（**真漏洞，已修**）

`applySourcePatches` 直接 `writeFileSync(target, after)` 落 staging，`finally` 只删
scratchRoot。多文件补丁第 N 个失败时，前 N-1 个已永久留在 staging，且异常路径下
调用方拿不到 `applied` —— **无从知道 staging 被改了一半**。

实测复现：`staging/a.js` 在第 2 个文件失败后仍是 `PATCHED-A`。
create 场景更糟：残留文件让第二次运行报「create target already exists」，修好
diff 也无法自愈。

修法：写盘前登记目标 + 原始字节；失败按逆序回滚（不存在的删、存在的写回）。

#### ② `file.diff` 路径未校验（已修）

`file.path` 有校验、`file.diff` 漏了 —— `../../x` 可跨出 `ROOT/patches`。
补上词法校验 + resolve 前缀断言。

#### ③ `scratchFile` 无 realpath 校验（已修，纵深防御）

父目录若为符号链接可逃出 scratchRoot。scratchRoot 由 mkdtemp 新建、理论上无法
预置符号链接，属纵深防御；成本极低故加。

#### ④ 恒真断言（已修）

`assert.notEqual(ofm.config?.distribution, 'managed')` —— 上一行已断言
`!('config' in ofm)`，可选链必然 undefined，**这行永远通过**。改为对两份 catalog
都显式检查 distribution（原先 suite 那份确实漏网）。

#### ⑤ 未采纳项（记录理由）

- 「scratch 未验证在仓库外 / git apply 输出本地化」：有 `outputSha256` 兜底，
  本地化导致匹配不到时会落到 hash 校验失败（**响亮失败**），非静默通道。
- 「`outputSha256 == inputSha256` 可让 apply 静默 no-op 通过」：确为静默窗口，
  现有 manifest 无此情况；建议后续在 manifest 校验加 notEqual。
- 「modify 分支在无 dist 的干净 clone 上零覆盖」：属实（4 处 `t.skip`），
  需单独设计不依赖 dist 的夹具。

### 45.4 任务 B（我自己实测）：glob 实现安全，但**抓到第 6 个问题**

25 个边界用例实测（`**` 吃 0 段 / 单星不跨段 / 转义特殊字符 / 大小写 /
尾随斜杠 / 空输入）：**24 个符合预期**，唯一偏差是非法输入（`file="lib/"`）。

关键判定：本模块契约是「保守判断」，只有「误判已覆盖」才危险。
实测**没有任何误判已覆盖**的真风险 → glob DP 实现是安全的。

但补测试时抓到一个 review 也没提的**真缺陷**：

#### ⑥ `./` 前缀只在 glob 分支生效（**已修，先红后绿**）

```
'./lib/index.js'  vs 'lib/index.js'   → false  （精确分支失效）
'./lib/'          vs 'lib/x.js'       → false  （目录分支失效）
'./lib/**/*.js'   vs 'lib/a/x.js'     → true   （glob 分支正常）
```

归一化原先只写在 `globMatch` 里。npm 的 `files` 允许写 `./lib/`，不是假想输入。
修法：归一化提到函数入口，三条分支共用。

### 45.5 反向验证（证明测试有判别力）

对回滚修复做反向验证：临时 `git stash` 还原到修复前 → 新测试**精确失败**
（9 pass / 1 fail）；`git stash pop` 恢复 → 10/10 通过。

`./` 前缀那条也是先红后绿：加测试时实测失败，修复后通过。

### 45.6 本轮提交与数字

| 仓库 | commit | 内容 |
| --- | --- | --- |
| EAC-Pack | `8dfb983` | 多文件补丁回滚 + 路径加固 + 去恒真断言 |
| EAC-Pack | `ddf4872` | `./` 前缀修复 + glob 三个测试盲区 |

| 测试 | 结果 |
| --- | --- |
| EAC-Pack 全量 | **106/106 pass**（本轮起点 103，+3） |
| `source-patches.test.mjs` | 10/10（+1 回滚） |
| `package-files.test.mjs` | 11/11（+3） |

### 45.7 教训

「测试全绿」在本轮被两次证伪：
1. `source-patches` 的 modify 分支在干净 clone 上**一条都没执行**（4 处 `t.skip`）；
2. `package-files` 的 `./` 前缀缺陷**测试里根本没这个用例**。

**测试绿只能证明「已写的断言都过了」，不能证明「没写断言的地方是对的」。**
对抗审查 + 我自己逐边界实测，才把这两类盲区暴露出来。

---

## 四十六、npm `files` 判定被上游反噬 + modify 主路径补测（2026-10-22）

### 46.1 起因：不再靠转述，直接跑上游

上一轮遗留的「第二轮对抗审查对 `package-files.mjs` 的 V1/V2 指控」只是阅读代码得出的。
本轮改成**实测**：找到本机 npm 自带的 `minimatch@10.0.3` 与 `npm-packlist`，
在临时目录造真实文件，跑真实打包，看它到底把哪些文件收进包。

### 46.2 实测到的 npm 真实语义

| 条目 | 磁盘上有什么 | npm 实际收进包 | 我原实现判定 |
| --- | --- | --- | --- |
| `lib/[ab].js` | `lib/a.js`, `lib/[ab].js` | `lib/a.js`（**丢掉 `lib/[ab].js`**） | 已覆盖 ← **错** |
| `lib/` | `lib/[ab].js` | `lib/[ab].js` | 已覆盖 ✓ |
| `/lib/` | `lib/a.js` | `lib/a.js` | 未覆盖（漏判，方向安全） |
| `lib` | `lib/deep/x.js` | 收 | 收 ✓ |
| `lib/*.js` | `lib/top.js`, `lib/a/deep.js` | 只 `lib/top.js` | 一致 ✓ |
| `*.js` | `lib/a.js` | **不收**（无 matchBase） | 未覆盖 ✓ |
| `lib/` | `Lib/x.js` | 收（nocase） | 未覆盖（安全） |

**V1 确认是真缺陷，且方向致命**：`files:['lib/[ab].js']` 里的 `[ab]` 是字符类，
npm 收 `lib/a.js` 而**丢掉 `lib/[ab].js` 自己**。旧实现在 `e === p` 处早退成
`true` → 调用方判定「已覆盖」→ 不补白名单 → **文件无声消失**。
这正是本模块存在的意义，却在判据里反向复现了。

### 46.3 根因（读上游源码确认，非猜测）

`npm-packlist/lib/index.js` 的 `processPackage`：

```js
if (files) {
  for (let file of files) {
    if (file.startsWith('./')) file = file.slice(1);
    if (file.endsWith('/*')) file += '*';
    const stat = lstat(join(this.path, file.replace(/^!+/, '')));
    if (stat.isFile())           strict.unshift('!' + file);        // 精确文件
    else if (stat.isDirectory()) { ignores.push('!' + file); ignores.push('!' + file + '/**'); }
    else                         ignores.push('!' + file);          // 当模式用
  }
}
```

`ignore-walk` 用 `minimatch`（`matchBase:true, nocase:true, dot:true`）匹配，
且 `nameIsBadForWindows = file => /\*/.test(file)` —— 名字含 `*` 直接跳过。

### 46.4 修复

`scripts/repack/package-files.mjs`：

- 新增 `GLOB_META = /[*?[\]{}()!+@|]/` + `hasGlobMeta()` + `isLiteralEntry()`。
- 路径含元字符而条目不含 `*` → **一律判未覆盖**（安全方向）。
- 条目含元字符时不再走 `e === p` 早退，交给 glob 分支。
- **目录条目不受影响**：npm 把 `lib/` 展开成 `!lib/` + `!lib/**`，靠 `**` 收文件，
  所以 `lib/[ab].js` 能被目录条目正常收住（实测一致）。
- entries 归一化前导 `/`（`/lib/` 与 `lib/` 等价，旧实现漏判）。
- 越界路径（`..`、绝对路径、盘符）不判覆盖、不写进 `files`。
- `ensurePatchedFiles` 对含元字符的补丁路径改用**目录条目**兜住并记 `warning`
  （push 精确条目救不回来 —— npm 仍按模式解析）；`repack.mjs` 把 warning 打到日志。

### 46.5 新增差分测试（不靠我复述 npm 行为）

`suite/test/package-files-npm-parity.test.mjs`：直接 `createRequire` 加载本机
`npm-packlist`，造临时包真跑一遍，只钉**危险方向**：

> npm 没收 → 本实现不得判已覆盖

反向（npm 收了但我说未覆盖）**故意不断言** —— 那只是白名单变胖，无害；把无害偏差
钉死会让测试变成阻碍。找不到 npm-packlist 时显式 `t.skip` 并说明原因，不让绿条掩盖「没验」。

### 46.6 敏感性自检（证明测试不是空转）

```
拆掉闸门 → ✖ 本实现声称已覆盖、但 npm 实际丢弃的文件：["lib/[ab].js"]
            files=["lib/[ab].js"] 磁盘=["lib/a.js","lib/[ab].js"] 打包=["lib/a.js"]
恢复闸门 → 7/7 通过
```

### 46.7 同时修掉一条「方向安全」的错误结论

`package-files.test.mjs` 原有测试标题写「字符类与 ? 不被当作通配（**已知限制，方向安全**）」，
理由是「误判未覆盖 → 多补精确路径（无害）」。这个理由是错的，而且它把
`lib/[ab].js` vs 自身断言成 `false` 并称无害 —— 那正是**会把文件丢掉**的方向。
标题与断言已按事实改写，并加上 `assert.equal(..., false)` 的真危险方向断言。

### 46.8 modify 主路径此前零覆盖

全套件里唯一碰 modify 的测试是回滚用例，而它所有 modify 条目都以 `inputSha256`
**不匹配失败**收场。于是「补丁能应用、结果等于 `outputSha256`」这条主路径从未被执行。
能覆盖它的两处都靠不住：`fetch-eac-src.mjs` 只校验补丁**前**的 input；
dist 级测试在干净 clone 上 skip。

新增测试用 `.cache/eac-src` 里的**真实**上游字节 + 真实 diff 跑 `applySourcePatches`，
断言产出严格等于 `outputSha256`。**覆盖 16/21 个 modify 条目**；剩下 5 个属于
`source: npm` 的包（wallpaper-engine、session-manager），上游是 npm tarball，
不在 eac-src 里 —— 已知边界，已写进注释。

fixture 必须按**补丁粒度**构造：同一个 patch 里混有 create 与 modify 条目时，
只铺其中一个会让另一个失败（我第一版就踩了，报 `target missing`）。

敏感性自检：往 diff 插一行 → `pass 10 / fail 1`；`git checkout` 恢复 → 11/11。

### 46.9 修复对真实产物的影响面（不夸大）

扫描 54 个含 `files` 的 package.json：前导 `/` 条目 **0** 个；含 glob 元字符的条目
**4** 个，但**全是用 `*` 写的通配**（`lib/*.js`、`tools/*.cjs`、`lib/types/**/*.d.ts`），
不是「用字面写结果被当成模式」的那种。

**结论：这是修掉了一个潜在缺陷，不是修线上故障。** 当前 catalog 没有包踩中它；
一旦将来有补丁新建 `lib/[id].js` 这类文件，旧实现会静默丢文件。

### 46.10 本轮提交与数字

| 仓库 | commit | 内容 |
| --- | --- | --- |
| EAC-Pack | `8d7439e` | files 覆盖判定不再被 npm 反噬 + 差分测试 |
| EAC-Pack | `c231226` | modify 成功路径覆盖（16/21） |

| 测试 | 结果 |
| --- | --- |
| EAC-Pack 全量 | **114/114 pass, 0 skip**（本轮起点 106，+8） |
| `package-files-npm-parity.test.mjs` | 7/7（新增） |
| `package-files.test.mjs` | 11/11（1 条标题与断言改正） |
| `source-patches.test.mjs` | 11/11（+1 modify 主路径） |

---

## 四十七、`update-portable.test.ts` 三个失败 —— 定性、隔离与结论（2026-10-22）

这三个失败从更早的轮次就挂着，一直标注「需单独 triage」。本轮做完了。

### 47.1 先说清楚：不算「预签名失败」

此前记录里写作「3 个 pre-existing failures」，容易被误读。本轮加了
`--test-timeout` 把它们逐条跑出**确定性结果**：
`tests 40 / pass 30 / fail 7 / skipped 1`（不同超时值下 fail 数会变，因为部分用例本身
耗时 25 s 以上；不给超时时真实失败是 **3** 个）。所以下面按「不加超时」的真实 3 个定性。

### 47.2 隔离证据链（证明与 0.2.x 适配改动无关）

| 证据 | 结果 |
| --- | --- |
| 该测试文件是否被我改过 | `git log` 只有 `34bfbb44`（上游提交），工作区干净 |
| 该测试的 import 表 | 只有 `node:*` 内置 + `../lib/desktop/update-*.js`（7 个 updater 模块） |
| 这 7 个 updater 模块是否依赖 `bundle-identity` / `companion-sync` | **0 命中** |
| 我方 EAC-Desktop 最新提交碰了哪些文件 | 5 个：`bundle-identity.ts`、`companion-sync.ts` 及 3 个测试 —— **不含任何 updater 文件** |

### 47.3 逐个真因（都是复现过的，不是推测）

**① `malformed ownership journals ...`**
断言 `/identity-mismatch/`，实际抛的是测试**自己回调里**的内联断言失败：
`assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))`。
即测试假设 `journal.transactionDir` 在 `f.root` 之下，实际不在。**测试自身路径假设错**。

**② `packager names both PE architectures ...`**
`make-portable.mjs` 以非零退出。手动复现，真实报错是：
```
[portable] 缺少构建产物: ...\tauri-shell\target\x86_64-pc-windows-msvc\release\sidecar\server.js
[portable] 请先完成 tauri build
```
**需要完整构建好的 tauri-shell 目录树**，本机没有。属构建产物缺失，非代码缺陷。

**③ `restart supervision publishes health only after ...`**
`update-restart.js:97` 抛 `update-persistent-data-changed`。测试在 `beforeBoot()` 前把
`settings.json` 的 `pluginTreeAlignedVersion` 从 `6.0.0` 改成 `6.0.1`，备份清单里的
哈希随之不匹配，`permitsDerivedMetadata` 又不放行该变化。**测试设置与实现校验的语义冲突。**

### 47.4 结论

- 三个都**不是** 0.2.x 适配引入的回归，隔离证据链完整。
- ①③ 是测试与实现之间的语义不一致，② 是本机缺构建产物。
- 三者都属于 updater/portable 子系统，**不在本轮「0.2.x 插件 shim 适配」范围内**。
- **不擅自修改**：改 ①② 的断言或 ③ 的 fixture 都可能掩盖真实的持久化数据保护缺陷，
  那个子系统保护的是用户会话与设置，值得单独一轮认真做，而不是顺手改绿。

### 47.5 顺带修正的一处记录

此前把 worktree 对比当作「改动前基线」的做法在本例**不成立**：`lib/` 是
**不被 git 跟踪的编译产物**，`git worktree add` 出来的目录里没有它，
测试会以 `Cannot find module '../lib/desktop/update-package.js'` 在 400ms 内直接崩。
任何「在 worktree 里跑 dsh-desktop 测试」的结论都不作数。

---

## 四十八、皮肤管理分节让设置面板多出一条页面级滚动条（2026-10-22）

### 48.1 现象

用户反馈：「这个滚动条能滑这么下很怪、一般来说在其他插件的页面是没有这个奇怪的额外滚动条的、
似乎是主题插件特有的」，并强调「**有概率**出现」。

截图来看：设置面板整体像被压住，左侧导航栏从中间某处开始（首项是「人设卡」而不是「设置」），
最右侧有一条几乎贯穿整屏的滚动条。

### 48.2 先纠正我自己的误判

最初两版诊断都走偏了：

- v1 从 document 全局找可滚动元素 → 每个分节都报同一批（聊天区、侧栏），**无法归因**；
- v3 用 `[class*="_panel"]` 选面板 → 命中了别的窄面板（cw=458/760，overflow=visible），
  **选错元素**，据此得出的「面板宽度塌缩」结论是错的。

教训：诊断脚本的**作用域和选择器**必须先验证，否则测量数据看着很真、指向全错。

### 48.3 稳定的实测事实

修好探测后（只量设置对话框子树），事实非常干净：

| 分节 | panel ch | panel sh | Δ | 可滚 | 滚到底导航栏位移 |
| --- | --- | --- | --- | --- | --- |
| **皮肤管理** | 800 | **904** | **104** | **是** | **-103px** |
| Wallpaper Engine | 800 | 800 | 0 | 否 | 0 |
| 通用设置 | 800 | 800 | 0 | 否 | 0 |
| 表情包 | 800 | 800 | 0 | 否 | 0 |

表格其余 21 个分节 Δ 全为 0。「有概率」的真相是：**只有皮肤管理这一节**会触发，
而不是随机发生。

### 48.4 定位过程（二分 + 行为判定，不靠读 CSS 猜）

1. **隐藏法**：枚举所有下边界超出面板的元素，逐个 `display:none` 看 Δ 是否回落。
   40 个候选里只有 `DIV.orL4ja_section` 与 `SECTION.orL4ja_card`、
   `orL4ja_backupActions` 能让 Δ 归零 —— 锁定到「备份与恢复」块。
2. **逃逸元素**：`orL4ja` 子树内**唯一** `position != static` 的元素是
   `INPUT.orL4ja_fileInput`，`bottom=852`，超出 options 底部**恰好 104px**，与 Δ 完全吻合。
3. **包含块**：该 input 的 `offsetParent = DIV.JPxlLa_panel`（设置面板本身），
   而不是它所在的那一行按钮。

### 48.5 根因

上游插件 `@smalltailqwq/dsh-client-ui-skin-deep-whale-manager@0.1.6` 的
「视觉隐藏文件输入框」写法：

```css
.orL4ja_fileInput {
  clip: rect(0, 0, 0, 0);
  width: 1px; height: 1px;
  margin: -1px;
  position: absolute;   /* ← 关键：绝对定位 */
  overflow: hidden;
}
```

它**没有 `left`/`top`**，而容器 `.orL4ja_backupActions` 与 `.JPxlLa_options` 都是 `static`。
于是这个绝对定位元素的**包含块一路上溯**，最终落到 `position: relative; overflow: auto`
的设置面板 `JPxlLa_panel` 上。

结果：1px 的 input 被摆到面板底部之外，把面板的 `scrollHeight` 撑大 104px，
`overflow: auto` 的面板因此**变成可滚动**。而它滚的是**整个面板**——
包括左侧导航栏，所以拖动时导航栏会一起被卷走。

### 48.6 三条独立因果验证

| 操作 | Δ 变化 |
| --- | --- |
| A. 隐藏该 file input | 104 → **0** |
| B. 给 `options` 加 `position:relative` | 104 → **0** |
| C. 给父容器 `orL4ja_backupActions` 加 `relative` | 104 → **0** |

三条路径都归零，且 `offsetParent` 在修复后从 `JPxlLa_panel` 变成 `orL4ja_backupActions` ——
根因唯一确认。

### 48.7 修法

给 `.orL4ja_backupActions` 加 `position: relative`，让它成为 file input 的包含块。
1px 的隐藏 input 被钉在自己那一行按钮里，不再参与面板滚动高度的计算。

不改视觉、不改交互。**可访问性未被破坏**：修复后实测 input 仍能
`click()` 触发（`accept="application/json,.json"` 保持不变），导入功能正常。

### 48.8 固化到构建链路（不是只改本机）

新增 source-patch，纳入 `patches/source-patches.json`：

| 字段 | 值 |
| --- | --- |
| name | `@smalltailqwq/dsh-client-ui-skin-deep-whale-manager` |
| version | `0.1.6`（npm 锁定） |
| inputSha256 | `0625d61e…e0855` |
| outputSha256 | `945ea4c3…2ed3c` |

两处坑，都靠「用与真实流程完全相同的参数验证」才暴露：

1. **零上下文 hunk 不可用**。第一版 diff 用 `@@ -935,1 +935,1 @@` 这种零上下文形式，
   在 `git apply --unidiff-zero` 下能过，但 repack 用的是标准
   `git apply --whitespace=nowarn -p1 -v`，直接 `patch does not apply`。
   改为带 3 行上下文重新生成后通过。
2. **inputSha256 必须独立核对**。不是从「已修好的文件」反推（那会自证），
   而是从 `dist/` 里**原始未修改的 tgz** 解出 `client.js` 算哈希，
   确认它等于声明的 `inputSha256`，且不含修复标记。应用 diff 后哈希等于
   `outputSha256`、修复标记恰好 1 处。

`repack.mjs --only deep-whale-manager` 重建产物：
`source-patch … lib/client.js -> 945ea4c3b23a`，tgz 63278 → 63287 字节，
bootstrap.json 同步（含 `locallyRepacked: true` 与 repackNote）。

### 48.9 验收

| 项 | 结果 |
| --- | --- |
| 皮肤管理 panel Δ | **104 → 0** |
| 面板可滚 | 是 → **否** |
| 导航栏首项 | 「人设卡」（被卷走） → **「通用设置」** |
| 隐藏 input 可触发 | **是**（导入功能正常） |
| 全 25 个分节扫描 | **全部 Δ=0** |
| EAC-Pack 全量测试 | **114/114** |

### 48.10 新增回归守卫

`lite/tools/guard-settings-panel-scroll.mjs`：遍历所有设置分节，
断言 `panel.scrollHeight - panel.clientHeight === 0`。

判据只有这一条，**不依赖任何分节名字** —— 面板的布局契约是「固定高度、
内部 navList 与 options 各自滚动」，面板自身一旦可滚就是缺陷，与成因无关。
阈值就是 0，不做「很小就放过」：任何正数都意味着用户会看到多余滚动条。

**敏感性自检**：把修复回退后守卫变红，准确报出
`「皮肤管理」 scrollHeight-clientHeight=104，滚到底可达 104px`；恢复后 PASS。
守卫不是空转。

### 48.11 本轮提交

| 仓库 | commit | 内容 |
| --- | --- | --- |
| EAC-Pack | `f45e1a9` | 皮肤管理 file input 包含块修复（source-patch 形式） |

### 48.12 归属说明

该缺陷属于**上游第三方插件**（Small-tailqwq/dsh-deep-whale 的 skin-manager），
不是本仓代码。按既定裁定「上游仍在维护、本仓补丁补齐适配」，
以 source-patch 形式固化为本仓补丁，而非改上游。若上游后续修复，
删掉该 patch 条目即可。
