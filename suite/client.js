/**
 * eac-plugin-suite — browser half (v0.2.0 UI refresh).
 *
 * Contributes one settings tab (`settings.plugins.tab` id `eac-plugin-suite`):
 *
 *   top bar      title + version badge | channel pill + check-updates button
 *   segmented    概览 / 皮肤馆 / 插件管理 / 更新中心 (sliding indicator,
 *                content crossfade+slide)
 *   overview     3 pack cards (SVG ring, count-up, install button, update
 *                corner badge) + recent-activity timeline
 *   gallery      responsive skin grid (16:10 light/dark previews, status
 *                badges, mutex strip) + prompt drawer with copy button
 *   plugins      collapsible EAC/AIO groups, tier badges, version pairs,
 *                per-row update, armed remove-confirm preserved
 *   updates      auto-update toggles, interval, mirror (advanced), channel
 *                updates checklist, channel info card, suite-update banner
 *   progress     sticky live job panel with morphing bar, expandable log and
 *                a stroke-drawn ✓ on completion
 *
 * Data comes from this plugin's same-origin `/api/eac-plugin-suite/*` routes
 * (API-v2), which the Host half mounts on the shared web server. Hand-written
 * ModuleLoader bundle: no build step, the only dependency is the `react` the
 * shell already provides. All colour comes from theme variables so the page
 * survives scheme switches; motion is transform/opacity only and respects
 * prefers-reduced-motion.
 */
window.__ModuleLoader__.load({
  id: 'eac-plugin-suite',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } = React

    const NS = 'settings.eacPluginSuite'
    const inject = ['slots', 'locale']
    const API = '/api/eac-plugin-suite'
    const EASE = 'cubic-bezier(0.16,1,0.3,1)'

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'resources.title': "完整安装资产",
        'resources.checking': "正在校验本地资产…",
        'resources.ready': "完整资产已就绪",
        'resources.failed': "本地资产校验失败",
        'resources.cancelled': "本地校验已停止",
        'resources.idle': "等待本地校验",
        'resources.hint': "完整资产由安装阶段的必选资源依赖提供。缺失或损坏请重新安装整合包及依赖；不会自动启用插件。",
        'resources.retry': "重新校验",
        'meta.title': 'eac-plugin-suite · 插件整合包',
        'meta.description': '一键安装与更新 EAC / AIO 全量插件整合包，附皮肤馆与在线渠道',
        tab: '整合包',
        subtitle: 'EAC / AIO 插件整合包 · 安装阶段级联取得完整资源 · 本地校验',
        refresh: '刷新',
        refreshTip: '重新读取整合包状态',
        loading: '正在读取整合包目录…',
        loadFailed: '无法连接整合包后端',
        'error.hint': '请确认整合包宿主半已在内核中启动，然后重试。',
        retry: '重试',
        emptyCatalog: '整合包目录为空：请使用随包发布的完整版本。',
        'empty.title': '这个包暂无可安装的插件',
        'empty.hint': '目录缺失，请重新安装 eac-plugin-suite。',

        'nav.overview': '概览',
        'nav.gallery': '皮肤馆',
        'nav.plugins': '插件管理',
        'nav.updates': '更新中心',

        'channel.online': '在线 · 渠道 v{n}',
        'channel.offline': '离线 · 使用内置包',
        'channel.checking': '检查中…',
        'channel.checkNow': '检查更新',
        'channel.checkFailed': '渠道检查失败，继续使用内置包',
        'channel.never': '离线 · 使用内置包',

        'pack.eac': 'EAC 全量包',
        'pack.eacHint': '揽尽万象主线全部在役插件',
        'pack.aio': 'AIO 全量包',
        'pack.aioHint': 'AIO 6.9.3 全部 11 项 + 稳定线 v1.2.0 增补 8 项，无遗漏',
        'pack.skins': '皮肤馆',
        'pack.skinsHint': '皮肤图鉴与 AI prompt 创作包，支持明暗预览与一键启用',
        'pack.manage': '管理',
        'pack.installAll': '一键安装',
        'pack.allInstalled': '已全部安装',
        'pack.updateBadge': '{n} 项可更新',
        'pack.goGallery': '进入皮肤馆',
        'pack.installedShort': '已装',

        installed: '{n}/{m} 已装',
        installedShort: '已装',
        defaultDisabled: '{n} 默认禁用',

        'activity.title': '最近动态',
        'activity.empty': '暂无动态，安装完成后这里会显示结果摘要',
        'activity.running': '进行中',
        'activity.okFailed': '成功 {ok} · 失败 {failed}',

        'gallery.author': '作者',
        'gallery.install': '安装',
        'gallery.enable': '启用',
        'gallery.unsafe': 'RC2 崩溃',
        'gallery.unsafeBtn': '在 RC2 上不可用',
        'gallery.unsafeTitle': '实测启用本皮肤会导致官方 v0.2.0-rc.2 Web UI 崩溃，已禁用启用按钮',
        'gallery.disable': '禁用',
        'gallery.enabledCount': '当前启用 {n} 张皮肤',
        'gallery.mutexWarn': '皮肤互斥，请先停用多余的',
        'gallery.resetDefault': '恢复默认外观',
        'gallery.resetDone': '已停用 {n} 张皮肤，恢复官方默认外观',
        'gallery.resetNone': '当前没有启用的皮肤',
        'gallery.switchedOff': '已自动停用 {n} 张此前启用的皮肤',
        'gallery.installed': '已启用',
        'gallery.disabled': '已装未启用',
        'gallery.missing': '未安装',
        'gallery.originBuiltin': '内置',
        'gallery.originCommunity': '社区',
        'gallery.previewLight': '亮色预览',
        'gallery.previewDark': '暗色预览',
        'gallery.previewHint': '悬停预览另一明暗 · 点击图钉定住',
        'gallery.noPreview': '暂无预览图',
        'gallery.drawerTitle': '皮肤详情',
        'gallery.manifest': 'Manifest 摘要',
        'gallery.manifestRaw': '查看原始 JSON',
        'gallery.prompt': 'AI 绘制 Prompt',
        'gallery.promptEmpty': '该皮肤未附带 prompt 文件',
        'gallery.copyPrompt': '复制全文',
        'gallery.copied': '已复制',
        'gallery.copyFailed': '复制失败，请手动选择文本',
        'gallery.close': '关闭',
        'gallery.notes': '说明',
        'gallery.compat': 'RC2 适配状态（真机实测）',
        'gallery.loadingPrompt': '正在读取 prompt…',
        'gallery.promptFailed': 'prompt 读取失败',

        selectAll: '全选',
        invert: '反选',
        installSelected: '安装所选（{n}）',
        installAll: '一键安装',
        updateAll: '可更新 {n}',
        uninstallSelected: '移除所选',
        clickAgainConfirm: '再点一次确认',
        working: '任务进行中…',
        'group.count': '{total} 项 · 已装 {done}',
        'group.updatable': '可更新 {n}',
        'status.installed': '已启用',
        'status.disabled': '已装未启用',
        'status.update': '可更新',
        'status.missing': '未安装',
        'versionPair': '已装 {a} → {b}',
        'row.update': '更新',
        'tier.core': '功能',
        'tier.visual': '外观',
        'tier.heavy': '重型',
        'compat.eacFork': '仅 EAC 内核',
        'compat.eacForkTip': '依赖 EAC 分叉版专有服务 settingsScope：在官方内核上启用会导致应用无法启动，整合包已拦截其安装与启用（issue #1）',
        'compat.kernelProvided': '内核自带',
        'compat.kernelTip': '内核已内置官方版：安装重打包副本会遮蔽官方包、导致所有会话无法恢复，整合包已拦截安装并在启动时自动卸载残留（issue #1）',
        disabledNote: '此插件在当前内核验证异常，默认保持关闭',
        unavailableNote: '上游不可得，本包跳过',

        'updates.autoUpdate': '自动更新',
        'updates.autoUpdateDesc': '启动后 60 秒首查，之后按间隔检查渠道并在后台更新已装插件',
        'updates.autoUpdateHeavy': '重型插件自动更新',
        'updates.autoUpdateHeavyDesc': 'heavy 插件体积大，默认仅手动更新时下载',
        'updates.interval': '检查间隔',
        'updates.intervalUnit': '{n} 小时',
        'updates.advanced': '高级选项',
        'updates.mirror': '镜像前缀',
        'updates.mirrorPlaceholder': 'https://gh-proxy.example.com',
        'updates.mirrorHint': '留空使用直连；支持 gh-proxy 风格前缀，可带或不带尾斜杠。',
        'updates.save': '保存',
        'updates.saving': '保存中…',
        'updates.saved': '已保存',
        'updates.listTitle': '可更新清单',
        'updates.groupInstalled': '已装可更新',
        'updates.groupAvailable': '未装新版',
        'updates.applySelected': '应用所选（{n}）',
        'updates.none': '渠道与内置包一致，暂无可更新项',
        'updates.channelCard': '渠道信息',
        'updates.channelVersion': '渠道版本 v{n}',
        'updates.generatedAt': '生成于 {time}',
        'updates.suiteBanner': '整合包有新版 v{v}：插件不会自装，请下载后手动安装。',
        'updates.suiteDownload': '下载整合包',
        'updates.includeHeavyNote': '所选项包含 heavy 插件，将一并下载',
        'updates.loadFailed': '渠道状态不可用',

        'progress.title': '任务进度',
        'progress.idle': '暂无任务',
        'progress.done': '任务完成：成功 {ok} · 失败 {failed}',
        'progress.download': '下载 {id} · {percent}%',
        'job.install': '安装',
        'job.update': '更新',
        'job.uninstall': '移除',
        'job.apply': '渠道应用',
        'log.empty': '暂无日志',
        log: '实时日志',
        logShow: '展开日志',
        logHide: '收起日志',
        snapshot: '安装前已自动快照：{name}',
        confirmUninstall: '移除后插件将在重启后彻底消失，确定移除所选吗？',
        noSelection: '请先勾选要处理的插件',
        needRestart: '版本替换需重启应用后完全生效',
      },
      en: {
        'resources.title': "Complete installed assets",
        'resources.checking': "Verifying installed assets…",
        'resources.ready': "Complete assets are ready",
        'resources.failed': "Local asset verification failed",
        'resources.cancelled': "Local verification stopped",
        'resources.idle': "Waiting for local verification",
        'resources.hint': "Baseline assets are installed as a required dependency. Missing or damaged files require reinstalling the suite and its dependency; plugins are not enabled automatically.",
        'resources.retry': "Verify again",
        'meta.title': 'eac-plugin-suite',
        'meta.description': 'One-click install and update for the EAC / AIO plugin suites, with a skin gallery and online channel',
        tab: 'Suite',
        subtitle: 'EAC / AIO plugin suites · complete assets installed as a required dependency · local verification',
        refresh: 'Refresh',
        refreshTip: 'Re-read suite state',
        loading: 'Loading suite catalog…',
        loadFailed: 'Cannot reach the suite backend',
        'error.hint': 'Make sure the suite host half is running in the kernel, then retry.',
        retry: 'Retry',
        emptyCatalog: 'Suite catalog is empty: use the full release build.',
        'empty.title': 'Nothing to install in this pack',
        'empty.hint': 'Catalog missing: reinstall eac-plugin-suite.',

        'nav.overview': 'Overview',
        'nav.gallery': 'Skin Gallery',
        'nav.plugins': 'Plugins',
        'nav.updates': 'Updates',

        'channel.online': 'Online · channel v{n}',
        'channel.offline': 'Offline · using built-in pack',
        'channel.checking': 'Checking…',
        'channel.checkNow': 'Check updates',
        'channel.checkFailed': 'Channel check failed; staying on the built-in pack',
        'channel.never': 'Offline · using built-in pack',

        'pack.eac': 'EAC Full Pack',
        'pack.eacHint': 'Every active plugin from the EAC main line',
        'pack.aio': 'AIO Full Pack',
        'pack.aioHint': 'All 11 plugins from AIO 6.9.3 + 8 from the v1.2.0 stable line',
        'pack.skins': 'Skin Gallery',
        'pack.skinsHint': 'Skin gallery with AI prompt packs, light/dark previews and one-click enable',
        'pack.manage': 'Manage',
        'pack.installAll': 'Install all',
        'pack.allInstalled': 'All installed',
        'pack.updateBadge': '{n} updates',
        'pack.goGallery': 'Open gallery',
        'pack.installedShort': 'Installed',

        installed: '{n}/{m} installed',
        installedShort: 'Installed',
        defaultDisabled: '{n} default-off',

        'activity.title': 'Recent activity',
        'activity.empty': 'No activity yet — job results will show up here',
        'activity.running': 'Running',
        'activity.okFailed': '{ok} ok · {failed} failed',

        'gallery.author': 'Author',
        'gallery.install': 'Install',
        'gallery.enable': 'Enable',
        'gallery.unsafe': 'Crashes RC2',
        'gallery.unsafeBtn': 'Unavailable on RC2',
        'gallery.unsafeTitle': 'Enabling this skin crashed the official v0.2.0-rc.2 web UI in real-machine testing; the enable button is disabled',
        'gallery.disable': 'Disable',
        'gallery.enabledCount': '{n} skin(s) enabled',
        'gallery.mutexWarn': 'skins are mutually exclusive — disable the extra ones',
        'gallery.resetDefault': 'Restore default look',
        'gallery.resetDone': 'Disabled {n} skin(s); back to the official default look',
        'gallery.resetNone': 'No skin is currently enabled',
        'gallery.switchedOff': 'Auto-disabled {n} previously enabled skin(s)',
        'gallery.installed': 'Enabled',
        'gallery.disabled': 'Installed, disabled',
        'gallery.missing': 'Not installed',
        'gallery.originBuiltin': 'Built-in',
        'gallery.originCommunity': 'Community',
        'gallery.previewLight': 'Light preview',
        'gallery.previewDark': 'Dark preview',
        'gallery.previewHint': 'Hover previews the other theme · click pins it',
        'gallery.noPreview': 'No preview image',
        'gallery.drawerTitle': 'Skin details',
        'gallery.manifest': 'Manifest summary',
        'gallery.manifestRaw': 'View raw JSON',
        'gallery.prompt': 'AI drawing prompt',
        'gallery.promptEmpty': 'This skin ships no prompt file',
        'gallery.copyPrompt': 'Copy all',
        'gallery.copied': 'Copied',
        'gallery.copyFailed': 'Copy failed — please select the text manually',
        'gallery.close': 'Close',
        'gallery.notes': 'Notes',
        'gallery.compat': 'RC2 compatibility (verified on real machine)',
        'gallery.loadingPrompt': 'Loading prompt…',
        'gallery.promptFailed': 'Failed to load the prompt',

        selectAll: 'Select all',
        invert: 'Invert',
        installSelected: 'Install selected ({n})',
        installAll: 'Install all',
        updateAll: '{n} updates',
        uninstallSelected: 'Remove selected',
        clickAgainConfirm: 'Click again to confirm',
        working: 'A job is running…',
        'group.count': '{total} items · {done} installed',
        'group.updatable': '{n} updates',
        'status.installed': 'Enabled',
        'status.disabled': 'Installed, disabled',
        'status.update': 'Update available',
        'status.missing': 'Not installed',
        'versionPair': 'Installed {a} → {b}',
        'row.update': 'Update',
        'tier.core': 'Core',
        'tier.visual': 'Visual',
        'tier.heavy': 'Heavy',
        'compat.eacFork': 'EAC fork only',
        'compat.eacForkTip': 'Depends on the EAC-fork-only settingsScope service: enabling it on the official kernel blocks app boot. Install/enable is blocked by the suite (issue #1)',
        'compat.kernelProvided': 'Built into kernel',
        'compat.kernelTip': 'The kernel ships an official copy: installing the repackaged one shadows it and breaks session resume. Install is blocked and boot sweeps leftovers automatically (issue #1)',
        disabledNote: 'This plugin misbehaves on the current kernel and stays disabled by default',
        unavailableNote: 'Upstream unavailable, skipped by this pack',

        'updates.autoUpdate': 'Auto update',
        'updates.autoUpdateDesc': 'First check 60s after launch, then every interval; installed plugins update in the background',
        'updates.autoUpdateHeavy': 'Auto update heavy plugins',
        'updates.autoUpdateHeavyDesc': 'Heavy plugins are large; they only download on manual updates by default',
        'updates.interval': 'Check interval',
        'updates.intervalUnit': '{n} h',
        'updates.advanced': 'Advanced',
        'updates.mirror': 'Mirror prefix',
        'updates.mirrorPlaceholder': 'https://gh-proxy.example.com',
        'updates.mirrorHint': 'Empty for direct download; gh-proxy style prefixes accepted, trailing slash optional.',
        'updates.save': 'Save',
        'updates.saving': 'Saving…',
        'updates.saved': 'Saved',
        'updates.listTitle': 'Available updates',
        'updates.groupInstalled': 'Installed, updatable',
        'updates.groupAvailable': 'New, not installed',
        'updates.applySelected': 'Apply selected ({n})',
        'updates.none': 'Channel matches the built-in pack — nothing to update',
        'updates.channelCard': 'Channel info',
        'updates.channelVersion': 'Channel v{n}',
        'updates.generatedAt': 'Generated {time}',
        'updates.suiteBanner': 'Suite v{v} is available: the plugin never self-installs — download and install it manually.',
        'updates.suiteDownload': 'Download suite',
        'updates.includeHeavyNote': 'Selection includes heavy plugins; they will be downloaded too',
        'updates.loadFailed': 'Channel status unavailable',

        'progress.title': 'Progress',
        'progress.idle': 'No job yet',
        'progress.done': 'Job finished: {ok} ok · {failed} failed',
        'progress.download': 'Downloading {id} · {percent}%',
        'job.install': 'Install',
        'job.update': 'Update',
        'job.uninstall': 'Remove',
        'job.apply': 'Channel apply',
        'log.empty': 'No log lines yet',
        log: 'Live log',
        logShow: 'Show log',
        logHide: 'Hide log',
        snapshot: 'Profile snapshotted automatically: {name}',
        confirmUninstall: 'Removed plugins disappear after a restart. Remove the selection?',
        noSelection: 'Select at least one plugin first',
        needRestart: 'Version replacement fully applies after an app restart',
      },
    }

    // ── style ─────────────────────────────────────────────────────────────────
    // Colour: shell alias variables only (plus color-mix/rgba tints on top of
    // them). Motion: transform/opacity only, with a reduced-motion kill switch.
    const CSS = `
.suite-root { --suite-visual: color-mix(in srgb, var(--dsw-alias-state-business-primary) 52%, var(--dsw-alias-state-error-primary)); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; max-width: 980px; position: relative; }
.suite-root button { font-family: inherit; }
.suite-root :focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }

/* ── entrance animation primitives ── */
.suite-rise { animation: suite-rise 240ms ${EASE} both; animation-delay: calc(var(--i, 0) * 40ms); }

/* ── header ─────────────────────────────────────────────── */
.suite-head { display: flex; align-items: flex-start; gap: 10px; margin: 2px 0 12px; }
.suite-head-main { min-width: 0; flex: 1; }
.suite-title-row { display: flex; align-items: center; gap: 8px; }
.suite-title { font-size: 16px; font-weight: 650; letter-spacing: .1px; }
.suite-version { flex: none; font-size: 10.5px; line-height: 1; padding: 3px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.suite-sub { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; margin-top: 2px; }
.suite-head-actions { flex: none; display: flex; align-items: center; gap: 7px; padding-top: 1px; }

/* channel status pill */
.suite-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; line-height: 1; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.suite-pill .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-border-l2); }
.suite-pill.online .dot { background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.suite-pill.online { color: var(--dsw-alias-label-primary); }
.suite-pill.offline .dot { background: var(--dsw-alias-border-l2); }

/* ── buttons ────────────────────────────────────────────── */
.suite-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 12px; font-size: 12px; cursor: pointer; transition: background .18s ease, border-color .18s ease, transform .12s ease, opacity .18s ease, color .18s ease, box-shadow .18s ease; }
.suite-btn:hover { background: var(--dsw-alias-bg-layer-3); }
.suite-btn:active { transform: scale(.97); }
.suite-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.suite-btn.primary { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: var(--dsw-alias-label-on-accent); }
.suite-btn.primary:hover { filter: brightness(1.06); background: var(--dsw-alias-state-business-primary); }
.suite-btn.ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.suite-btn.ghost:hover { background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); }
.suite-btn.sm { padding: 3px 9px; font-size: 11px; border-radius: 7px; }
.suite-btn.icon { padding: 5px 7px; display: inline-flex; align-items: center; }
.suite-btn.ok { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); }
/* danger red is reserved for the remove action */
.suite-btn.danger { color: var(--dsw-alias-state-error-primary); }
.suite-btn.danger.armed { background: var(--dsw-alias-state-error-primary); border-color: transparent; color: var(--dsw-alias-label-on-accent); animation: suite-pulse .9s ease infinite; }

/* ── segmented nav ──────────────────────────────────────── */
.suite-seg { position: relative; display: inline-flex; align-items: stretch; gap: 2px; padding: 3px; border-radius: 11px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); margin-bottom: 12px; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.suite-seg::-webkit-scrollbar { display: none; }
.suite-seg-ind { position: absolute; top: 3px; left: 0; height: calc(100% - 6px); width: 0; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 4px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent), 0 0 0 1px var(--dsw-alias-border-l1); }
.suite-seg-ind.ready { transition: transform 240ms ${EASE}, width 240ms ${EASE}; }
.suite-seg-btn { position: relative; z-index: 1; appearance: none; border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 12.5px; padding: 5px 14px; border-radius: 8px; cursor: pointer; white-space: nowrap; transition: color .18s ease; }
.suite-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.suite-seg-btn.on { color: var(--dsw-alias-label-primary); font-weight: 600; }

/* view switch */
.suite-view { animation: suite-view 240ms ${EASE} both; }

/* ── notice ─────────────────────────────────────────────── */
.suite-notice { display: flex; align-items: center; gap: 8px; border-radius: 8px; padding: 6px 10px; font-size: 12px; margin: 0 0 10px; animation: suite-rise 220ms ease both; }
.suite-resources { display: block; background: var(--dsw-alias-bg-layer-2); padding: 10px 12px; }
.suite-notice.warn { color: var(--dsw-alias-state-warning-primary); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 10%, transparent); }
.suite-notice.err { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }

/* ── overview pack cards ────────────────────────────────── */
.suite-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--gap, 10px); margin-bottom: 14px; }
.pack-card { position: relative; display: flex; flex-direction: column; text-align: left; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 14px; padding: 13px 14px 12px; color: inherit; cursor: pointer; transition: border-color .2s ease, transform .18s ease, box-shadow .2s ease; }
.pack-card:hover { transform: translateY(-2px); border-color: var(--dsw-alias-border-l2); box-shadow: 0 10px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent); }
.pack-head { display: flex; align-items: flex-start; gap: 10px; }
.pack-icon { flex: none; width: 34px; height: 34px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent); color: var(--dsw-alias-state-business-primary); }
.pack-icon.alt { background: color-mix(in srgb, var(--suite-visual) 12%, transparent); color: var(--suite-visual); }
.pack-titles { min-width: 0; flex: 1; }
.pack-name { font-weight: 650; font-size: 13.5px; }
.pack-hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-top: 1px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pack-badge { flex: none; font-size: 10.5px; line-height: 1; padding: 3px 8px; border-radius: 999px; color: var(--dsw-alias-state-warning-primary); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 30%, transparent); white-space: nowrap; cursor: pointer; transition: transform .15s ease; }
.pack-badge:hover { transform: translateY(-1px); }
.pack-mid { display: flex; align-items: center; gap: 12px; margin: 11px 0 10px; }
.ring-wrap { position: relative; flex: none; width: 54px; height: 54px; }
.suite-ring { display: block; transform: rotate(-90deg); }
.suite-ring .ring-track { stroke: var(--dsw-alias-bg-layer-3); }
.suite-ring .ring-val { stroke: var(--dsw-alias-state-business-primary); }
.suite-ring .ring-val.full { stroke: var(--dsw-alias-state-success-primary); }
.ring-num { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.ring-num b { font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; }
.ring-num span { font-size: 9px; color: var(--dsw-alias-label-tertiary); margin-top: 1px; font-variant-numeric: tabular-nums; }
.pack-legend { min-width: 0; flex: 1; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }
.pack-legend .lg-line { display: flex; align-items: baseline; gap: 6px; }
.pack-legend .lg-pct { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.pack-legend .lg-sub { margin-top: 2px; font-size: 10.5px; }
.pack-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.pack-foot .suite-btn.primary { margin-right: auto; }

/* ── activity timeline ──────────────────────────────────── */
.suite-section-title { font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); margin: 2px 0 8px; letter-spacing: .2px; }
.suite-timeline { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.tl-item { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l1); }
.tl-item:first-child { border-top: none; }
.tl-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); }
.tl-dot.ok { background: var(--dsw-alias-state-success-primary); }
.tl-dot.bad { background: var(--dsw-alias-state-error-primary); }
.tl-dot.idle { background: var(--dsw-alias-border-l2); }
.tl-main { min-width: 0; flex: 1; }
.tl-title { font-size: 12.5px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.tl-time { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.tl-empty { padding: 18px 14px; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* ── skin gallery ───────────────────────────────────────── */
.skin-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.skin-card { position: relative; display: flex; flex-direction: column; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; cursor: pointer; transition: border-color .2s ease, transform .18s ease, box-shadow .2s ease; }
.skin-card:hover { transform: translateY(-2px); border-color: var(--dsw-alias-border-l2); box-shadow: 0 10px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.skin-preview { position: relative; aspect-ratio: 16 / 10; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.skin-preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; transition: opacity .25s ease, transform .35s ease; }
.skin-card:hover .skin-preview img.shown { transform: scale(1.045); }
.skin-ph { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent), color-mix(in srgb, var(--suite-visual) 14%, transparent) 55%, color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent)); color: var(--dsw-alias-label-secondary); }
.skin-ph .ph-letter { font-size: 30px; font-weight: 700; color: var(--dsw-alias-label-primary); opacity: .75; }
.skin-ph .ph-text { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.skin-st { position: absolute; top: 7px; left: 7px; z-index: 2; }
.skin-themetoggle { position: absolute; right: 7px; bottom: 7px; z-index: 2; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent); color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform .15s ease, color .15s ease; }
.skin-themetoggle:hover { transform: scale(1.1); color: var(--dsw-alias-label-primary); }
.skin-body { padding: 9px 11px 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
.skin-name { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skin-en { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.skin-meta { display: flex; align-items: center; gap: 5px; margin-top: 2px; flex-wrap: wrap; }
.skin-origin { font-size: 10px; line-height: 1.2; padding: 2px 6px; border-radius: 999px; color: var(--dsw-alias-label-tertiary); border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.skin-license { font-size: 10px; line-height: 1.2; padding: 2px 6px; border-radius: 999px; color: var(--dsw-alias-label-tertiary); border: 1px dashed var(--dsw-alias-border-l2); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.skin-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.skin-actions .suite-btn { margin-right: auto; }
.skin-mutex { margin: 6px -11px -10px; padding: 5px 11px 6px; font-size: 10.5px; line-height: 1.45; color: var(--dsw-alias-state-warning-primary); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 10%, transparent); border-top: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 22%, transparent); }

/* ── drawer ─────────────────────────────────────────────── */
.suite-scrim { position: fixed; inset: 0; z-index: 55; background: rgba(0,0,0,.35); animation: suite-fade 200ms ease both; }
.suite-scrim.closing { animation: suite-fade 180ms ease both reverse; }
.suite-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 56; width: min(460px, 94vw); background: var(--dsw-alias-bg-layer-1); backdrop-filter: blur(30px) saturate(150%); -webkit-backdrop-filter: blur(30px) saturate(150%); border-left: 1px solid var(--dsw-alias-border-l1); box-shadow: -16px 0 40px rgba(0,0,0,.22); display: flex; flex-direction: column; animation: suite-drawer-in 280ms ${EASE} both; }
.suite-drawer.closing { animation: suite-drawer-out 200ms ease both; }
.drawer-head { display: flex; align-items: center; gap: 8px; padding: 13px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.drawer-head .dh-title { font-weight: 650; font-size: 13.5px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.drawer-body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 18px; }
.d-kv { display: grid; grid-template-columns: 76px 1fr; gap: 4px 10px; font-size: 12px; margin-bottom: 12px; }
.d-kv .k { color: var(--dsw-alias-label-tertiary); }
.d-kv .v { color: var(--dsw-alias-label-primary); min-width: 0; overflow-wrap: anywhere; }
.d-section-title { font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-secondary); margin: 14px 0 7px; }
.d-raw { margin-top: 8px; }
.d-raw summary { cursor: pointer; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); user-select: none; }
.d-raw pre { margin: 6px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; line-height: 1.5; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; overflow: auto; max-height: 180px; color: var(--dsw-alias-label-secondary); }
.prompt-box { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.55; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; max-height: 46vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); }
.d-notes { font-size: 11.5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; }
.d-compat { background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 35%, transparent); border-radius: 8px; padding: 8px 10px; }
.d-compat-badge { display: inline-block; font-size: 10px; font-weight: 600; color: var(--dsw-alias-state-warning-primary); margin-bottom: 4px; letter-spacing: .02em; }
.d-compat-text { font-size: 11.5px; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.d-foot { display: flex; align-items: center; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.d-foot .suite-btn { margin-right: auto; }
.copy-check { display: inline-flex; align-items: center; gap: 5px; }
.drawer-loading { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; padding: 18px 0; }
.drawer-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; padding: 14px 0; }

/* ── plugin groups / list ───────────────────────────────── */
.suite-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }
.suite-count { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; margin-right: auto; }
.suite-group { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); margin-bottom: 10px; overflow: hidden; }
.group-head { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 14px; border: none; background: var(--dsw-alias-bg-layer-1); color: inherit; cursor: pointer; text-align: left; transition: background .15s ease; }
.group-head:hover { background: var(--dsw-alias-bg-layer-2); }
.group-head .chev { flex: none; display: flex; transition: transform .2s ${EASE}; color: var(--dsw-alias-label-tertiary); }
.group-head.open .chev { transform: rotate(90deg); }
.group-head .g-name { font-weight: 650; font-size: 13px; }
.group-head .g-count { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.group-head .g-badge { font-size: 10.5px; line-height: 1; padding: 3px 8px; border-radius: 999px; color: var(--dsw-alias-state-warning-primary); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 11%, transparent); }
.group-head .g-spacer { flex: 1; }
.suite-list { display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l1); }
.suite-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l1); transition: background .15s ease; cursor: pointer; }
.suite-row:first-child { border-top: none; }
.suite-row:hover { background: var(--dsw-alias-bg-layer-2); }
.suite-row.checked { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent); }
.suite-row .main { flex: 1; min-width: 0; }
.suite-row .title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.suite-row .title { font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suite-row .desc { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suite-row .desc.en { color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 72%, transparent); font-size: 10.5px; }
.suite-row .side { flex: none; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.suite-check { flex: none; width: 15px; height: 15px; margin: 0; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }
.vp { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; font-variant-numeric: tabular-nums; }
.vp.hot { color: var(--dsw-alias-state-warning-primary); font-weight: 600; }

/* ── badge system: tier = what it is, status = where it stands ── */
.suite-badge { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; line-height: 1.2; border-radius: 999px; padding: 2.5px 8px; border: 1px solid transparent; white-space: nowrap; }
.suite-badge.tier { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.suite-badge.tier-core { color: var(--dsw-alias-state-business-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent); }
.suite-badge.tier-visual { color: var(--suite-visual); border-color: color-mix(in srgb, var(--suite-visual) 30%, transparent); background: color-mix(in srgb, var(--suite-visual) 9%, transparent); }
.suite-badge.tier-heavy { color: var(--dsw-alias-state-warning-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 28%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 9%, transparent); }
.suite-badge.ver { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; color: var(--dsw-alias-label-tertiary); border-color: var(--dsw-alias-border-l1); }
.suite-badge.st-installed { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 11%, transparent); }
.suite-badge.st-error { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); }
.skin-card.unsafe { outline: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, transparent); }
.suite-badge.st-disabled { color: var(--dsw-alias-label-tertiary); border-color: var(--dsw-alias-border-l2); }
.suite-badge.st-update { color: var(--dsw-alias-state-warning-primary); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 11%, transparent); }
.suite-badge.compat-fork { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); cursor: help; }
.suite-badge.compat-kernel { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); cursor: help; }
.suite-badge.st-missing { color: var(--dsw-alias-label-tertiary); border-style: dashed; border-color: var(--dsw-alias-border-l2); }

/* ── updates tab ────────────────────────────────────────── */
.up-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 13px 14px; margin-bottom: 10px; }
.up-card .up-head { display: flex; align-items: center; gap: 10px; }
.up-card .up-title { font-weight: 650; font-size: 13px; flex: 1; min-width: 0; }
.up-card .up-desc { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; margin-top: 1px; }
.up-grid { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 11px; }
.up-grid .lbl { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.suite-toggle { position: relative; flex: none; width: 40px; height: 22px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); cursor: pointer; padding: 0; transition: background .2s ease, border-color .2s ease; }
.suite-toggle .knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 25%, transparent); transition: transform 220ms ${EASE}; }
.suite-toggle.on { background: var(--dsw-alias-state-business-primary); border-color: transparent; }
.suite-toggle.on .knob { transform: translateX(18px); }
.suite-toggle.big { width: 46px; height: 25px; }
.suite-toggle.big .knob { width: 19px; height: 19px; }
.suite-toggle.big.on .knob { transform: translateX(21px); }
.suite-toggle:disabled { opacity: .45; cursor: not-allowed; }
.suite-toggle-row { display: flex; align-items: center; gap: 11px; padding: 7px 0; }
.suite-toggle-row + .suite-toggle-row { border-top: 1px solid var(--dsw-alias-border-l1); }
.suite-toggle-row .tr-main { flex: 1; min-width: 0; }
.suite-toggle-row .tr-title { font-size: 12.5px; font-weight: 550; }
.suite-toggle-row .tr-desc { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.suite-toggle-row.sub { padding-left: 14px; }
.suite-selwrap { position: relative; display: inline-flex; align-items: center; }
.suite-selwrap::after { content: ''; position: absolute; right: 11px; top: 50%; width: 6px; height: 6px; border-right: 1.5px solid var(--dsw-alias-label-tertiary); border-bottom: 1.5px solid var(--dsw-alias-label-tertiary); transform: translateY(-70%) rotate(45deg); pointer-events: none; }
.suite-select { appearance: none; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 26px 5px 10px; font-size: 12px; font-family: inherit; cursor: pointer; }
.suite-input { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-family: inherit; width: 100%; transition: border-color .18s ease, box-shadow .18s ease; }
.suite-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 15%, transparent); }
.up-adv { margin-top: 11px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 9px; }
.up-adv-toggle { display: inline-flex; align-items: center; gap: 5px; border: none; background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; cursor: pointer; padding: 2px 0; }
.up-adv-toggle:hover { color: var(--dsw-alias-label-primary); }
.up-adv-toggle .chev { display: flex; transition: transform .2s ${EASE}; }
.up-adv-toggle.open .chev { transform: rotate(90deg); }
.up-adv-body { margin-top: 9px; display: flex; flex-direction: column; gap: 6px; animation: suite-rise 200ms ease both; }
.up-adv-body .mirror-row { display: flex; gap: 8px; align-items: center; }
.up-adv-body .mirror-row .suite-input { flex: 1; min-width: 0; width: auto; }
.up-adv-body .mirror-row .suite-btn { flex: none; white-space: nowrap; }
.up-hint { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.save-flash { font-size: 11px; color: var(--dsw-alias-state-success-primary); animation: suite-rise 200ms ease both; }
.up-check-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.up-group-label { font-size: 11px; font-weight: 650; color: var(--dsw-alias-label-tertiary); letter-spacing: .3px; margin: 10px 0 4px; text-transform: uppercase; }
.ch-card .ch-line { display: flex; align-items: baseline; gap: 8px; font-size: 12px; flex-wrap: wrap; }
.ch-card .ch-line .k { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.ch-card .ch-notes { margin-top: 8px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; }
.suite-banner { display: flex; align-items: center; gap: 10px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 30%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 8%, transparent); border-radius: 12px; padding: 10px 13px; margin-bottom: 10px; animation: suite-rise 240ms ${EASE} both; }
.suite-banner .bn-icon { flex: none; color: var(--dsw-alias-state-warning-primary); display: flex; }
.suite-banner .bn-text { flex: 1; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-primary); }

/* ── progress panel ─────────────────────────────────────── */
.suite-progress { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 12px; padding: 9px 14px; margin-bottom: 12px; animation: suite-rise 240ms ${EASE} both; transition: box-shadow .2s ease; }
.suite-progress.sticky { position: sticky; top: 0; z-index: 20; box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); }
.suite-progress .line { display: flex; align-items: center; gap: 8px; }
.suite-progress .line b { font-weight: 600; }
.suite-progress .job-meta { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; font-variant-numeric: tabular-nums; }
.suite-progress .bar { height: 5px; margin-top: 8px; border-radius: 3px; background: var(--dsw-alias-bg-layer-3); overflow: hidden; }
.suite-progress .bar > i { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-state-business-primary); transform-origin: 0 50%; transform: scaleX(0); transition: transform .45s ${EASE}, background .3s ease; }
.suite-progress .bar > i.done-ok { background: var(--dsw-alias-state-success-primary); }
.suite-progress .bar > i.has-fail { background: var(--dsw-alias-state-error-primary); }
.suite-progress .snapshot { margin-top: 7px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.suite-progress .latest { display: flex; align-items: center; gap: 7px; margin-top: 8px; font-size: 12px; min-width: 0; }
.suite-progress .latest .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.suite-progress .latest.lv-start .dot { background: var(--dsw-alias-state-business-primary); }
.suite-progress .latest.lv-ok .dot { background: var(--dsw-alias-state-success-primary); }
.suite-progress .latest.lv-warn .dot { background: var(--dsw-alias-state-warning-primary); }
.suite-progress .latest.lv-fail .dot { background: var(--dsw-alias-state-error-primary); }
.suite-progress .latest.lv-done .dot { background: var(--dsw-alias-state-success-primary); }
.suite-progress .latest.lv-warn { color: var(--dsw-alias-state-warning-primary); }
.suite-progress .latest.lv-fail { color: var(--dsw-alias-state-error-primary); }
.suite-progress .latest .txt { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.suite-progress .log { margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; max-height: 190px; overflow: auto; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.suite-progress .log .t { color: var(--dsw-alias-label-tertiary); }
.suite-progress .log .ok { color: var(--dsw-alias-state-success-primary); }
.suite-progress .log .warn { color: var(--dsw-alias-state-warning-primary); }
.suite-progress .log .fail { color: var(--dsw-alias-state-error-primary); }
.suite-progress .log .start { color: var(--dsw-alias-state-business-primary); }
.suite-progress .log .dim { color: var(--dsw-alias-label-tertiary); }
.done-check { color: var(--dsw-alias-state-success-primary); }
.done-check.bad { color: var(--dsw-alias-state-error-primary); }
.done-check .dc-circle { stroke-dasharray: 63; stroke-dashoffset: 63; animation: suite-draw 450ms ease-out forwards; }
.done-check .dc-mark { stroke-dasharray: 20; stroke-dashoffset: 20; animation: suite-draw 300ms 340ms ${EASE} forwards; }

/* ── skeleton / error / empty ───────────────────────────── */
.suite-skel { position: relative; overflow: hidden; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.suite-skel::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent), transparent); animation: suite-sweep 1.4s ease-in-out infinite; }
.suite-skel.seg { display: inline-block; width: 300px; height: 30px; border-radius: 11px; margin-bottom: 12px; }
.suite-errbox { border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent); border-radius: 12px; padding: 22px 18px; text-align: center; animation: suite-rise 240ms ${EASE} both; }
.suite-errbox .big { margin-bottom: 8px; }
.suite-errbox .err-title { font-weight: 650; color: var(--dsw-alias-state-error-primary); }
.suite-errbox .err-detail { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.suite-errbox .err-hint { margin-top: 6px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.suite-errbox .suite-btn { margin-top: 14px; }
.suite-empty { border: 1.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; padding: 30px 18px; text-align: center; color: var(--dsw-alias-label-tertiary); animation: suite-rise 240ms ${EASE} both; }
.suite-empty .empty-title { color: var(--dsw-alias-label-secondary); font-weight: 550; }
.suite-empty .empty-hint { margin-top: 4px; font-size: 11.5px; }

.suite-note { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; margin-top: 10px; }
.suite-spin { width: 12px; height: 12px; flex: none; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-state-business-primary); animation: suite-spin .8s linear infinite; }
.suite-spin.sm { width: 10px; height: 10px; }
.suite-idledot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-border-l2); }

@keyframes suite-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
@keyframes suite-view { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }
@keyframes suite-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes suite-drawer-in { from { opacity: .4; transform: translateX(100%); } to { opacity: 1; transform: none; } }
@keyframes suite-drawer-out { from { opacity: 1; transform: none; } to { opacity: .4; transform: translateX(100%); } }
@keyframes suite-sweep { to { transform: translateX(100%); } }
@keyframes suite-spin { to { transform: rotate(360deg); } }
@keyframes suite-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .75; } }
@keyframes suite-draw { to { stroke-dashoffset: 0; } }
@media (prefers-reduced-motion: reduce) {
  .suite-root *, .suite-root *::after, .suite-root *::before {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`

    // ── icons (stroke follows currentColor) ───────────────────────────────────
    const I = (props, ...kids) => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, ...props }, ...kids)
    const Icon = {
      error: () => I({ className: 'big', width: 26, height: 26 },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', 'stroke-width': 1.6 }),
        h('path', { d: 'M12 7.5v5.5', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
        h('circle', { cx: 12, cy: 16.4, r: 1.05, fill: 'currentColor' })),
      empty: () => I({ className: 'big', width: 26, height: 26 },
        h('path', { d: 'M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        h('path', { d: 'M4 7.5 12 11l8-3.5M12 11v9', stroke: 'currentColor', 'stroke-width': 1.2, opacity: .55 })),
      layers: () => I({ width: 18, height: 18 },
        h('path', { d: 'M12 3.5 21 8l-9 4.5L3 8l9-4.5Z', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        h('path', { d: 'm4.5 12.5 7.5 3.8 7.5-3.8M4.5 16.5l7.5 3.8 7.5-3.8', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: .65 })),
      box: () => I({ width: 18, height: 18 },
        h('rect', { x: 4, y: 5.5, width: 16, height: 13, rx: 2.2, stroke: 'currentColor', 'stroke-width': 1.6 }),
        h('path', { d: 'M4 10h16M10.5 10v8.5', stroke: 'currentColor', 'stroke-width': 1.4, opacity: .7 })),
      palette: () => I({ width: 18, height: 18 },
        h('path', { d: 'M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.9 0-1.4-1.1-1.8-1.1-3 0-1 .8-1.8 2-1.8h1.8c2.3 0 3.8-1.6 3.8-3.9C20.5 6.3 16.7 3.5 12 3.5Z', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }),
        h('circle', { cx: 8, cy: 9.4, r: 1.15, fill: 'currentColor', opacity: .8 }),
        h('circle', { cx: 12.4, cy: 7.4, r: 1.15, fill: 'currentColor', opacity: .8 })),
      refresh: () => I({ width: 13, height: 13 },
        h('path', { d: 'M20 12a8 8 0 1 1-2.4-5.7M20 3.5V8h-4.5', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
      chev: () => I({ width: 13, height: 13, className: 'chev' },
        h('path', { d: 'm9.5 6 6 6-6 6', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
      close: () => I({ width: 14, height: 14 },
        h('path', { d: 'm6.5 6.5 11 11m0-11-11 11', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' })),
      copy: () => I({ width: 13, height: 13 },
        h('rect', { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2, stroke: 'currentColor', 'stroke-width': 1.6 }),
        h('path', { d: 'M15.5 5.5v-1a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1', stroke: 'currentColor', 'stroke-width': 1.6, transform: 'translate(1.5 1.5)' })),
      sun: () => I({ width: 12, height: 12 },
        h('circle', { cx: 12, cy: 12, r: 4.2, stroke: 'currentColor', 'stroke-width': 1.7 }),
        h('path', { d: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round' })),
      moon: () => I({ width: 12, height: 12 },
        h('path', { d: 'M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round' })),
      download: () => I({ width: 14, height: 14 },
        h('path', { d: 'M12 4v10m0 0 4-4m-4 4-4-4M5 19h14', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
      external: () => I({ width: 12, height: 12 },
        h('path', { d: 'M14 5h5v5M19 5l-8 8M10 5H6a1.5 1.5 0 0 0-1.5 1.5V18A1.5 1.5 0 0 0 6 19.5h11.5A1.5 1.5 0 0 0 19 18v-4', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
      warn: () => I({ width: 16, height: 16 },
        h('path', { d: 'M12 4 2.8 19.5h18.4L12 4Z', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round' }),
        h('path', { d: 'M12 10v4', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round' }),
        h('circle', { cx: 12, cy: 16.8, r: 1, fill: 'currentColor' })),
      checkDone: () => h('svg', { className: 'done-check', width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('circle', { className: 'dc-circle', cx: 12, cy: 12, r: 10, stroke: 'currentColor', 'stroke-width': 2 }),
        h('path', { className: 'dc-mark', d: 'M7.2 12.4l3.1 3.1 6.5-6.9', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
    }

    // ── helpers ───────────────────────────────────────────────────────────────
    const fmt = (tpl, vars) => String(tpl ?? '').replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''))

    async function api(path, options) {
      const res = await fetch(API + path, options)
      if (!res.ok) {
        let detail = ''
        try { detail = (await res.json())?.error ?? '' } catch { /* non-json */ }
        throw new Error(detail || `${res.status} ${res.statusText}`)
      }
      return res.json()
    }

    function statusOf(item) {
      if (!item) return 'missing'
      if (item.installed && item.updateAvailable) return 'update'
      if (item.installed && item.enabled !== false) return 'installed'
      if (item.installed) return 'disabled'
      return 'missing'
    }

    const STATUS_BADGE = {
      installed: { cls: 'st-installed', key: 'status.installed' },
      disabled: { cls: 'st-disabled', key: 'status.disabled' },
      update: { cls: 'st-update', key: 'status.update' },
      missing: { cls: 'st-missing', key: 'status.missing' },
    }
    const GALLERY_BADGE = {
      installed: { cls: 'st-installed', key: 'gallery.installed' },
      disabled: { cls: 'st-disabled', key: 'gallery.disabled' },
      missing: { cls: 'st-missing', key: 'gallery.missing' },
    }

    const POST_JSON = (body) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })

    function timeStr(ts) {
      try { return new Date(ts).toLocaleString() } catch { return '' }
    }

    // ── hooks ─────────────────────────────────────────────────────────────────
    const REDUCED = () => {
      try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
    }

    /** rAF count-up with cubic ease-out; snaps instantly under reduced motion. */
    function useCountUp(target, duration = 650) {
      const [val, setVal] = useState(0)
      const fromRef = useRef(0)
      useEffect(() => {
        const to = Number(target) || 0
        const from = fromRef.current
        if (from === to) { setVal(to); return }
        if (REDUCED()) { fromRef.current = to; setVal(to); return }
        let raf
        const t0 = performance.now()
        const tick = now => {
          const p = Math.min(1, (now - t0) / duration)
          const eased = 1 - Math.pow(1 - p, 3)
          setVal(Math.round(from + (to - from) * eased))
          if (p < 1) raf = requestAnimationFrame(tick)
          else fromRef.current = to
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [target, duration])
      return val
    }

    // ── small shared components ───────────────────────────────────────────────
    function Skel() {
      return h(Fragment, null,
        h('div', { className: 'suite-cards' },
          [0, 1, 2].map(i => h('div', { key: i, className: 'suite-skel', style: { height: 132, animationDelay: `${i * 80}ms`, animation: `suite-rise 240ms ${EASE} both` } }))),
        h('div', { className: 'suite-skel seg' }),
        h('div', { className: 'suite-list', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12 } },
          [0, 1, 2, 3, 4, 5].map(i => h('div', { key: i, className: 'suite-skel suite-row', style: { height: 48, animationDelay: `${i * 60}ms` } }))),
      )
    }

    function TierBadge({ tier, t }) {
      const key = 'tier.' + (tier ?? 'core')
      return h('span', { className: 'suite-badge tier tier-' + (tier ?? 'core') }, t(key))
    }

    /** Issue #1: entries the suite must not install/enable on the official kernel. */
    function CompatBadge({ item, t }) {
      if (item?.compat === 'eac-fork') return h('span', { className: 'suite-badge compat-fork', title: t('compat.eacForkTip') }, t('compat.eacFork'))
      if (item?.kernelProvided) return h('span', { className: 'suite-badge compat-kernel', title: t('compat.kernelTip') }, t('compat.kernelProvided'))
      return null
    }

    /** Selection + updates are pointless (and blocked host-side) for these. */
    const isCompatLocked = item => item?.compat === 'eac-fork' || item?.kernelProvided

    function StatusBadge({ st, t, map = STATUS_BADGE }) {
      const b = map[st] ?? map.missing
      return h('span', { className: 'suite-badge ' + b.cls }, t(b.key))
    }

    function Toggle({ on, onChange, disabled, big, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': label,
        className: 'suite-toggle' + (on ? ' on' : '') + (big ? ' big' : ''),
        disabled, onClick: () => onChange(!on),
      }, h('span', { className: 'knob' }))
    }

    function ChannelPill({ phase, data, t }) {
      const state = data?.state
      const cls = phase === 'ready' && state === 'online' ? 'online' : 'offline'
      let text
      if (phase !== 'ready') text = t('channel.checking')
      else if (state === 'online') text = fmt(t('channel.online'), { n: data.channelVersion ?? '?' })
      else text = t(state === 'never' ? 'channel.never' : 'channel.offline')
      return h('span', { className: 'suite-pill ' + cls, title: data?.error || '' },
        phase !== 'ready'
          ? h('span', { className: 'suite-spin sm', role: 'status' })
          : h('span', { className: 'dot' }),
        text)
    }

    function SegNav({ tabs, active, onChange, t }) {
      const btnRefs = useRef([])
      const [ind, setInd] = useState({ x: 0, w: 0, ready: false })
      const measure = useCallback(() => {
        const i = tabs.findIndex(tb => tb.id === active)
        const el = btnRefs.current[i]
        if (el) setInd(prev => ({ x: el.offsetLeft, w: el.offsetWidth, ready: true }))
      }, [tabs, active])
      useLayoutEffect(() => { measure() }, [measure])
      useEffect(() => {
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [measure])
      return h('div', { className: 'suite-seg', role: 'tablist' },
        h('span', { className: 'suite-seg-ind' + (ind.ready ? ' ready' : ''), style: { transform: `translateX(${ind.x}px)`, width: ind.w || 0 }, 'aria-hidden': true }),
        tabs.map((tb, i) => h('button', {
          key: tb.id,
          ref: el => { btnRefs.current[i] = el },
          type: 'button', role: 'tab', 'aria-selected': active === tb.id, 'data-tab': tb.id,
          className: 'suite-seg-btn' + (active === tb.id ? ' on' : ''),
          onClick: () => onChange(tb.id),
        }, t(tb.label))),
      )
    }

    function Ring({ pct, size = 54, stroke = 5 }) {
      const r = (size - stroke) / 2
      const c = 2 * Math.PI * r
      const p = Math.max(0, Math.min(100, pct || 0))
      return h('svg', { className: 'suite-ring', width: size, height: size, viewBox: `0 0 ${size} ${size}` },
        h('circle', { className: 'ring-track', cx: size / 2, cy: size / 2, r, fill: 'none', strokeWidth: stroke }),
        h('circle', {
          className: 'ring-val' + (p >= 100 ? ' full' : ''), cx: size / 2, cy: size / 2, r, fill: 'none',
          strokeWidth: stroke, strokeLinecap: 'round', strokeDasharray: c, strokeDashoffset: c * (1 - p / 100),
          style: { transition: `stroke-dashoffset .7s ${EASE}` },
        }))
    }

    const PACK_ICON = { eac: Icon.layers, aio: Icon.box, skins: Icon.palette }

    function PackCard({ pack, index, onOpen, onInstall, onUpdateBadge, t, busy }) {
      const total = pack.items.length
      const installed = pack.items.filter(it => it.installed).length
      const updatable = pack.items.filter(it => it.updateAvailable).length
      const pct = total ? Math.round((installed / total) * 100) : 0
      const shown = useCountUp(installed)
      const IconCmp = PACK_ICON[pack.id] ?? Icon.box
      const isSkins = pack.id === 'skins'
      return h('div', { className: 'pack-card suite-rise', style: { '--i': index }, onClick: onOpen },
        h('div', { className: 'pack-head' },
          h('span', { className: 'pack-icon' + (isSkins ? ' alt' : '') }, h(IconCmp)),
          h('div', { className: 'pack-titles' },
            h('div', { className: 'pack-name' }, t('pack.' + pack.id)),
            h('div', { className: 'pack-hint' }, t('pack.' + pack.id + 'Hint'))),
          updatable > 0 && h('button', {
            type: 'button', className: 'pack-badge',
            title: t('pack.updateBadge', { n: updatable }),
            onClick: e => { e.stopPropagation(); onUpdateBadge() },
          }, fmt(t('pack.updateBadge'), { n: updatable }))),
        h('div', { className: 'pack-mid' },
          h('div', { className: 'ring-wrap' },
            h(Ring, { pct }),
            h('div', { className: 'ring-num' }, h('b', null, shown), h('span', null, '/' + total))),
          h('div', { className: 'pack-legend' },
            h('div', { className: 'lg-line' },
              h('span', null, fmt(t('installed'), { n: installed, m: total })),
              h('span', { className: 'lg-pct' }, pct + '%')),
            h('div', { className: 'lg-sub' }, fmt(t('defaultDisabled'), { n: pack.items.filter(i => i.defaultEnabled === false).length })))),
        h('div', { className: 'pack-foot' },
          total > 0 && installed < total
            ? h('button', {
                type: 'button', className: 'suite-btn primary', disabled: busy,
                onClick: e => { e.stopPropagation(); onInstall() },
              }, t('pack.installAll'))
            : h('button', { type: 'button', className: 'suite-btn ok', disabled: true }, t('pack.allInstalled')),
          h('button', {
            type: 'button', className: 'suite-btn ghost sm',
            onClick: e => { e.stopPropagation(); onOpen() },
          }, isSkins ? t('pack.goGallery') : t('pack.manage'))),
      )
    }

    /** Recent-activity timeline built from the SSE ring (job start/done pairs). */
    function Timeline({ events, t }) {
      const jobs = useMemo(() => {
        const byId = new Map()
        const list = []
        for (const e of events) {
          if (e.type === 'job-start') {
            const j = { jobId: e.jobId, type: e.jobType ?? 'install', pack: e.pack, ts: e.ts, doneTs: null, ok: null, failed: null }
            byId.set(e.jobId, j)
            list.push(j)
          } else if (e.type === 'job-done') {
            const j = byId.get(e.jobId)
            if (j) { j.doneTs = e.ts; j.ok = e.ok ?? 0; j.failed = e.failed ?? 0 }
          }
        }
        return list.slice(-5).reverse()
      }, [events])
      return h('div', null,
        h('div', { className: 'suite-section-title' }, t('activity.title')),
        h('div', { className: 'suite-timeline' },
          jobs.length === 0
            ? h('div', { className: 'tl-empty' }, t('activity.empty'))
            : jobs.map((j, i) => {
                const running = !j.doneTs
                const failed = (j.failed ?? 0) > 0
                const packLabel = j.pack ? t('pack.' + j.pack) : ''
                return h('div', { key: j.jobId, className: 'tl-item suite-rise', style: { '--i': i } },
                  h('span', { className: 'tl-dot ' + (running ? '' : failed ? 'bad' : 'ok') }),
                  h('div', { className: 'tl-main' },
                    h('div', { className: 'tl-title' },
                      t('job.' + (j.type ?? 'install')) + (packLabel ? ' · ' + packLabel : '')),
                    h('div', { className: 'tl-sub' }, running
                      ? t('activity.running')
                      : fmt(t('activity.okFailed'), { ok: j.ok, failed: j.failed }))),
                  h('span', { className: 'tl-time' }, timeStr(j.doneTs ?? j.ts)))
              })),
      )
    }

    // ── skin gallery ──────────────────────────────────────────────────────────
    // <img src> hits the dsh-app:// protocol directly, which the shell does not
    // proxy to the plugin API — load preview bytes through fetch (which IS
    // proxied) and hand the <img> an object URL instead.
    function usePreviewUrls(skin) {
      const [urls, setUrls] = useState({})
      useEffect(() => {
        let alive = true
        const created = []
        const next = {}
        const keys = ['light', 'dark'].filter(k => skin.previews?.[k])
        setUrls({})
        Promise.all(keys.map(k =>
          fetch(`${API}/asset/${skin.previews[k]}`)
            .then(r => (r.ok ? r.blob() : null))
            .then(b => {
              if (!b) return
              const u = URL.createObjectURL(b)
              created.push(u)
              next[k] = u
            })
            .catch(() => {}),
        )).then(() => { if (alive) setUrls(next) })
        return () => {
          alive = false
          for (const u of created) URL.revokeObjectURL(u)
        }
      }, [skin.id])
      return urls
    }

    function PreviewBox({ skin, t }) {
      const [pinned, setPinned] = useState('light')
      const [hover, setHover] = useState(false)
      const [failed, setFailed] = useState({})
      const urls = usePreviewUrls(skin)
      const lightOk = Boolean(urls.light) && !failed.light
      const darkOk = Boolean(urls.dark) && !failed.dark
      let shown = hover ? (pinned === 'light' ? 'dark' : 'light') : pinned
      if (!lightOk) shown = 'dark' // degrade gracefully when one theme is missing
      if (!darkOk) shown = 'light'
      const onErr = key => setFailed(prev => ({ ...prev, [key]: true }))
      const letter = (skin.nameEn || skin.name || '?').trim().charAt(0).toUpperCase()
      if (!lightOk && !darkOk) {
        return h('div', { className: 'skin-preview' },
          h('div', { className: 'skin-ph' },
            h('span', { className: 'ph-letter' }, letter),
            h('span', { className: 'ph-text' }, t('gallery.noPreview'))))
      }
      return h('div', { className: 'skin-preview', onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) },
        lightOk && h('img', {
          src: urls.light, alt: t('gallery.previewLight'), draggable: false,
          className: shown === 'light' ? 'shown' : '',
          style: { opacity: shown === 'light' ? 1 : 0 },
          onError: () => onErr('light'),
        }),
        darkOk && h('img', {
          src: urls.dark, alt: t('gallery.previewDark'), draggable: false,
          className: shown === 'dark' ? 'shown' : '',
          style: { opacity: shown === 'dark' ? 1 : 0 },
          onError: () => onErr('dark'),
        }),
        h('button', {
          type: 'button', className: 'skin-themetoggle',
          title: shown === 'light' ? t('gallery.previewDark') : t('gallery.previewLight'),
          onClick: e => { e.stopPropagation(); setPinned(p => (p === 'light' ? 'dark' : 'light')) },
        }, shown === 'light' ? h(Icon.sun) : h(Icon.moon)))
    }

    function SkinCard({ skin, entry, index, busy, onOpen, onAction, t }) {
      const st = statusOf(entry)
      const stKey = GALLERY_BADGE[st]?.key ?? 'gallery.missing'
      const working = busy.has(skin.id)
      const unsafe = skin.unsafe === true && st !== 'missing'
      const action = st === 'missing' ? 'install' : st === 'disabled' ? 'enable' : st === 'update' ? 'update' : null
      const actionLabel = st === 'missing' ? t('gallery.install') : st === 'disabled' ? t('gallery.enable') : st === 'update' ? t('row.update') : null
      return h('div', { className: 'skin-card suite-rise' + (unsafe ? ' unsafe' : ''), style: { '--i': index % 12 }, 'data-skin-id': skin.id, onClick: () => onOpen(skin) },
        h('div', { style: { position: 'relative' } },
          h(PreviewBox, { skin, t }),
          h('span', { className: 'skin-st' }, unsafe
            ? h('span', { className: 'suite-badge st-error' }, t('gallery.unsafe'))
            : h(StatusBadge, { st, t, map: GALLERY_BADGE }))),
        h('div', { className: 'skin-body' },
          h('div', { className: 'skin-name', title: skin.name }, skin.name || skin.id),
          h('div', { className: 'skin-en' }, [skin.nameEn, skin.author && `${t('gallery.author')}: ${skin.author}`].filter(Boolean).join(' · ')),
          h('div', { className: 'skin-meta' },
            h('span', { className: 'skin-origin' }, t(skin.origin === 'community' ? 'gallery.originCommunity' : 'gallery.originBuiltin')),
            skin.license && h('span', { className: 'skin-license' }, skin.license)),
          unsafe
            ? h('div', { className: 'skin-actions' },
                h('button', {
                  type: 'button', className: 'suite-btn ghost sm', disabled: true,
                  title: t('gallery.unsafeTitle'),
                }, t('gallery.unsafeBtn')))
            : action
              ? h('div', { className: 'skin-actions' },
                  h('button', {
                    type: 'button', className: 'suite-btn primary sm', disabled: working,
                    onClick: e => { e.stopPropagation(); onAction(skin, action) },
                  }, working ? t('working') : actionLabel))
              : h('div', { className: 'skin-actions' },
                  h('span', { className: 'suite-badge st-installed' }, t(stKey)),
                  h('button', {
                    type: 'button', className: 'suite-btn ghost sm', disabled: working,
                    title: t('gallery.disable'),
                    onClick: e => { e.stopPropagation(); onAction(skin, 'disable') },
                  }, t('gallery.disable'))),
          (skin.mutexZh || skin.mutexEn) && h('div', { className: 'skin-mutex' }, skin.mutexZh || skin.mutexEn)),
      )
    }

    function SkinDrawer({ skin, detail, closing, onClose, t }) {
      const [copied, setCopied] = useState(false)
      useEffect(() => {
        if (!skin) return
        const onKey = e => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [skin, onClose])
      if (!skin) return null
      const promptText = detail?.data?.prompt ?? null
      const manifest = detail?.data?.manifest ?? null
      const copy = async () => {
        if (!promptText) return
        let ok = false
        try {
          if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(promptText); ok = true }
          else {
            const ta = document.createElement('textarea')
            ta.value = promptText
            ta.style.position = 'fixed'; ta.style.opacity = '0'
            document.body.appendChild(ta); ta.select()
            ok = document.execCommand('copy')
            ta.remove()
          }
        } catch { ok = false }
        setCopied(ok ? 'ok' : 'fail')
        setTimeout(() => setCopied(false), 1600)
      }
      const kv = []
      if (manifest?.name) kv.push(['name', manifest.name])
      if (manifest?.version) kv.push(['version', manifest.version])
      if (skin.author) kv.push([t('gallery.author'), skin.author])
      if (manifest?.license || skin.license) kv.push(['license', manifest?.license ?? skin.license])
      kv.push(['origin', t(skin.origin === 'community' ? 'gallery.originCommunity' : 'gallery.originBuiltin')])
      if (manifest?.description) kv.push(['description', manifest.description])
      return h(Fragment, null,
        h('div', { className: 'suite-scrim' + (closing ? ' closing' : ''), onClick: onClose }),
        h('aside', { className: 'suite-drawer' + (closing ? ' closing' : ''), role: 'dialog', 'aria-label': t('gallery.drawerTitle') },
          h('div', { className: 'drawer-head' },
            h('span', { className: 'dh-title' }, `${t('gallery.drawerTitle')} · ${skin.name ?? skin.id}`),
            h('button', { type: 'button', className: 'suite-btn icon ghost', 'aria-label': t('gallery.close'), onClick: onClose }, h(Icon.close))),
          h('div', { className: 'drawer-body' },
            h('div', { className: 'd-section-title', style: { marginTop: 0 } }, t('gallery.manifest')),
            h('div', { className: 'd-kv' },
              kv.map(([k, v]) => h(Fragment, { key: k }, h('span', { className: 'k' }, k), h('span', { className: 'v' }, String(v))))),
            manifest && h('details', { className: 'd-raw' },
              h('summary', null, t('gallery.manifestRaw')),
              h('pre', null, JSON.stringify(manifest, null, 2))),
            (skin.compatZh || skin.compatEn) && h('div', { className: 'd-compat' },
              h('div', { className: 'd-compat-badge' }, t('gallery.compat')),
              h('div', { className: 'd-compat-text' }, skin.compatZh || skin.compatEn)),
            (skin.notesZh || skin.notesEn) && h(Fragment, null,
              h('div', { className: 'd-section-title' }, t('gallery.notes')),
              h('div', { className: 'd-notes' }, skin.notesZh || skin.notesEn)),
            h('div', { className: 'd-section-title' }, t('gallery.prompt')),
            detail?.phase === 'loading' && h('div', { className: 'drawer-loading' }, h('span', { className: 'suite-spin sm' }), t('gallery.loadingPrompt')),
            detail?.phase === 'error' && h('div', { className: 'drawer-err' }, t('gallery.promptFailed')),
            detail?.phase === 'ready' && (promptText
              ? h('div', { className: 'prompt-box' }, promptText)
              : h('div', { className: 'drawer-loading' }, t('gallery.promptEmpty')))),
          h('div', { className: 'd-foot' },
            h('button', {
              type: 'button', className: 'suite-btn primary', disabled: !promptText || detail?.phase !== 'ready',
              onClick: copy,
            }, copied === 'ok'
              ? h('span', { className: 'copy-check' }, h(Icon.checkDone), t('gallery.copied'))
              : copied === 'fail' ? t('gallery.copyFailed') : t('gallery.copyPrompt'))),
        ))
    }

    // ── plugins tab ───────────────────────────────────────────────────────────
    function PluginRow({ item, index, checked, onCheck, onUpdate, t, busy }) {
      const st = statusOf(item)
      const badge = STATUS_BADGE[st]
      const locked = isCompatLocked(item)
      return h('label', {
        className: 'suite-row suite-rise' + (checked ? ' checked' : ''),
        style: { '--i': Math.min(index, 11) },
      },
        h('input', {
          type: 'checkbox', className: 'suite-check', checked,
          disabled: locked,
          onChange: e => onCheck(item.id, e.target.checked),
        }),
        h('div', { className: 'main' },
          h('div', { className: 'title-line' },
            h('span', { className: 'title', title: item.name }, item.titleZh || item.name),
            h(TierBadge, { tier: item.tier, t }),
            h(CompatBadge, { item, t })),
          h('div', { className: 'desc' }, item.descZh || item.name),
          item.descEn && h('div', { className: 'desc en' }, item.descEn)),
        h('div', { className: 'side' },
          item.installedVersion && item.updateAvailable && h('span', { className: 'vp hot' },
            fmt(t('versionPair'), { a: item.installedVersion, b: item.version })),
          item.installedVersion && !item.updateAvailable && h('span', { className: 'suite-badge ver' }, item.installedVersion),
          h(StatusBadge, { st, t }),
          st === 'update' && !locked && h('button', {
            type: 'button', className: 'suite-btn sm', disabled: busy,
            onClick: e => { e.preventDefault(); e.stopPropagation(); onUpdate(item) },
          }, t('row.update'))),
      )
    }

    function PluginGroup({ pack, open, onToggle, checked, onCheck, onUpdateRow, onInstallPack, t, busy }) {
      const items = pack.items
      const installed = items.filter(i => i.installed).length
      const updatable = items.filter(i => i.updateAvailable).length
      return h('div', { className: 'suite-group' },
        h('button', {
          type: 'button', className: 'group-head' + (open ? ' open' : ''), onClick: onToggle,
          'aria-expanded': open,
        },
          h('span', { className: 'chev' }, h(Icon.chev)),
          h('span', { className: 'g-name' }, t('pack.' + pack.id)),
          h('span', { className: 'g-count' }, fmt(t('group.count'), { total: items.length, done: installed })),
          updatable > 0 && h('span', { className: 'g-badge' }, fmt(t('group.updatable'), { n: updatable })),
          h('span', { className: 'g-spacer' }),
          h('button', {
            type: 'button', className: 'suite-btn sm', disabled: busy || !items.length,
            onClick: e => { e.stopPropagation(); onInstallPack() },
          }, t('pack.installAll'))),
        open && (items.length === 0
          ? h('div', { className: 'tl-empty' }, t('empty.title'))
          : h('div', { className: 'suite-list' },
              items.map((item, i) => h(PluginRow, {
                key: item.id, item, index: i, checked: checked.has(item.id),
                onCheck, onUpdate: onUpdateRow, t, busy,
              })))),
      )
    }

    // ── updates tab ───────────────────────────────────────────────────────────
    function UpdatesTab({ channel, form, setForm, saveState, onSaveConfig, onApply, checked, setChecked, t, busy }) {
      const data = channel.data ?? {}
      const [advOpen, setAdvOpen] = useState(false)
      const updates = Array.isArray(data.updates) ? data.updates : []
      const installedUp = updates.filter(u => u.installed)
      const availableUp = updates.filter(u => !u.installed)
      const selCount = checked.size
      const selHasHeavy = updates.some(u => checked.has(u.id) && u.tier === 'heavy')
      const toggleRow = (id, on) => setChecked(prev => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })
      const updateRow = (u, isInstalled) => h('label', {
        key: u.id, className: 'suite-row suite-rise', style: { '--i': Math.min(index_of(updates, u), 11) },
      },
        h('input', {
          type: 'checkbox', className: 'suite-check', checked: checked.has(u.id),
          disabled: isCompatLocked(u),
          onChange: e => toggleRow(u.id, e.target.checked),
        }),
        h('div', { className: 'main' },
          h('div', { className: 'title-line' },
            h('span', { className: 'title' }, u.titleZh || u.name),
            h(TierBadge, { tier: u.tier, t }),
            h(CompatBadge, { item: u, t })),
          h('div', { className: 'desc' }, u.titleEn || u.name)),
        h('div', { className: 'side' },
          isInstalled
            ? h('span', { className: 'vp hot' }, fmt(t('versionPair'), { a: u.installedVersion ?? '?', b: u.channelVersion ?? '?' }))
            : h('span', { className: 'suite-badge ver' }, `new · v${u.channelVersion ?? '?'}`),
          h(StatusBadge, { st: isInstalled ? 'update' : 'missing', t })),
      )
      const saving = saveState === 'saving'
      return h('div', null,
        data.suiteUpdate && h('div', { className: 'suite-banner' },
          h('span', { className: 'bn-icon' }, h(Icon.warn)),
          h('span', { className: 'bn-text' }, fmt(t('updates.suiteBanner'), { v: data.suiteUpdate.version ?? '?' })),
          data.suiteUpdate.downloadUrl && h('a', {
            className: 'suite-btn', href: data.suiteUpdate.downloadUrl, target: '_blank', rel: 'noreferrer',
          }, t('updates.suiteDownload'), ' ', h(Icon.external))),
        h('div', { className: 'up-card suite-rise', style: { '--i': 0 } },
          h('div', { className: 'suite-toggle-row', style: { paddingTop: 0 } },
            h('div', { className: 'tr-main' },
              h('div', { className: 'tr-title' }, t('updates.autoUpdate')),
              h('div', { className: 'tr-desc' }, t('updates.autoUpdateDesc'))),
            h(Toggle, {
              big: true, on: !!form.autoUpdate, disabled: saving || !form._ready,
              label: t('updates.autoUpdate'),
              onChange: v => setForm(f => ({ ...f, autoUpdate: v, _dirty: true })),
            })),
          h('div', { className: 'suite-toggle-row sub' },
            h('div', { className: 'tr-main' },
              h('div', { className: 'tr-title' }, t('updates.autoUpdateHeavy')),
              h('div', { className: 'tr-desc' }, t('updates.autoUpdateHeavyDesc'))),
            h(Toggle, {
              on: !!form.autoUpdateHeavy, disabled: saving || !form._ready || !form.autoUpdate,
              label: t('updates.autoUpdateHeavy'),
              onChange: v => setForm(f => ({ ...f, autoUpdateHeavy: v, _dirty: true })),
            })),
          h('div', { className: 'up-grid' },
            h('span', { className: 'lbl' }, t('updates.interval')),
            h('span', { className: 'suite-selwrap' },
              h('select', {
                className: 'suite-select', value: String(form.intervalHours ?? 6), disabled: saving,
                onChange: e => setForm(f => ({ ...f, intervalHours: Number(e.target.value), _dirty: true })),
              }, [1, 6, 12, 24].map(n => h('option', { key: n, value: String(n) }, fmt(t('updates.intervalUnit'), { n }))))),
            (form._dirty || form._everDirty) && h('button', {
              type: 'button', className: 'suite-btn primary sm', disabled: saving,
              onClick: () => onSaveConfig(),
            }, saving ? t('updates.saving') : t('updates.save')),
            saveState === 'saved' && h('span', { className: 'save-flash' }, t('updates.saved'))),
          h('div', { className: 'up-adv' },
            h('button', {
              type: 'button', className: 'up-adv-toggle' + (advOpen ? ' open' : ''),
              onClick: () => setAdvOpen(o => !o), 'aria-expanded': advOpen,
            }, h('span', { className: 'chev' }, h(Icon.chev)), t('updates.advanced')),
            advOpen && h('div', { className: 'up-adv-body' },
              h('span', { className: 'lbl' }, t('updates.mirror')),
              h('div', { className: 'mirror-row' },
                h('input', {
                  className: 'suite-input', type: 'text', value: form.mirror ?? '',
                  placeholder: t('updates.mirrorPlaceholder'), disabled: saving, spellCheck: false,
                  onChange: e => setForm(f => ({ ...f, mirror: e.target.value, _dirty: true })),
                }),
                h('button', { type: 'button', className: 'suite-btn', disabled: saving, onClick: () => onSaveConfig() },
                  saving ? t('updates.saving') : t('updates.save'))),
              h('span', { className: 'up-hint' }, t('updates.mirrorHint'))))),
        h('div', { className: 'up-card suite-rise', style: { '--i': 1 } },
          h('div', { className: 'up-check-head' },
            h('div', { className: 'up-title' }, t('updates.listTitle')),
            updates.length > 0 && h(Fragment, null,
              h('button', { type: 'button', className: 'suite-btn sm', onClick: () => setChecked(new Set(updates.map(u => u.id))) }, t('selectAll')),
              h('button', {
                type: 'button', className: 'suite-btn primary sm', disabled: busy || selCount === 0,
                onClick: () => onApply(),
              }, fmt(t('updates.applySelected'), { n: selCount })))),
          updates.length === 0
            ? h('div', { className: 'tl-empty' }, t('updates.none'))
            : h(Fragment, null,
                selHasHeavy && h('div', { className: 'suite-notice warn' }, t('updates.includeHeavyNote')),
                installedUp.length > 0 && h('div', { className: 'up-group-label' }, t('updates.groupInstalled')),
                installedUp.map(u => updateRow(u, true)),
                availableUp.length > 0 && h('div', { className: 'up-group-label' }, t('updates.groupAvailable')),
                availableUp.map(u => updateRow(u, false)))),
        h('div', { className: 'up-card ch-card suite-rise', style: { '--i': 2 } },
          h('div', { className: 'up-title', style: { marginBottom: 6 } }, t('updates.channelCard')),
          data.state === 'offline'
            ? h('div', { className: 'drawer-err', style: { paddingTop: 0 } }, t('updates.loadFailed'))
            : h('div', { className: 'ch-line' },
                h('span', { className: 'k' }, fmt(t('updates.channelVersion'), { n: data.channelVersion ?? '?' })),
                data.channelGeneratedAt && h('span', { className: 'k' }, fmt(t('updates.generatedAt'), { time: timeStr(data.channelGeneratedAt) }))),
          !data.state && h('div', { className: 'ch-line' }, h('span', { className: 'k' }, t('updates.loadFailed'))),
          data.notesZh && h('div', { className: 'ch-notes' }, data.notesZh)),
      )
    }

    // tiny helper: index of an update entry inside the list (for stagger caps)
    function index_of(list, item) {
      return list.indexOf(item)
    }

    // ── progress panel ────────────────────────────────────────────────────────
    const STEP_LEVEL = {
      'step-start': { cls: 'lv-start', log: 'start', glyph: '>' },
      'step-ok': { cls: 'lv-ok', log: 'ok', glyph: 'v' },
      'step-warn': { cls: 'lv-warn', log: 'warn', glyph: '!' },
      'step-fail': { cls: 'lv-fail', log: 'fail', glyph: 'x' },
      'job-done': { cls: 'lv-done', log: 'ok', glyph: 'v' },
      'download-progress': { cls: 'lv-start', log: 'start', glyph: '~' },
    }

    function stepText(e, t) {
      if (e.type === 'job-done') return fmt(t('progress.done'), { ok: e.ok ?? 0, failed: e.failed ?? 0 })
      if (e.type === 'download-progress') return fmt(t('progress.download'), { id: e.id ?? '?', percent: e.percent ?? '?' })
      const who = e.name ? `${e.name}${e.version ? '@' + e.version : ''}` : e.id
      return [who, e.message].filter(Boolean).join(' — ')
    }

    function ProgressPanel({ events, job, t, open, onToggle }) {
      const logRef = useRef(null)
      useEffect(() => { if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [events, open])
      const lines = events.slice(-120)
      const last = useMemo(() => {
        for (let i = events.length - 1; i >= 0; i--) if (STEP_LEVEL[events[i].type]) return events[i]
        return null
      }, [events])
      // failures count for the latest job only (the ring keeps older jobs)
      // "already installed" warnings are the skip marker, not a failure — they
      // must not feed the error ring or the job-failure count in the header.
      const lastStartIdx = useMemo(() => {
        for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'job-start') return i
        return -1
      }, [events])
      const failedAny = useMemo(
        () => events.slice(lastStartIdx + 1).some(e => e.type === 'step-fail'
          && !(e.message && /already-installed/i.test(e.message))),
        [events, lastStartIdx])
      const lastIsDone = last?.type === 'job-done'
      const running = Boolean(job)
      return h('div', { className: 'suite-progress' + (running ? ' sticky' : '') },
        h('div', { className: 'line' },
          running
            ? h('span', { className: 'suite-spin' })
            : lastIsDone ? h('span', { className: 'done-check' + (failedAny ? ' bad' : '') }, h(Icon.checkDone)) : h('span', { className: 'suite-idledot' }),
          h('b', null, running
            ? `${t('progress.title')} · ${t('job.' + (job.type ?? 'install'))}${job.pack ? ' · ' + t('pack.' + job.pack) : ''}`
            : lastIsDone
              ? fmt(t('progress.done'), { ok: last.ok ?? 0, failed: last.failed ?? 0 })
              : t('progress.idle')),
          h('span', { className: 'job-meta' },
            running ? `${job.done}/${job.total} · ${job.pct ?? 0}%` : '',
            h('button', { type: 'button', className: 'suite-btn sm', onClick: onToggle }, open ? t('logHide') : t('logShow')))),
        (running || last) && h('div', { className: 'bar' },
          h('i', {
            className: (lastIsDone && !failedAny ? 'done-ok' : '') + (failedAny ? ' has-fail' : ''),
            style: { transform: `scaleX(${(running ? (job.pct ?? 0) : lastIsDone ? 100 : 0) / 100})` },
          })),
        job?.snapshot && h('div', { className: 'snapshot' }, fmt(t('snapshot'), { name: job.snapshot })),
        !job && last?.type === 'job-done' && last.snapshot && h('div', { className: 'snapshot' }, fmt(t('snapshot'), { name: last.snapshot })),
        last && h('div', { className: 'latest ' + STEP_LEVEL[last.type].cls },
          h('span', { className: 'dot' }),
          h('span', { className: 'txt' }, stepText(last, t))),
        open && h('div', { className: 'log', ref: logRef },
          lines.length === 0 ? h('span', { className: 'dim' }, t('log.empty')) : lines.map((e, i) => {
            const lv = STEP_LEVEL[e.type] ?? { log: 'dim', glyph: '.' }
            const time = new Date(e.ts).toLocaleTimeString()
            const body = [e.id && `${e.id}${e.version ? '@' + e.version : ''}`, e.message, e.pack && `pack=${e.pack}`, e.snapshot && fmt(t('snapshot'), { name: e.snapshot })].filter(Boolean).join(' ')
            return h('div', { key: i, className: lv.log }, `[${time}] ${lv.glyph} ${e.type} ${body}`)
          })),
      )
    }

    function ResourcesPanel({ resources, t, onRetry }) {
      if (!resources) return null
      const failed = resources.state === 'failed' || resources.state === 'cancelled'
      const percent = resources.totalBytes ? Math.min(100, Math.round(resources.receivedBytes / resources.totalBytes * 100)) : 0
      const mb = bytes => (Number(bytes ?? 0) / 1000000).toFixed(1)
      return h('section', { className: 'suite-notice suite-resources ' + (failed ? 'warn' : ''), 'data-testid': 'resources' },
        h('div', { role: 'status', 'aria-live': 'polite' },
          h('strong', null, t('resources.' + resources.state)),
          ' · ' + resources.completed + '/' + resources.total + ' · ' + mb(resources.receivedBytes) + '/' + mb(resources.totalBytes) + ' MB'),
        resources.state !== 'ready' && h('progress', {
          value: percent, max: 100, 'aria-label': t('resources.title'),
          style: { display: 'block', width: '100%', margin: '8px 0', accentColor: 'var(--dsw-alias-brand-primary)' },
        }),
        resources.state !== 'ready' && h('div', null, t('resources.hint')),
        failed && h('div', { style: { overflowWrap: 'anywhere', marginTop: 6 } }, resources.error),
        failed && h('button', { type: 'button', className: 'suite-btn sm', style: { marginTop: 8 }, onClick: onRetry }, t('resources.retry')),
      )
    }

    // ── root tab ──────────────────────────────────────────────────────────────
    const TABS = [
      { id: 'overview', label: 'nav.overview' },
      { id: 'gallery', label: 'nav.gallery' },
      { id: 'plugins', label: 'nav.plugins' },
      { id: 'updates', label: 'nav.updates' },
    ]

    function SuiteTab() {
      const [state, setState] = useState({ phase: 'loading', data: null, error: null })
      const [channel, setChannel] = useState({ phase: 'loading', data: null })
      const [gallery, setGallery] = useState({ phase: 'idle', data: null, error: null })
      const [tab, setTab] = useState('overview')
      const [checked, setChecked] = useState(() => new Set())
      const [groupOpen, setGroupOpen] = useState({ eac: true, aio: true })
      const [events, setEvents] = useState([])
      const [job, setJob] = useState(null)
      const [confirmArm, setConfirmArm] = useState(false)
      const [notice, setNotice] = useState(null) // { kind: 'warn' | 'err', text }
      const [logOpen, setLogOpen] = useState(false)
      const [drawerId, setDrawerId] = useState(null)
      const [drawerClosing, setDrawerClosing] = useState(false)
      const [drawerDetail, setDrawerDetail] = useState({ phase: 'idle', data: null })
      const [skinBusy, setSkinBusy] = useState(() => new Set())
      const [upChecked, setUpChecked] = useState(() => new Set())
      const [saveState, setSaveState] = useState('idle') // idle | saving | saved
      const [form, setForm] = useState({ autoUpdate: false, autoUpdateHeavy: false, intervalHours: 6, mirror: '', _ready: false, _dirty: false })

      const load = useCallback(async () => {
        setState(s => ({ ...s, phase: 'loading' }))
        try {
          const data = await api('/status')
          setEvents(await api('/events-ring').then(r => r.events ?? []).catch(() => []))
          setState({ phase: 'ready', data, error: null })
        } catch (err) {
          setState({ phase: 'error', data: null, error: String(err.message ?? err) })
        }
      }, [])

      // channel status — a missing/failing endpoint degrades to the offline pill,
      // never to a full-screen error.
      const loadChannel = useCallback(async () => {
        try {
          const data = await api('/channel/status')
          setChannel({ phase: 'ready', data })
          setForm(f => f._ready && !f._dirty ? f : {
            autoUpdate: !!data.autoUpdate, autoUpdateHeavy: !!data.autoUpdateHeavy,
            intervalHours: Number(data.intervalHours ?? 6), mirror: data.mirror ?? '',
            _ready: true, _dirty: false,
          })
        } catch {
          setChannel(c => ({ phase: 'ready', data: c.data?.state ? c.data : { state: 'offline' } }))
        }
      }, [])

      const checkChannel = useCallback(async () => {
        setChannel(c => ({ ...c, phase: 'checking' }))
        try {
          const data = await api('/channel/check', POST_JSON())
          setChannel({ phase: 'ready', data })
          setForm(f => ({ ...f, autoUpdate: !!data.autoUpdate, autoUpdateHeavy: !!data.autoUpdateHeavy, intervalHours: Number(data.intervalHours ?? f.intervalHours ?? 6), mirror: data.mirror ?? '', _ready: true, _dirty: false }))
        } catch {
          setChannel(c => ({ phase: 'ready', data: { ...(c.data ?? {}), state: 'offline' } }))
          setNotice({ kind: 'warn', text: tr('channel.checkFailed') })
        }
      }, [])

      useEffect(() => { load(); loadChannel() }, [load, loadChannel])

      // gallery loads lazily on first visit
      const loadGallery = useCallback(async () => {
        setGallery(g => g.phase === 'ready' ? g : { ...g, phase: 'loading' })
        try {
          const data = await api('/skins/gallery')
          setGallery({ phase: 'ready', data, error: null })
        } catch (err) {
          setGallery(g => ({ ...g, phase: 'error', error: String(err.message ?? err) }))
        }
      }, [])
      useEffect(() => { if (tab === 'gallery') loadGallery() }, [tab, loadGallery])

      // live progress over SSE; the stream replays the recent ring on connect,
      // and dropped connections reconnect with backoff + ring catch-up.
      useEffect(() => {
        let es = null
        let timer = null
        let attempts = 0
        let disposed = false
        const seen = new Set()
        const onEvent = (msg) => {
          let e
          try { e = JSON.parse(msg.data) } catch { return }
          if (e.type === 'resources') {
            setState(s => ({ ...s, data: { ...(s.data ?? {}), resources: e.resources } }))
          } else if (e.type === 'job-start') {
            seen.clear()
            setJob({ type: e.jobType, pack: e.pack, total: e.total, done: 0, pct: 0, snapshot: e.snapshot })
            setEvents(prev => [...prev, e])
          } else if (e.type?.startsWith('step-') || e.type === 'download-progress') {
            setEvents(prev => [...prev.slice(-400), e])
            if (e.type?.startsWith('step-')) {
              setJob(j => {
                if (!j || e.type === 'step-warn') return j
                const done = j.done + (e.type === 'step-ok' || e.type === 'step-fail' ? 1 : 0)
                return { ...j, done, pct: j.total ? Math.round((done / j.total) * 100) : 0 }
              })
            }
          } else if (e.type === 'job-done') {
            setJob(j => (j ? { ...j, pct: 100 } : j))
            setEvents(prev => [...prev.slice(-400), e])
            setTimeout(() => {
              setJob(null)
              load()
              loadChannel()
            }, 900)
          } else if (e.type === 'channel') {
            setChannel(c => ({ phase: 'ready', data: { ...(c.data ?? {}), state: e.state, channelVersion: e.channelVersion ?? c.data?.channelVersion } }))
          }
        }
        const connect = () => {
          if (disposed) return
          try {
            es = new EventSource(API + '/events')
            es.onopen = () => {
              attempts = 0
              api('/events-ring').then(r => setEvents(r.events ?? [])).catch(() => {})
            }
            es.onmessage = onEvent
            es.onerror = () => {
              try { es?.close() } catch { /* already gone */ }
              if (disposed) return
              attempts += 1
              timer = setTimeout(connect, Math.min(1000 * 2 ** attempts, 10000))
            }
          } catch { /* SSE unavailable: actions still work, feedback via refresh */ }
        }
        connect()
        return () => {
          disposed = true
          clearTimeout(timer)
          try { es?.close?.() } catch { /* noop */ }
        }
      }, [load, loadChannel])

      // real translator injected by apply() wrapper (falls back to zh dict)
      const tr = SuiteTab._t ?? ((x, vars) => (vars === undefined ? (DICT.zh[x] ?? x) : fmt(DICT.zh[x] ?? x, vars)))

      const data = state.data
      const busy = Boolean(job)

      const packs = useMemo(
        () => (data ? ['eac', 'aio', 'skins'].map(id => ({ id, items: data.packs?.[id] ?? [] })) : []),
        [data])
      const skinById = useMemo(() => {
        const m = new Map()
        for (const it of data?.packs?.skins ?? []) m.set(it.id, it)
        return m
      }, [data])
      const managePacks = useMemo(() => packs.filter(p => p.id !== 'skins'), [packs])
      const allManageItems = useMemo(() => managePacks.flatMap(p => p.items), [managePacks])
      const updatable = useMemo(() => allManageItems.filter(it => it.updateAvailable), [allManageItems])
      const skinsPack = packs.find(p => p.id === 'skins')

      const toggle = (id, on) => setChecked(prev => {
        const next = new Set(prev)
        if (on) next.add(id)
        else next.delete(id)
        return next
      })

      const refreshAll = useCallback(() => { load(); loadChannel() }, [load, loadChannel])

      const runInstallPack = async (packId, items) => {
        setNotice(null)
        try {
          await api('/install', POST_JSON(items?.length ? { pack: packId, ids: items.map(i => i.id) } : { pack: packId }))
        } catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      }
      const runInstallSelected = async () => {
        const selected = allManageItems.filter(it => checked.has(it.id))
        if (!selected.length) return setNotice({ kind: 'warn', text: tr('noSelection') })
        setNotice(null)
        try { await api('/install', POST_JSON({ ids: selected.map(i => i.id) })) }
        catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      }
      const runUpdateRows = async (ids) => {
        if (!ids?.length) return
        setNotice(null)
        try { await api('/update', POST_JSON({ ids })) }
        catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      }
      const runUninstall = async () => {
        const selected = allManageItems.filter(it => checked.has(it.id))
        if (!selected.length) return setNotice({ kind: 'warn', text: tr('noSelection') })
        if (!confirmArm) { setConfirmArm(true); setTimeout(() => setConfirmArm(false), 3000); return }
        setConfirmArm(false)
        setNotice(null)
        try { await api('/uninstall', POST_JSON({ ids: selected.map(i => i.id) })) }
        catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      }

      // gallery actions reuse the existing install/enable semantics
      const withSkin = async (id, fn) => {
        setSkinBusy(prev => new Set(prev).add(id))
        try { await fn() } finally {
          setSkinBusy(prev => { const n = new Set(prev); n.delete(id); return n })
        }
      }
      const skinAction = (skin, action) => withSkin(skin.id, async () => {
        setNotice(null)
        try {
          if (action === 'install') await api('/install', POST_JSON({ ids: [skin.id] }))
          else if (action === 'update') await api('/update', POST_JSON({ ids: [skin.id] }))
          else if (action === 'enable') {
            const r = await api('/enable', POST_JSON({ id: skin.id, enabled: true }))
            // The server switched skins (mutex): say which cards it turned off.
            if (Array.isArray(r?.switchedOff) && r.switchedOff.length) setNotice({ kind: 'ok', text: fmt(tr('gallery.switchedOff'), { n: r.switchedOff.length }) })
          } else if (action === 'disable') {
            await api('/enable', POST_JSON({ id: skin.id, enabled: false }))
            await load()
          }
        } catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      })
      const resetSkins = () => withSkin('__reset__', async () => {
        setNotice(null)
        try {
          const r = await api('/skins/reset', POST_JSON({}))
          if (Array.isArray(r?.switchedOff) && r.switchedOff.length) setNotice({ kind: 'ok', text: fmt(tr('gallery.resetDone'), { n: r.switchedOff.length }) })
          else setNotice({ kind: 'ok', text: tr('gallery.resetNone') })
          await load()
        } catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      })

      // drawer
      const openDrawer = useCallback((skin) => {
        setDrawerClosing(false)
        setDrawerId(skin.id)
        setDrawerDetail({ phase: 'loading', data: null })
        api('/prompts/' + encodeURIComponent(skin.id))
          .then(data => setDrawerDetail({ phase: 'ready', data }))
          .catch(() => setDrawerDetail({ phase: 'error', data: null }))
      }, [])
      const closeDrawer = useCallback(() => {
        setDrawerClosing(true)
        setTimeout(() => { setDrawerId(null); setDrawerClosing(false); setDrawerDetail({ phase: 'idle', data: null }) }, 200)
      }, [])
      const drawerSkin = useMemo(
        () => gallery.data?.skins?.find(s => s.id === drawerId) ?? null,
        [gallery, drawerId])

      // updates tab: config save + apply
      const onSaveConfig = async () => {
        setSaveState('saving')
        try {
          const saved = await api('/channel/config', POST_JSON({
            autoUpdate: !!form.autoUpdate,
            autoUpdateHeavy: !!form.autoUpdateHeavy,
            intervalHours: Number(form.intervalHours ?? 6),
            mirror: (form.mirror ?? '').trim() || null,
          }))
          setChannel(c => ({ phase: 'ready', data: { ...(c.data ?? {}), ...saved } }))
          setForm(f => ({ ...f, _dirty: false, _everDirty: true }))
          setSaveState('saved')
          setTimeout(() => setSaveState('idle'), 1800)
        } catch (err) {
          setSaveState('idle')
          setNotice({ kind: 'err', text: String(err.message ?? err) })
        }
      }
      const onApplyUpdates = async () => {
        const updates = Array.isArray(channel.data?.updates) ? channel.data.updates : []
        const ids = updates.filter(u => upChecked.has(u.id)).map(u => u.id)
        if (!ids.length) return setNotice({ kind: 'warn', text: tr('noSelection') })
        const includeHeavy = updates.some(u => upChecked.has(u.id) && u.tier === 'heavy')
        setNotice(null)
        try {
          await api('/channel/apply', POST_JSON({ ids, includeHeavy }))
          setTab('overview') // the sticky progress panel lives at the top level
        } catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
      }

      const emptyCatalog = data && managePacks.every(p => !p.items.length) && !skinsPack?.items.length

      return h('div', { className: 'suite-root' },
        h('style', null, CSS),
        state.phase === 'loading' && h(Skel),
        state.phase === 'error' && h('div', { className: 'suite-errbox' },
          h(Icon.error),
          h('div', { className: 'err-title' }, tr('loadFailed')),
          h('div', { className: 'err-detail' }, state.error),
          h('div', { className: 'err-hint' }, tr('error.hint')),
          h('div', null, h('button', { type: 'button', className: 'suite-btn primary', onClick: load }, tr('retry')))),
        state.phase === 'ready' && h(Fragment, null,
          h('div', { className: 'suite-head' },
            h('div', { className: 'suite-head-main' },
              h('div', { className: 'suite-title-row' },
                h('span', { className: 'suite-title' }, tr('meta.title')),
                data?.suiteVersion && h('span', { className: 'suite-version' }, 'v' + data.suiteVersion)),
              h('div', { className: 'suite-sub' }, tr('subtitle'))),
            h('div', { className: 'suite-head-actions' },
              h(ChannelPill, { phase: channel.phase, data: channel.data, t: tr }),
              h('button', {
                type: 'button', className: 'suite-btn icon ghost', title: tr('refreshTip'), 'aria-label': tr('refresh'),
                onClick: refreshAll, disabled: busy,
              }, h(Icon.refresh)),
              h('button', { type: 'button', className: 'suite-btn', onClick: checkChannel, disabled: busy || channel.phase === 'checking' },
                channel.phase === 'checking' ? tr('channel.checking') : tr('channel.checkNow')))),
          h(ResourcesPanel, { resources: data?.resources, t: tr, onRetry: async () => {
            try {
              const resources = await api('/resources/retry', POST_JSON({}))
              setState(s => ({ ...s, data: { ...s.data, resources } }))
            } catch (err) { setNotice({ kind: 'err', text: String(err.message ?? err) }) }
          } }),
          h(ProgressPanel, { events, job, t: tr, open: logOpen, onToggle: () => setLogOpen(o => !o) }),
          notice && h('div', { className: 'suite-notice ' + notice.kind }, notice.text),
          h(SegNav, { tabs: TABS, active: tab, onChange: setTab, t: tr }),
          h('div', { className: 'suite-view', key: tab },
            tab === 'overview' && h(Fragment, null,
              emptyCatalog
                ? h('div', { className: 'suite-empty' },
                    h(Icon.empty),
                    h('div', { className: 'empty-title' }, tr('empty.title')),
                    h('div', { className: 'empty-hint' }, tr('empty.hint')))
                : h(Fragment, null,
                    h('div', { className: 'suite-cards' },
                      packs.map((p, i) => h(PackCard, {
                        key: p.id, pack: p, index: i, t: tr, busy,
                        onOpen: () => setTab(p.id === 'skins' ? 'gallery' : 'plugins'),
                        onInstall: () => runInstallPack(p.id, p.items),
                        onUpdateBadge: () => setTab('updates'),
                      }))),
                    h(Timeline, { events, t: tr }))),

            tab === 'gallery' && h(Fragment, null,
              gallery.phase === 'ready' && gallery.data?.skins?.length && (() => {
                // Skin stack health strip: n enabled / mutex warning / one-click
                // escape hatch back to the official default look.
                const enabledSkins = gallery.data.skins.filter(s => { const e = skinById.get(s.id); return e?.installed && e?.enabled !== false })
                const over = enabledSkins.length > 1
                return h('div', { className: 'suite-toolbar' + (over ? ' warn' : '') },
                  h('span', { className: 'suite-count' },
                    over ? `⚠ ${fmt(tr('gallery.enabledCount'), { n: enabledSkins.length })} · ${tr('gallery.mutexWarn')}` : fmt(tr('gallery.enabledCount'), { n: enabledSkins.length })),
                  enabledSkins.length > 0 && h('button', { type: 'button', className: 'suite-btn' + (over ? ' danger' : ''), onClick: resetSkins, disabled: skinBusy.has('__reset__') }, tr('gallery.resetDefault')))
              })(),
              gallery.phase === 'loading' && h('div', { className: 'skin-grid' },
                [0, 1, 2, 3, 4, 5].map(i => h('div', { key: i, className: 'suite-skel', style: { height: 190, animationDelay: `${i * 60}ms` } }))),
              gallery.phase === 'error' && h('div', { className: 'suite-errbox' },
                h(Icon.error),
                h('div', { className: 'err-title' }, tr('loadFailed')),
                h('div', { className: 'err-detail' }, gallery.error ?? ''),
                h('div', null, h('button', { type: 'button', className: 'suite-btn primary', onClick: loadGallery }, tr('retry')))),
              gallery.phase === 'ready' && (gallery.data?.skins?.length
                ? h('div', { className: 'skin-grid' },
                    gallery.data.skins.map((skin, i) => h(SkinCard, {
                      key: skin.id, skin, entry: skinById.get(skin.id), index: i,
                      busy: skinBusy, t: tr, onOpen: openDrawer, onAction: skinAction,
                    })))
                : h('div', { className: 'suite-empty' },
                    h(Icon.empty),
                    h('div', { className: 'empty-title' }, tr('empty.title')),
                    h('div', { className: 'empty-hint' }, tr('empty.hint'))))),

            tab === 'plugins' && h(Fragment, null,
              h('div', { className: 'suite-toolbar' },
                h('span', { className: 'suite-count' },
                  `${fmt(tr('installed'), { n: allManageItems.filter(i => i.installed).length, m: allManageItems.length })} · ${fmt(tr('defaultDisabled'), { n: allManageItems.filter(i => i.defaultEnabled === false).length })}`),
                h('button', { type: 'button', className: 'suite-btn', onClick: () => setChecked(new Set(allManageItems.map(i => i.id))) }, tr('selectAll')),
                h('button', { type: 'button', className: 'suite-btn', onClick: () => setChecked(new Set(allManageItems.filter(i => !checked.has(i.id)).map(i => i.id))) }, tr('invert')),
                allManageItems.length > 0 && checked.size > 0 && h('button', { type: 'button', className: 'suite-btn primary', onClick: runInstallSelected, disabled: busy }, fmt(tr('installSelected'), { n: checked.size })),
                updatable.length > 0 && h('button', { type: 'button', className: 'suite-btn', onClick: () => runUpdateRows(updatable.map(i => i.id)), disabled: busy }, fmt(tr('updateAll'), { n: updatable.length })),
                h('button', {
                  type: 'button',
                  className: 'suite-btn danger' + (confirmArm ? ' armed' : ''),
                  onClick: runUninstall, disabled: busy,
                }, confirmArm ? tr('clickAgainConfirm') : tr('uninstallSelected'))),
              managePacks.map(p => h(PluginGroup, {
                key: p.id, pack: p, t: tr, busy,
                open: groupOpen[p.id] ?? true,
                onToggle: () => setGroupOpen(g => ({ ...g, [p.id]: !(g[p.id] ?? true) })),
                checked, onCheck: toggle,
                onUpdateRow: item => runUpdateRows([item.id]),
                onInstallPack: () => runInstallPack(p.id, p.items),
              })),
              h('div', { className: 'suite-note' }, tr('needRestart'))),

            tab === 'updates' && h(UpdatesTab, {
              channel, form, setForm, saveState, onSaveConfig, onApply: onApplyUpdates,
              checked: upChecked, setChecked: setUpChecked, t: tr, busy,
            }),
          ),
          h(SkinDrawer, { skin: drawerSkin, detail: drawerDetail, closing: drawerClosing, onClose: closeDrawer, t: tr }),
        ),
      )
    }

    // ── apply ─────────────────────────────────────────────────────────────────
    function apply(ctx) {
      const t = ctx.locale?.bind?.(NS) ?? (x => x)
      // Convention: with no vars, return the raw template so call sites can
      // apply their own `fmt(tr(key), vars)`; with vars, translate first (some
      // shells interpolate themselves) and fmt afterwards (raw-template shells).
      SuiteTab._t = (x, vars) => (vars === undefined ? t(x) : fmt(t(x, vars), vars))
      ctx.effect?.(() => ctx.locale?.register?.(NS, { zh: DICT.zh, en: DICT.en }), 'eac-plugin-suite: dictionaries')

      ctx.slots?.inject?.('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'eac-plugin-suite',
        order: 5,
        label: () => t('tab'),
        locale: NS,
      }, props => h(SuiteTab, props)))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'eac-plugin-suite'
    return module.exports
  },
})
