<h1 align="center">
  <img src="docs/assets/EAC-Pack.svg" alt="eac-plugin-suite — EAC/AIO 插件整合包" width="808" />
</h1>

为官方 DeepSeek Harness Desktop 提供目录、批量安装、更新与移除管理，以及皮肤预览和 Prompt。包名、API 与数据目录统一为 `eac-plugin-suite`；Git 仓库仍为 `DSH-EAC/EAC-Pack`。

**交接状态（2026-10-05）：本次推送仅交接源码，资源依赖尚未公开发布，暂不可作为正式 Git 安装入口。接手步骤及必须另行移交的资源见 `docs/HANDOFF-CASCADE-INSTALL-2026-10-05.md`。**

## 0.2.4：安装阶段级联取得完整资源

Git 仅保留组合包入口、host/client、目录与固定摘要清单。必选依赖 **`eac-plugin-suite-assets@0.2.4`** 提供全部 72 个基线子插件 tarball、30 张皮肤预览和 10 组 Prompt；不是 optional/peer，也不是启用后下载。

正常安装事务会同时安装入口和资源依赖。启用后仅在本地校验与拼接；没有 prepare/install/postinstall 下载器，不需要关闭 pnpm 安全策略。资源包是纯数据，不能单独作为 Desktop 插件添加。

**发布前提：资源包必须先公开发布到 npm，并能由使用者的 registry 解析。当前本地改造不代表该版本已公开可安装，发布与验收状态见 `docs/CASCADE-INSTALL-TEST-2026-10-05.md`。**

## Git 安装

满足上述发布前提后，在 Desktop「插件 → 添加插件」输入：

```text
github:DSH-EAC/EAC-Pack
```

安装成功应已具备全部基线；启用会显示本地校验状态。资源齐全不等于自动安装或启用所有子插件：套餐、兼容性、EAC-only、内核重复包与皮肤互斥守卫仍有效。子插件自身传递依赖可能需要网络，不能将基线就绪误称为全部依赖离线可用。

## 完整 Release

完整单文件 `eac-plugin-suite-0.2.4.tgz` 使用 npm 标准 `bundleDependencies` 内置同一资源依赖，可在没有 registry 连接时安装整合包本身。正式 Release 或本地构建的 **release/** 产物才是完整包；**git/** 下的小 tarball 是轻入口，不可混用。

`dist-artifacts-*.tar.gz` 是构建归档，不是 Desktop 插件安装包。历史 v0.2.1 及更早版本仍使用旧包名，不应只替换下载 URL 文件名。

## 完整性与故障处理

`suite/assets/bootstrap.json` 固定资源包身份与版本，以及 72 个 tarball、分块、gallery/preview/Prompt 的大小和 SHA256。通过 Node 标准依赖解析找到资源包，不依赖 `.pnpm` 路径。缺依赖、错版本、清单不匹配或摘要失败会明确报错；不回退上游/latest、不用旧缓存掩盖不完整安装、不在启动后补下载。

失败时重新安装整合包及其必选依赖，检查 registry、代理与发布同步；不要关闭供应链安全策略。完整 Release 可作为单文件备用入口。

子插件安装前重新验证本地资源，完整 tarball 持久化到 `$DSH_HOME/eac-plugin-suite/resources/<sha256>/`，避免 file: 依赖绑定到以后可能被卸载的整合包。在线 channel 检查和后续更新仍是独立能力。

## 已有安装迁移

- API：`/api/eac-plugin-suite`。
- 数据：`$DSH_HOME/eac-plugin-suite/`。新目录不存在时复制旧 `$DSH_HOME/plugin-suite/`，不删除旧目录或覆盖已有新数据。
- 新旧包会被宿主视为不同插件。先停用旧 `dsh-plugin-suite`；整合包不会擅自卸载旧包。

## 构建与验收

需要完整、合法的 `dist/index.json`、72 个 canonical tarball，以及 `.cache/asset-input/` 中的 gallery、previews、prompts。这些输入不是 Git 安装时的构建步骤，也不入 Git。

```powershell
node scripts/repack/repack.mjs
node scripts/repack/ensure-bundles.mjs
node scripts/repack/verify.mjs
node suite/scripts/sync-assets.mjs
node scripts/build-resources.mjs --verify
node --test suite/test/*.test.mjs
node scripts/pack-delivery.mjs
node scripts/publish-resources.mjs --dry-run
```

`pack-delivery.mjs` 校验真实资源包和完整 Release 归档，产物置于 ignored `.cache/cascade/artifacts/{assets,git,release}/`，并保存大小及摘要。Git prepack 只验证轻入口契约：Git 打包发生在依赖安装前，不能要求下载资源已存在。完整字节门禁由资源/Release 构建承担。

## 发布顺序

1. 构建资源，验证目录覆盖、身份、许可证、摘要和每个子插件的 `dsh.bundle.patch`。
2. 验证级联安装、空 store 完整 Release 离线安装与官方 Desktop 识别。
3. 有发布权限时运行 `node scripts/publish-resources.mjs`，先公开发布固定版本资源包。发布不可覆盖，修复应使用新版本。
4. 确认生产 registry 的身份、版本及实际 tarball 完整性；考虑镜像同步与发布年龄策略，不关闭安全保护。
5. 再提交、推送轻量 Git 入口；完整 Release 另行上传。不得把资源包、完整 tgz、测试 registry、profile 或凭据加入 Git。

## 仓库结构

```text
package.json                       Git 组合包入口，精确必选资源依赖
suite/                             host/client、目录、locale、轻量图标
suite/asset-package.mjs             标准依赖解析及附加资产摘要校验
suite/resources.mjs                本地资源校验、拼接与持久化
suite/assets/bootstrap.json        固定资源契约，不含资源本体
scripts/build-resources.mjs         生成 ignored registry 资源 staging
scripts/pack-delivery.mjs           小 Git 包、纯数据包、完整 Release 门禁
scripts/publish-resources.mjs       资源先发布；--dry-run 不上传
.cache/                            本地输入、资源、测试证据与产物，不提交
catalog/                           目录、退役记录与来源
reports/、docs/历史验收文档           保留当时版本与验证边界
```

## 许可

整合包为 MIT。第三方 tarball、皮肤与 Prompt 保留原 LICENSE、NOTICE 和署名；部分素材有非商业等附加条款。资源包保留 `SOURCES.json`，打包不改变第三方许可，公开再分发前仍需检查权利。
