# 0.2.x 适配 —— 排查与验收报告归档

这组报告记录的是 EAC/AIO 插件套件在 **DeepSeek-Harness 内核 0.2.x**（pin `0.2.0-rc.2`）
上的适配过程。原始文件在本地开发目录 `lite/`（不在仓库内），此处为归档副本。

分支：`feat/pack-0.2x-plugin-shims` · 关联 PR：[EAC-Pack #14](https://github.com/Ebony-Vinyl/EAC-Pack/pull/14)

## 主报告

**[REPORT-0.2X-SHIMS-20261021.md](REPORT-0.2X-SHIMS-20261021.md)** —— 48 章，按轮次记录。

每条结论都要求有可复现的命令或实测输出支撑，不写「应该」「大概」。
报告里包含若干次**自我纠错**，这些是有意保留的：它们记录了错误的判断是怎么产生的，
比只写最终答案更有用。

## 分册

| 文件 | 内容 |
| --- | --- |
| [REPORT-skin-switch-and-theme-conflict-20261021.md](REPORT-skin-switch-and-theme-conflict-20261021.md) | 终末地主题与皮肤管理器的 UI/定位冲突分析 |
| [REPORT-skin-switch-fix-20261021.md](REPORT-skin-switch-fix-20261021.md) | 皮肤预设无法切换的修复 |
| [REPORT-endfield-default-on-fix-attempts-20261021.md](REPORT-endfield-default-on-fix-attempts-20261021.md) | 终末地默认启用 —— 两次失败尝试的完整记录 |
| [REPORT-full-lite-debug-20261021.md](REPORT-full-lite-debug-20261021.md) | full / lite 双档位实机调试 |
| [REPORT-visual-acceptance-20261021.md](REPORT-visual-acceptance-20261021.md) | 逐页面逐功能逐插件截图验收 |

## 几个值得单独一提的结论

主报告章节编号对应下表，方便直接跳读。

| 章节 | 结论 | 为什么值得看 |
| --- | --- | --- |
| 四十六 | npm `files` 判定会被上游反噬 | 不是读代码推的，是跑真实 `npm-packlist` 差分测出来的。`files:['lib/[ab].js']` 会让那个文件自己被丢弃 |
| 四十七 | `update-portable.test.ts` 三个失败定性 | 隔离证据链完整，证明与 0.2.x 适配无关；但**没有**顺手改绿 |
| 四十八 | 皮肤管理分节让设置面板多出页面级滚动条 | 三条独立因果验证 + 敏感性自检；修法以 source-patch 固化 |

## 关于「测试全绿」

这轮里「测试全绿」被证伪过不止一次，所以现在的口径是：

> 测试绿只能证明「已写的断言都过了」，不能证明「没写断言的地方是对的」。

因此凡是新增守卫，都尽量配一次**敏感性自检**（把修复回退，确认守卫会变红）。
报告里这类自检有明确标注。
