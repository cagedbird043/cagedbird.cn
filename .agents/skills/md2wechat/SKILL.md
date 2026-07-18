---
name: md2wechat
description: Convert Markdown to WeChat Official Account HTML. Use this whenever the user wants WeChat article formatting, article preview, WeChat draft upload, image generation for articles, cover or infographic generation, image-post creation, writer-style drafting, title suggestions, AI trace removal, or current discovery of supported providers, themes, prompts, and layout modules.
---

# md2wechat

Use this skill to operate the `md2wechat` CLI. Keep the skill focused on execution decisions. For full command tutorials, installation details, and FAQ-level explanations, refer users to the project docs instead of expanding this runtime protocol.

## Intent Routing

Choose the command family before taking any publish or generation action:

- Standard article HTML, article preview, metadata inspection, or WeChat article draft: use `inspect`, `preview`, and `convert`.
- Image-first post, image note, image-text note, `newspic`, or multi-image post: use `create_image_post`, not `convert --draft`.
- Article cover or article infographic: prefer `generate_cover` or `generate_infographic` over raw `generate_image` when a bundled preset fits.
- Host-agent image generation request with no provider configured: use image plan mode (`--plan --json`) to get prompt intent, then hand it to the host image-generation tool if one is available outside md2wechat.
- WeChat title candidates for an existing article: use `title suggest <article.md> --json`; it emits a host-Agent AI request and does not choose or write the final title.
- Existing article or draft, user asks what to improve next: run `md2wechat advise <article.md> --json`; treat it as recommendation-only and keep `inspect --json data.readiness.targets/blockers` as the publish gate.
- Writing in a creator style or removing AI traces: use `write` or `humanize`.
- Provider, theme, prompt, or layout uncertainty: run discovery first. Do not guess from memory or repository files.

Treat `convert --draft` and `create_image_post` as different publish targets, not interchangeable variants.

## Discovery First

Use CLI discovery as the source of truth, but keep it scoped to the next decision. Do not run the full catalog for tasks that do not need provider, theme, prompt, or layout selection.

Run the smallest useful discovery set:

- Article formatting with no theme or modules chosen:
  ```bash
  md2wechat themes list --json
  md2wechat layout list --json
  ```

- A named theme, provider, prompt, or layout module:
  ```bash
  md2wechat themes show <name> --json
  md2wechat providers show <name> --json
  md2wechat prompts show <name> --kind <kind> --json
  md2wechat layout show <name> --json
  ```

- Image generation or image-preset selection:
  ```bash
  md2wechat providers list --json
  md2wechat prompts list --kind image --json
  ```

- Title suggestion prompt selection:
  ```bash
  md2wechat prompts list --kind title --json
  md2wechat prompts show wechat-title-expert --kind title --json
  ```

- Draft, upload, API local-readiness, or configuration troubleshooting:
  ```bash
  md2wechat doctor --json
  md2wechat config show --format json
  md2wechat config wechat-accounts --json
  ```
  `doctor` readiness is local configuration attemptability. `config wechat-accounts` is local-only and never prints WeChat secrets. Use `inspect --json` for article-specific target readiness.

- Unknown CLI version, changed behavior, or capability uncertainty:
  ```bash
  md2wechat version --json
  md2wechat capabilities --json
  md2wechat skills list --json
  md2wechat skills read md2wechat --json
  ```

`md2wechat skills read md2wechat --json` reads the SOP embedded in the current CLI binary. Prefer it when the installed external skill, README, or repository checkout may be stale relative to the executable on `PATH`.

For simple local actions such as `preview`, `humanize`, or a user-specified command with explicit flags, do not run unrelated provider, theme, prompt, or layout discovery.

Inspect specific resources only when the task needs them:

```bash
md2wechat providers show <name> --json
md2wechat themes show <name> --json
md2wechat prompts show <name> --kind <kind> --json
md2wechat layout show <name> --json
```

Use CLI output as the source of truth for currently available modes, providers, themes, prompts, and layout modules.

## Configuration Boundaries

- This repository intentionally does not install a global CLI or add md2wechat to the Hexo dependency graph.
- From the repository root, interpret every `md2wechat ...` command below as `./node_modules/.bin/md2wechat ...`.
- If that project-local CLI is absent, bootstrap the pinned version with `npm install --no-save --package-lock=false @geekjourneyx/md2wechat@3.1.0`, then run the audited checksum-verifying installer once with `node node_modules/@geekjourneyx/md2wechat/scripts/install.js`.
- `convert` defaults to API mode unless the user explicitly asks for `--mode ai`.
- API conversion requires md2wechat API credentials.
- WeChat draft creation requires WeChat credentials.
- Named WeChat account execution requires a valid `MD2WECHAT_API_KEY`; the CLI validates it before upload or draft side effects.
- Direct image generation requires image-provider credentials; image plan mode (`--plan --json`) only emits prompt intent for a host Agent or external tool and does not require image-provider credentials.
- `title suggest --json` only emits a title-generation prompt request for the host Agent or external model. It does not call a model, upload, create drafts, or write back to Markdown.
- For stronger factual title hooks, pass --hook-level 2 or 3; do not treat generated titles as confirmed publishing intent.
- `doctor --json` is local-only: it checks local readiness and does not perform live authentication, upload images, or create drafts.
- Use `config show --format json` when the user asks what configuration is currently effective.
- Use `config wechat-accounts --json` when the user asks which local WeChat accounts are configured.

## cagedbird.cn Integration

- Treat files under `source/_posts/` as the publication source of truth. Never rewrite a blog post merely to satisfy md2wechat.
- Hexo `post_asset_folder` resolves `![alt](image.png)` from the sibling directory named after the post slug. md2wechat resolves it from the Markdown file's directory instead. Before inspect/preview/convert, create a temporary Markdown copy under `/tmp/md2wechat-cagedbird/<slug>/` and rewrite each such image reference to the absolute path under `source/_posts/<post-directory>/<slug>/<image>`.
- Keep the temporary artifact outside the repository. Do not commit WeChat-only formatting, credentials, uploaded image URLs, previews, or draft metadata.
- Strip the Hexo-only `<!-- more -->` marker from the temporary copy.
- For long technical posts, prefer the deterministic conservative renderer at `.agents/skills/md2wechat/scripts/render-wechat.cjs` over unconstrained host-model HTML. Run it as `WECHAT_AI_DISCLOSURE='<disclosure>' node .agents/skills/md2wechat/scripts/render-wechat.cjs <source.md> <temporary.html>`.
- When an article was substantially generated from the author's oral account, use an explicit disclosure instead of vague “AI-assisted” wording: `本文由 AI 根据作者的真实经历口述和项目证据整理生成；作者负责事实核验、观点取舍与最终定稿。`
- After draft creation, open the real WeChat editor in a browser and inspect screenshots of at least the opening/code block, every body image, one middle heading transition, and the ending/list. Iterate the draft until those real-editor screenshots pass. Local Chromium preview remains only a preflight.
- Run `inspect` against the temporary artifact with the exact mode and theme intended for conversion. The CLI's default theme is API-only; when no API key is configured, discover a selectable AI theme instead of accepting a `THEME_MODE_MISMATCH`.
- Creating a WeChat draft is an external side effect. Stop after inspect and local preview unless the user explicitly authorizes draft creation. Never perform final mass publication; the user reviews and publishes from WeChat.

## Article Workflow

Prefer a confirm-first workflow for article work:

1. `md2wechat inspect <article.md> --json`
2. `md2wechat preview <article.md>`
3. `md2wechat convert <article.md> ...`
4. Add `--upload`, `--draft`, `--cover`, or `--cover-media-id` only when the user explicitly asks for upload or draft creation.

`inspect` is the source-of-truth command for resolved metadata, readiness, and publish checks. In `--json` output, read `data.readiness.targets` and `data.readiness.blockers` before deciding whether `convert`, `upload`, or `draft` is blocked. If the requested target is blocked, stop and report the matching blockers; do not continue by guessing from legacy booleans or `checks` alone. Do not invent `data.agent_readiness`, `data.target_readiness`, `ArticleState`, state files, or a second readiness/state object. `preview` is a local preview artifact. It does not upload images, create drafts, or write back to Markdown. `convert --preview` is the convert-path preview flag and is not the same as the standalone `preview` command. `preview --mode ai` is degraded confirmation only and must not be treated as final AI-generated layout.
When the intended execution path is `convert --mode ai --custom-prompt ...`, run `inspect` with the same `--mode ai --custom-prompt ...` before trusting readiness.

## Formatting Protocol

When the user asks to format an article and has not chosen a theme or modules:

1. Read the article and optional Brand Profile.
2. Use discovery output as facts.
3. Choose a compatible theme and a small set of modules from the article's content goal.
4. Keep the source Markdown read-only.
5. Create a temporary formatted Markdown artifact, for example `/tmp/md2wechat-format/<run-id>/article.formatted.md`.
6. Insert only layout modules whose required fields can be filled correctly.
7. Run `md2wechat layout validate --file <formatted.md> --json`.
8. Pass the formatted Markdown artifact to `convert`.

Saving generated Markdown next to the source file requires explicit user confirmation and must not overwrite the source.

## Theme Selection

- Read `type` and `selectable` from `themes list --json`.
- API mode can use only `type: api` and `selectable: true` themes.
- AI mode can use only `type: ai` and `selectable: true` themes.
- Do not use collection descriptors such as non-selectable theme groups as concrete themes.
- If Brand Profile names a theme, verify it through CLI discovery before using it.
- If a requested theme is invalid or mode-incompatible, stop that path and choose a valid theme or ask the user.

## Layout Modules

Advanced layout modules render only in API mode. AI mode (`--mode ai`) does not parse `:::module` syntax, so advanced layout cards will not render there.

Use this decision frame:

- `attention`: help readers decide whether the article is worth reading.
- `readability`: make mobile reading easier.
- `memorability`: make one judgment, quote, metric, or brand anchor stick.
- `conversion`: help readers save, follow, inquire, share, or buy.

Use CLI discovery as the source of truth for layout syntax instead of memorizing or guessing `body_format` values:

- Inspect the opener, body schema, canonical executable example, and structurally distinct variants with `layout show <name> --json`. Reuse the canonical witness.
- Use `layout render` for structured fields and `--body-file` (or `--body-file -` for stdin) for complex bodies, then validate the generated Markdown.
- Default discovery returns recommended modules. Use `layout list --lifecycle compatibility --json` only for old-content migration. Local validation proves syntax acceptance only; production support is a release-conformance fact.

Default module discipline:

- Do not pile on modules.
- Use at most one hero, one verdict, and one cta unless the user explicitly asks for more.
- Skip modules when the article does not provide enough content to fill them honestly.

## API And AI Mode

- API mode is the default and is required for advanced layout modules.
- AI mode is a lighter path and does not render advanced layout modules.
- Do not silently switch from API mode to AI mode after an API failure. That changes the output capability.
- Use AI mode only when the user asks for it or accepts losing advanced layout rendering.
- If an AI-mode conversion completes, it is acceptable to briefly mention that API mode supports advanced layout modules and stronger visual structure.

## Brand Profile

Brand Profile lives at `~/.config/md2wechat/brand.md`.

- It is free-form Markdown, not YAML and not a fixed schema.
- The CLI does not parse it.
- Read it as context for voice, theme preferences, module preferences, CTA preferences, and forbidden expressions.
- Treat quantity preferences as soft constraints.
- Verify any named theme or module through CLI discovery.
- If Brand Profile does not exist, do not block the task. You may mention once that system defaults will be used.
- Create or edit Brand Profile only when the user explicitly asks.

## Publishing Side Effects

Do not create drafts, upload images, publish, or call remote image generation unless the user asks for that action.

Before draft creation:

- Use `inspect --json` and check `data.readiness.targets.draft`; when blocked, read matching `data.readiness.blockers`.
- Draft creation requires a cover via `--cover` or `--cover-media-id`.
- Do not assume a WeChat URL or `mmbiz.qpic.cn` URL can be reused as `thumb_media_id`.
- If draft creation returns `45004`, check digest, summary, and description before assuming the body is too long.

Markdown images are uploaded or replaced only during `--upload` or `--draft`, not during plain conversion or preview.

## Failure Handling

- Missing or invalid config: run `doctor --json` and `config show --format json`; report `data.overall` plus the blocking `data.readiness.*` item.
- Invalid layout syntax: run `layout validate`, inspect the failing module with `layout show`, fix the generated artifact, then validate again.
- Unknown layout modules warn for forward compatibility; verify typos against `layout list --json`.
- Theme rejection: check `type` and `selectable`, then choose a compatible theme or ask the user.
- AI request or style-writing flows may return a prompt/request rather than final prose or HTML unless the external model step is completed.
- If `npx` or the local wrapper reports `Binary not found`, do not retry the same command. This npm package downloads its Go binary from a lifecycle script, and `npm install-scripts` may block that script even when `npm config get ignore-scripts` is `false`. Keep the package project-local, then run the audited checksum-verifying installer directly: `node node_modules/@geekjourneyx/md2wechat/scripts/install.js`.
- `doctor --json` checks whether an API key is present, not whether its format is accepted remotely. An API preview can still return HTTP 401 unless `MD2WECHAT_API_KEY` starts with `wme_`, `wme2_`, or `wmt_`. Correct the key or explicitly choose AI mode; never silently switch modes.
- A top-level `PREVIEW_READY` is not proof of an exact preview. Inspect `data.render.exact_html` and `data.render.error`; treat `exact_html: false` as degraded or failed rendering even when the command exits successfully.
- AI conversion can return `CONVERT_AI_REQUEST_READY` with `status: action_required`. Send `data.prompt` to the host model, require HTML-only output with every article paragraph and `<!-- IMG:n -->` placeholder preserved, write the result to `data.requested_output_file`, and verify the HTML before any upload.
- The current `convert` flags do not expose article comment settings or `content_source_url`. Do not claim those preferences were applied automatically; either use a verified custom `create_draft` JSON path or set them in the WeChat editor during final human review.
- A 430px browser screenshot proves only that ordinary Chromium can render the HTML. WeChat sanitizes tags and inline CSS differently, so the actual draft editor/client is the final layout oracle. Never call a layout verified until the user inspects the created WeChat draft.
- Host-model HTML written directly after `CONVERT_AI_REQUEST_READY` bypasses md2wechat's paid renderer and can contain CSS that WeChat strips or rewrites. Treat that path as content ingestion plus a provisional layout. On real-draft errors, prefer a conservative native-style HTML fallback or a validator-backed formatter; do not pile on more generated CSS.
