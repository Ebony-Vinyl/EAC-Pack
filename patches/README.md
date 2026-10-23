# patches/ — tracked source patches replayed by the repack pipeline

This directory is the **fact source** for local fixes we ship on top of upstream
plugin sources. It exists so a rebuild cannot silently drop them: without it the
fixes live only inside `dist/*.tgz`, which is gitignored, and the next
`repack.mjs` run would re-emit the unfixed upstream code.

## Layout

```
patches/
  source-patches.json                       manifest: base pin + per-file hashes
  files/<package>/<relative path>.diff      unified diff, `git apply -p1` compatible
  README.md
```

`source-patches.json` shape:

```jsonc
{
  "schemaVersion": 1,
  "applicator": "git-apply -p1 (core.autocrlf=false)",
  "base": { "eac": { "repo": "...", "tag": "v5.3.6", "subdir": "dsh-desktop/assets/plugins" } },
  "patches": [
    {
      "name": "@deepseek-ai/dsh-balance",   // must equal the catalog package name
      "version": "0.1.0",                   // must equal the catalog version
      "source": "eac-tag",
      "files": [
        {
          "path": "lib/client.js",          // relative to the extracted package root
          "diff": "files/@deepseek-ai_dsh-balance/lib/client.js.diff",
          "inputSha256":  "<hash of the unpatched file>",
          "outputSha256": "<hash after the patch>",
          "note": "why this fix exists (copied into dist/index.json repackNote)"
        }
      ]
    }
  ]
}
```

## How it runs

`scripts/repack/repack.mjs` calls `applySourcePatches()` immediately after a
package is materialized and before `npm pack`. For every entry listed for that
package, the replay is **fail-closed**:

1. the materialized file must hash to `inputSha256` — otherwise the build stops
   (upstream drifted; regenerate the patch or re-pin the base);
2. the tracked diff is applied with `git apply -p1` and `core.autocrlf=false`
   so bytes are not line-ending translated;
3. the result must hash to `outputSha256` — otherwise the build stops.

Packages without an entry are untouched. When a patch is applied,
`dist/index.json` records `locallyRepacked: true` plus `repackNote`, which
propagates into `suite/assets/bootstrap.json`.

For packages with several patched files, set an optional package-level
`summary` on the patch entry. `repackNote` then uses that one string instead of
concatenating every per-file `note`. Keep the long explanations in the per-file
`note` fields (they are the maintainer-facing record); a manifest is read by the
installer and should not carry a thousand characters of rationale.

### `.gitattributes` pins diff line endings — do not remove

`.gitattributes` carries exactly one rule beyond the baseline comment:

```
patches/**/*.diff -text
```

It looks cosmetic and is not. The diffs are **data**, not source: `git apply -p1`
matches their context lines byte-for-byte against the materialized upstream
files, which are LF. With `core.autocrlf=true` (the Windows default) a normal
text checkout rewrites every diff to CRLF, and the replay then fails with:

```
error: patch failed: lib/client.js:121
error: lib/client.js: patch does not apply
```

Measured on a clean `main` worktree without the rule: the three tracked diffs
came out with 304 / 23 / 109 CR bytes and `git apply` rejected them outright.
With the rule they are byte-identical to their blobs.

Keep the file to that one rule line. Several branches independently added this
rule with different wording, which turns a trivial change into a merge conflict;
the explanation belongs here, not in every branch's copy of the file.

### The `eac-tag` base pin

`repack.mjs` reads `source: "eac-tag"` packages from
`.cache/eac-src/dsh-desktop/assets/plugins`, which nothing else creates. Populate it with:

```bash
# offline (recommended, uses a local clone that has the tag)
EAC_SRC_LOCAL=/path/to/DSH-Desktop-EAC node scripts/repack/fetch-eac-src.mjs --force
# or over the network
node scripts/repack/fetch-eac-src.mjs --force
```

`fetch-eac-src.mjs` uses a temporary Git index (`read-tree --prefix` and
`checkout-index`, with `core.autocrlf=false`; no CRLF translation) and then
prints whether each pinned file still matches the `inputSha256` the patches expect.

This pin matters: the EAC main repository **deliberately deleted**
`dsh-desktop/assets/plugins` at HEAD (ADR 0006 v4, commit `6687b40`
"剥离文件连同源码删除"), so these sources now exist only at the recorded tag.
Do not re-add them to the main repository — that contradicts that decision; the
fixes belong to the distribution layer, i.e. here.

### Pinning a `github` / `github-repo` source

`GH_SOURCES` entries take an optional `ref`. Give it a **full 40-char commit SHA**
(or a tag) whenever reproducibility matters — without it the clone tracks the
upstream default branch, so the same commit of this repo can emit a different
artifact on a different day.

That is not hypothetical: `@nagi-ovo/dsh-visualize` has catalog version 0.1.4
while its cached clone was 0.1.7 — the shipped bytes depended on which machine
ran the build. `ref` also keys the cache (`.cache/<dir>/.repack-ref`), so a
changed pin forces a fresh clone and the resulting `HEAD` is asserted against it.

`picturereader` is the first entry to use this, because 3.5.0 has **no npm
release and no git tag** (npm stops at 3.3.3) and is the only version adapted to
the 0.2.x kernel on both halves: the client no longer injects the retired
`settingsScope` (it probes at runtime and falls back to its own loopback route),
and the host half no longer imports the deleted `settingsNamespace`.

Note that 3.5.0 adds a runtime dependency (`webp-wasm`) that 3.3.1 did not have.
It is a declared `dependencies` entry, so pnpm installs it from the profile's
dependency graph at install time — it is **not** bundled into the tgz, and a
bare `npm pack`-style drop-in of the tarball alone would not resolve it.

Adding a `github*` source without a matching map entry makes `repack.mjs` `die`;
`suite/test/gh-sources.test.mjs` catches that statically, before any build runs.
That test also keeps a small `KNOWN_MISSING_SOURCE_MAP` table for
`dsh-our-free-model` (see below) and fails if an allowlisted entry stops being a
real problem, so the waiver cannot rot.

## Known build blocker: `dsh-our-free-model`

`catalog/eac.json` records this package as `source: github-repo` with
`spec: file:dist/dsh-our-free-model-2.0.0.tgz`, but `GH_SOURCES` has no mapping
for it — a **full** `repack.mjs` run dies at that entry. It is waived, not fixed,
because the pinned version 2.0.0 is no longer obtainable: upstream `main` is now
2.5.6, no release asset for 2.0.0 survives, and the local tarball is gone.

This does not block day-to-day work: `dist/` is gitignored, rebuilds are normally
scoped with `--only`, and the committed `bootstrap.json` entry is intact. Fixing
it needs its own change (restore the 2.0.0 asset, or move the entry to 2.5.6 with
a new source mapping).

## Current patches

| Package | Source | File | Fix |
| --- | --- | --- | --- |
| `dsh-settings-groups@0.1.0` | `eac-tag` | `lib/client.js` | General-settings collapser: real rows are the slot wrapper's children, not the wrapper itself (previously the whole page was hidden as a single "advanced" row). |
| `@deepseek-ai/dsh-balance@0.1.0` | `eac-tag` | `lib/client.js` | Drops the 价格设置 settings section. Its `balancePrices` / `balanceModels` / `refreshBalance` bridge is retired by ADR 0006 (`docs/adr/0006-minimal-core-scope.md:373-376`, locked by `bridge-preload-parity.test.ts`), so the section could only ever render a misleading "bridge unavailable" error. The composer dock is unchanged. |
| `dsh-plugin-wallpaper-engine@0.6.7` | `npm` | `lib/client.js` | Update-notice button contrast. `.we-picker__btn` inherits light-theme tokens that render near-black on the dark glass notice card (outline 1.10:1, label 1.06:1). Pin light values → outline 3.11:1, label 4.95:1 (WCAG 4.5 text / 3.0 non-text). |
| `computer-user@0.3.7` | `npm` | `src/index.js` | Re-export the settings schema. DSH 0.1.7-rc.2 derives settings forms from the entry's exported `Config` (`SettingsForms.schema(entry)` reads `entry.fiber.runtime.Config`), but upstream keeps `Config` module-private. Without the export the namespace never appears in `describe()`, so the browser `configForms.get()` answers `unavailable` and the card is blank. |
| `computer-user@0.3.7` | `npm` | `src/config.js` | Mark every `Config` field `volatile()`. `volatileForm()` keeps only fields under a volatile ancestor, so the unmarked upstream schema still projects to `undefined` — no form even once `Config` is exported. |
| `computer-user@0.3.7` | `npm` | `client.js` | Drop the retired `settingsScope` inject and probe both transport generations. Declaring a service no kernel provides parks the client fiber in `waitingFor` forever, so the whole card vanishes with no error. Now: `configForms.get(entryId)` on 0.2.x, `settingsScope.bind()` on 0.1.x, and no section at all when neither exists. Upstream 0.3.7's `client.js` is byte-identical to 0.3.6 — the browser half was never adapted. |
| `@deepseek-ai/dsh-conversation-tweaks@0.1.0` | `eac-tag` | `lib/index.js`, `lib/client.js`, `lib/settings-compat.js` | Both halves of the 0.2.x settings-model retirement (see below). |
| `@deepseek-ai/dsh-prompt-custom@0.1.0` | `eac-tag` | `lib/index.js`, `lib/client.js`, `lib/settings-compat.js` | Both halves, plus the `PERSONA_SECTION` / `PERSONA_ORDER` rename to `PERSONA_PREFIX_SECTION` / `PERSONA_SUFFIX_SECTION`. |
| `@deepseek-ai/dsh-openclaw-bridge@0.7.0` | `eac-tag` | `lib/index.js`, `lib/client.js`, `lib/settings-compat.js` | Both halves. The host half matters most here: the link-time `SyntaxError` takes down the bridge routes too, not just the settings card. |
| `dsh-compact@1.0.1` | `eac-tag` | `lib/index.js`, `lib/client.js`, `lib/settings-compat.js` | Both halves. Version is 1.0.0 at the `eac-tag` source; the existing `OVERRIDES` entry re-stamps it to 1.0.1, so the manifest pins 1.0.1. |
| `dsh-better-sidebar@0.15.3-eac.1` | `eac-tag` | `lib/index.js`, `lib/settings-compat.js` | Host half only: `settingsNamespace` is gone, `SettingsConflictError` survives. Needs `create` mode **and** the `files` whitelist append — see above. |

### Why `computer-user` needs three patches

They are independent defects, and fixing any one alone still leaves the plugin
dead. 0.3.7 fixed the *host* import (`settingsNamespace` moved to an inlined
`src/settings-compat.js` shim) but not the schema export or the client half.

### The five 0.2.x-adapted plugins

`dsh-conversation-tweaks`, `dsh-prompt-custom`, `dsh-openclaw-bridge`,
`dsh-compact` and `dsh-better-sidebar` all shipped against the 0.1.x settings
model. On 0.2.x they fail in two independent ways, so each needs both halves:

| Half | Defect | Symptom |
| --- | --- | --- |
| `lib/index.js` | named import of a retired `@deepseek-ai/dsh-settings` export (`settingsNamespace`, `installSettingsSection`) | ESM resolves named imports at **link time** → `SyntaxError` → the whole plugin tree refuses to activate |
| `lib/client.js` | `inject: ['settingsScope']` | the client fiber parks in `waitingFor` forever → the settings surface silently vanishes, no error anywhere |

`dsh-prompt-custom` carries a third: 0.2.x renamed the persona section constants
(`PERSONA_SECTION` / `PERSONA_ORDER` → `PERSONA_PREFIX_SECTION` /
`PERSONA_SUFFIX_SECTION`).

The host half points at a **self-contained** `lib/settings-compat.js` that
travels inside each plugin — EAC plugins ship self-contained and never resolve
through the kernel package graph, so this is not a second kernel copy.

### `volatile()` availability depends on the schemastery **specifier**

0.2.x derives settings forms from the plugin's exported `Config`; a form only
materialises when the root object schema carries `meta.volatile`. Two ways to
get there, and **which one works depends on how the plugin imports schemastery**:

| import specifier | resolves to | has `.volatile()` | use |
| --- | --- | --- | --- |
| `@deepseek-ai/schemastery` | 3.18.4 | **yes** | `Config = Base.volatile()` |
| bare `schemastery` | 3.18.0 | **no** | `Base.meta.volatile = true` |

Measured 2026-10-21 in a full instance:

```
@deepseek-ai/schemastery  → base.volatile === 'function'            ✔
schemastery (bare)        → base.volatile === undefined             ✘
```

So the widely-copied guard

```js
const Config = typeof BaseConfig.volatile === 'function' ? BaseConfig.volatile() : BaseConfig;
```

is **effective for the five plugins that import `@deepseek-ai/schemastery`**, and
**silently a no-op for `dsh-better-sidebar` / `dsh-theme-endfield`, which import
the bare name** — the ternary just falls through and no `volatile` marker is set.
`dsh-better-sidebar` consequently had *no settings card at all* until the patch
switched it to writing `meta.volatile = true` directly.

When touching this area, check the plugin's import line first; do not copy the
ternary on the assumption that "it worked in the other plugin".

## Adding a new file (`create` mode)

Some fixes need to *add* a file the upstream package does not ship — that is what
`create` mode is for.

```jsonc
{
  "path": "lib/settings-compat.js",
  "diff": "files/<pkg>/lib/settings-compat.js.diff",
  "create": true,
  "outputSha256": "…",       // required, still verified
  // no inputSha256 — there is no previous version to hash
  "note": "…"
}
```

The diff must originate from `/dev/null`:

```
--- /dev/null
+++ b/lib/settings-compat.js
@@ -0,0 +1,N @@
+<content line 1>
…
```

The replay stays fail-closed: the target **must not exist** and `inputSha256`
**must be absent** (pinning one means "patch an existing file", which contradicts
`create` — both mistakes throw), and the produced bytes must still hash to
`outputSha256` before the file is written.

`repack.mjs` then reopens `package.json` and, when the package has a `files`
whitelist, appends the created path to it (`ensurePatchedFiles`). **Without that
step npm pack silently drops the new file** — the tgz builds green and the plugin
only breaks at runtime. `dsh-better-sidebar` needs it: its `files` array lists
every `lib/*.js` explicitly, so a created `lib/settings-compat.js` is invisible to
npm unless it is added.

## Kernel export gate

`scripts/repack/kernel-compat.mjs` verifies that the **shipped artifacts** never
import a named export the kernel no longer provides. This is a different check
from the Desktop repository's `scripts/plugin-kernel-compat.mjs`:

| | Desktop gate | Pack gate (this one) |
| --- | --- | --- |
| Scans | `dsh-desktop/assets/plugins` (11 EAC-owned plugins) | `dist/*.tgz` (all 72 shipped packages) |
| Judges | built-in plugin **source** | what users actually **receive** |

The gap was real: `computer-user`, `picturereader`, `dsh-conversation-tweaks`,
`dsh-openclaw-bridge` and `dsh-prompt-custom` all shipped with imports of
removed kernel exports while the Desktop gate stayed green, because none of them
live in `assets/plugins`.

```bash
node scripts/repack/kernel-compat.mjs                 # exit 1 on any hit
node scripts/repack/kernel-compat.mjs --json           # machine-readable
node scripts/repack/kernel-compat.mjs --kernel <dir>   # override kernel root
node scripts/repack/kernel-compat.mjs --allowlist      # print known waivers
```

The kernel root defaults to a sibling `../EAC-Desktop/dsh-desktop/node_modules/@deepseek-ai`,
then `$DSH_KERNEL_ROOT`. Missing kernel = exit 2 (environment), never a silent pass.
`verify.mjs` runs this gate as step (f); it degrades to a warning when the kernel
is absent, since Pack CI and Desktop need not be installed together.

`DEFAULT_ALLOWLIST` in that module is deliberately empty. Adding an entry requires
that the plugin is disabled by default *and* a written reason plus a tracking note —
otherwise the gate turns red, which is the point.

Regenerate nothing here; the gate reads `dist/` only. Rebuild first:

```bash
node scripts/repack/repack.mjs && node scripts/repack/kernel-compat.mjs
```

Its own correctness is pinned by `suite/test/kernel-compat.test.mjs` (fixture
tgz + fake kernel), which asserts both directions: a missing export fails the
build, and a present export does not. That suite is what caught a real bug in the
gate itself — the `client/**` excluder originally missed `*.client.js` spellings,
so front-end bundles could be misreported as server-side imports.

## Replaying a clean build

Two environment quirks bite on a fresh clone and are **not** patch problems:

1. **`core.autocrlf=true`** rewrites `patches/**/*.diff` to CRLF on checkout, so
   `git apply` can never match the LF context lines. `.gitattributes` pins
   `patches/**/*.diff -text` to prevent it — do not remove that rule.
2. **`dist/` is gitignored and shared across branches.** Switching branches
   leaves another branch's tarballs in place, so `dist/index.json` and the files
   on disk disagree. Always rebuild before trusting `verify.mjs` or the gate.


## Adding or regenerating a patch

1. Edit the extracted package source until it behaves correctly.
2. Produce the patch from the **unpatched** and **patched** file so
   `inputSha256`/`outputSha256` are both recorded:

   ```bash
   git diff --no-index --src-prefix=a/ --dst-prefix=b/ unpatched/lib/client.js patched/lib/client.js
   ```

   Then rewrite the two header paths to `a/lib/client.js` / `b/lib/client.js`
   (they must be relative to the extracted package root so `-p1` works).
3. Add the entry to `source-patches.json` with both hashes and a `note`.
4. Prove the round trip: unpatched + diff must equal patched. A rebuild is the
   real test — `repack.mjs` fails loudly if the hashes do not line up.

Keep patches minimal and surgical. Do not use this mechanism to fork a package's
behaviour wholesale; if a package needs a real fork, publish it as its own
package instead.

## Provenance and licensing

Upstream origins are recorded per package in `catalog/*.json` (`upstream` field)
and remain the property of their authors; these diffs are our local fixes to
byte-identical upstream sources and carry the same license as the package they
patch (`MIT` for all three above, and `SEE LICENSE IN ASSET_LICENSE.md` where the
package declares assets — not applicable to the files patched here).
