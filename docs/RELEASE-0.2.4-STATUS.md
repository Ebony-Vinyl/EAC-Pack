# 0.2.4 接管复验与发布状态（2026-10-23）

本文记录 0.2.4 在「接手者机器」上的复验结论、资源来源与剩余发布门禁。
上一轮交接文档：`docs/HANDOFF-CASCADE-INSTALL-2026-10-05.md`。

## 1. 结论

- 资源基线可完整恢复，且与仓库固定清单**逐字节一致**：72/72 tarball、51/51 额外文件
  （gallery.json、30 张预览、20 个 Prompt 文件）全部通过 SHA256/bytes 校验。
- `suite/assets/bootstrap.json` 由本机管线重新生成后与已提交版本**完全一致**（无漂移）。
- `node scripts/build-resources.mjs --verify` 通过；`node --test suite/test/*.test.mjs` 54/54 通过。
- 三件产物已打包并自验：assets 335,113,333 B、Git 轻入口 91,256 B、完整 Release 335,206,723 B。
- **仍未发布**：`eac-plugin-suite-assets@0.2.4` 不在 npm（registry 返回 404）；官方 GitHub Release
  与 `channel` 上传需要仓库维护者权限。Git 轻入口在数据包发布前不可用；完整 Release 是可用的
  单文件安装入口。

## 2. 资源来源（不在 Git 中的 330+ MB 资源如何取得）

交接文档要求的「已验资源包 tgz」未随机器移交（原机器 `G:\Code\fork\EAC-Pack` 不存在）。
本轮改用**公开发布物**恢复，且其字节与仓库固定摘要完全一致：

- 来源：`Ebony-Vinyl/EAC-Desktop` 的 **V6.0.1 full portable** 发布物
  `Deepseek-Harness-EAC-full-v6.0.1-x64-portable.zip`
  （1,311,317,339 B，SHA256 `17e729a2c59cbb8a93d480a0b40d8c0b4821a75e0e5909f889c24163e7838773`，
  与 Release 页登记值一致）。该版本说明明确「内含插件整合包 EAC-Pack 0.2.4」。
- 提取路径（zip 内，反斜杠分隔）：
  `dsh-desktop\assets\full-pack\profile-seed\node_modules\eac-plugin-suite`
  （含 `node_modules\eac-plugin-suite-assets` 完整数据包）。
- 恢复方法：按 `suite/assets/bootstrap.json` 的 parts 列表把 payload 拼回 72 个 tarball 写入
  `dist/`，并把 `gallery.json`、`previews/`、`prompts/` 恢复到 `.cache/asset-input/`。
- 复验：72/72 tarball 的 SHA256 与 bytes 与仓库清单相等；51/51 额外文件相等。

> 说明：该发布物中的 `bootstrap.json` 与仓库版本属于同一次构建（parts 布局一致），差异仅在于
> 个别文件的换行符，经 git 归一化后无 diff。

## 3. 本轮代码修复（与 Windows 运行环境相关）

本机为 Git Bash + MSYS GNU tar 1.35；上游脚本在「tar 收到绝对 Windows 路径」与
「npm ≥ 11 的 `pack --json` 输出」两处不兼容。修复均为兼容性增强，不改变产物字节：

1. **GNU tar 的盘符路径**：给所有可能收到绝对路径的 tar 调用加 `--force-local`，
   并把路径统一转成正斜杠（MSYS tar 会把 `\` 当作普通字符，`-C` 反斜杠路径会 ENOENT）。
   涉及 `scripts/repack/resource-bundle.mjs`、`scripts/repack/ensure-bundles.mjs`、
   `scripts/pack-delivery.mjs`、`suite/test/{full-package,resource-publication,source-patches}.test.mjs`。
2. **npm ≥ 11 的 `npm pack --json`**：输出从数组变为「以包名为键的对象」，且 prepack 输出可能
   混入 stdout。`scripts/pack-delivery.mjs` 增加 `parsePackJson`（扫描平衡 JSON 值、兼容两种形态），
   `scripts/verify-published-resources.mjs` 与 `scripts/repack/repack.mjs` 复用同一兼容逻辑。

## 4. 发布门禁（需要额外凭据）

| 门禁 | 需要 | 状态 |
| --- | --- | --- |
| npm 数据包发布 | npm 账号 + 发布权限（包名当前 404，可认领） | **未完成**（本机无账号，注册受限） |
| 官方 GitHub Release（v0.2.4） | 仓库 push/release 权限 | **未完成**（当前 token 账号无 push 权限，已 fork 可提 PR） |
| `channel` Release 更新 | 同上 + `gh` CLI 或 GitHub token | **未完成**（同上） |
| 完整 Release 单文件分发 | 任意可上传附件的账号/渠道 | 产物已就绪 |

## 5. 就绪产物与命令（有权限者可直接执行）

产物（gitignored）：

- `.cache/cascade/artifacts/assets/eac-plugin-suite-assets-0.2.4.tgz`
  （335,113,333 B，SHA256 `f239d033888d38ba8ed21ea887f2c890994529ed8918a2cbce093f9812dad445`）
- `.cache/cascade/artifacts/release/eac-plugin-suite-0.2.4.tgz`
  （335,206,723 B，SHA256 `f17b1f396cc10349df2f4b2816bb7d134eeefb4d8136cf294a49f02ec374a48f`）
- `.cache/cascade/artifacts/git/eac-plugin-suite-0.2.4.tgz`（91,256 B，轻入口）

发布步骤（npm 账号就绪后）：

```powershell
node scripts/publish-resources.mjs          # 发布数据包并做生产冷下载校验
node scripts/pack-delivery.mjs              # 重新打包（如需要）
node scripts/publish-channel.mjs            # 生成 channel.json 并上传 channel Release（需 gh 登录）
```

创建 v0.2.4 Release 时请上传 `release/` 下的完整 tgz；`git/` 下的是轻入口，不要当作插件安装包。

## 6. 验证证据

复用 `.cache/`（gitignored，不提交）：`cascade/artifacts/packed-evidence.json`、
本机 54/54 测试输出、`dist/index.json` 与 `dist/SHA256SUMS`。
公开可见的历史证据仍以 `docs/CASCADE-INSTALL-TEST-2026-10-05.md` 为准。
