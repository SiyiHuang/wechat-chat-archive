# WeChat Archive Schema (Version 1)

All examples are synthetic. Node.js 20 or newer is sufficient; no dependencies or private databases are used.

## Files and authority

One captured round produces `IMPORT/YYYY-MM-DD-微信聊天记录.md` and the corresponding `.json`. Later same-day rounds use `YYYY-MM-DD-02-微信聊天记录.md`; IDs use `YYYYMMDD-001` or `YYYYMMDD-02-001`. Existing rounds are never renumbered or overwritten. The JSON retains the full evidence and media model; Markdown retains the legacy human-readable header and message form. `markdownSha256` binds both representations: the stored Markdown hash and freshly rendered JSON representation must both match. Editing either representation requires explicit reconciliation; the CLI fails on a mismatch and never silently replaces an edit. Missing canonical sidecars also fail.

`PARTICIPANTS.json`, `PARTICIPANTS.md`, and `index.html` are generated derivatives. Archive contents and all images stay local. The reader has search, speaker/date/media/quote filters, stable anchors and reply navigation. HTML escapes content, prohibits remote requests, and renders only verified local raster image files.

Legacy Markdown can be validated individually without modification. `readArchive` also reads legacy files without sidecars, preserves their IDs, display names and time-only timestamps, and labels unavailable completeness evidence as incomplete. Filename dates identify extraction rounds, **not inferred dates of historical messages**. A migration must preserve original files and explicitly provide missing evidence; old Markdown is never automatically rewritten.

For a populated legacy project, initialize a **new sibling archive directory**, then copy its legacy `IMPORT/` rounds and required `assets/` without overwriting anything. Keep the original project unchanged. Preserve an existing participant table under a separate local `legacy/` folder as evidence, and explicitly transcribe confirmed aliases into the next capture's `participants`; do not replace it with an empty generated table. Validate the copied rounds before appending. `init` intentionally refuses unrelated files in an existing project; it is not an in-place migration command.

## CLI

```sh
node skills/archive-wechat-chat/scripts/archive.mjs init /absolute/archive
node skills/archive-wechat-chat/scripts/archive.mjs import /absolute/archive capture.json
node skills/archive-wechat-chat/scripts/archive.mjs import /absolute/archive capture.json --allow-incomplete
node skills/archive-wechat-chat/scripts/archive.mjs validate /absolute/archive
node skills/archive-wechat-chat/scripts/archive.mjs build /absolute/archive
node skills/archive-wechat-chat/scripts/validate-chat-round.mjs /absolute/archive/IMPORT/*.md
```

An incomplete capture needs `--allow-incomplete` and remains visibly incomplete. Import acquires an exclusive lock, validates before publishing, stages both canonical files, and publishes without replacing any existing path. Initialization refuses an existing archive manifest or unrelated files. Do not remove a lock until checking for an active import. Participant derivatives are protected by hashes in `archive.json`; existing untracked or manually edited participant files cause a failure and remain untouched. Reconcile their evidence into structured participant records before rebuilding. Derived-file regeneration is atomic per file.

## Capture input

Use structured JSON with `date` (valid `YYYY-MM-DD` extraction date), `round` (positive padded string, default `01`), `window`, `captureMethod`, `messages` **or** `pages`, `captureEvidence`, `completeness`, and optional `participants` / `anchorId`.

`pages` is an ordered array of `{messages:[...]}`. Adjacent pages merge using maximal exact suffix/prefix identity; this preserves legitimate repeated messages. A page without overlap requires `contiguousEvidence:["observed boundary evidence"]`. `completeness.recognizedItems` counts unique captured records **after page overlap is removed and before prior-round overlap is removed**.

`captureEvidence` contains `textSources:[string]`, `screenshotRefs:[string]`, `speakerVerification:"all"|"partial"`, and `endDetection:"visible_end"|"two_identical_bottom_states"|"not_reached"`. References should identify actual saved captures or precise UI observation contexts. Strings record evidence provenance; the software does not pretend to independently verify human speaker attribution or a visible end marker.

`completeness` contains:

- `status`: `complete` or `incomplete`.
- `recognizedItems`: nonnegative integer; retained messages + previous-round overlap + explicitly skipped media.
- `skippedMedia`: nonnegative integer, normally zero. Every attached media item is retained by default. A media-only message is one recognized record regardless of attachment count.
- `skippedMediaEvidence`: required nonempty string array if media was explicitly excluded.
- `evidence`: string array describing capture coverage.
- `limitations`: string array describing omissions or uncertainty.

`complete` requires nonempty coverage evidence, no known limitations, both text-source and screenshot-attribution references, all speakers verified, detected end, and reconciled item counts. A round containing preview or unavailable media must be `incomplete` with a media limitation. `saved_unverified` can satisfy exported-file coverage but does not imply original fidelity. Counts, quote resolution and media fidelity are separately reported.

## Messages and ordered identity

Message fields are `speaker`, `timestamp`, `body`, optional `id`, `quote`, `media`. `body` may be empty only when there is a media record. Speaker must be the observed historical display name, never an alias replacement or placeholder such as `unknown`. **New imported messages require source-confirmed `YYYY-MM-DD HH:MM[:SS]`.** Legacy validation preserves `HH:MM` / `HH:MM:SS`, including an exact time-only old anchor in the discarded overlap. Do not infer missing dates from extraction filenames.

Identity compares normalized timestamp, speaker and body, preserved quote speaker/text, and ordered media captureId/hash/path, in that priority. Whitespace and Unicode NFC are normalized for comparison only; stored text is preserved. For media across screenshots use a stable `captureId` consistently across pages and rounds. Media is verified and hashed before incremental matching. No global text deduplication is performed.

Incremental capture must begin with an exact suffix of existing messages and include the latest archived item. Its identity must occur exactly once in the capture; otherwise import fails. `anchorId` optionally checks the expected latest ID; it cannot override ambiguity. Resolve ambiguity by capturing a distinctive ending context and confirming source dates, or by preparing a reviewed capture containing one unambiguous ordered overlap. Never select an arbitrary repeat.

## Quotes

`quote` fields: `text` (required preserved text), optional `speaker`, `status`, `targetId`, `evidence`.

- `exact`: target must be earlier; quote text and optional speaker must exactly match under identity normalization.
- `inferred`: explicit earlier target and nonempty reasoning `evidence` required, e.g. observed truncated quote.
- `unresolved`: preserve quote text without a target.
- `image-only`: preserve image marker/quoted description without a target.

Omitted status or `auto` attempts an exact match to earlier messages. A unique match links; zero matches becomes unresolved; multiple matches fail. Supply a reviewed explicit target with `status:"exact"` to disambiguate, or explicitly mark unresolved. Do not silently choose between repeated messages.

Legacy Markdown format:

```md
- <a id="20261011-001"></a> **09:00** · **Synthetic Alice**：Synthetic message
- <a id="20261011-002"></a> **09:01** · **Synthetic Bob**：Synthetic reply
  - 回复：[20261011-001](#20261011-001)
  > Synthetic Alice: Synthetic message
```

Cross-round links use `YYYY-MM-DD-微信聊天记录.md#ID`; inferred links append `（推定）`. Unlinked quote statuses are explicit in Markdown. Blank quote text, duplicate IDs, missing/unknown speakers, invalid times, broken reply fragments, unsafe paths, absent targets and forward/self replies fail validation.

## Media records

Every attached image/sticker has a record. `media` is an array with `kind` (normally `image` or `sticker`; `file` preserves opaque/unsupported originals such as HEIC), `status`, `source`, `evidence:[string]`, and optional `captureId`, `path`, `alt`, `sha256`, `width`, `height`, `mime`, `originalDownloadEvidence`.

| Status | Meaning | Required evidence |
|---|---|---|
| `original_verified` | Bytes came from an observed original-download workflow and passed local integrity verification | `source:"original_download"`, nonempty `originalDownloadEvidence`, expected SHA-256, verified local file |
| `saved_unverified` | Native save produced a local file; original fidelity is not established | `source:"native_save"` or other honest source, local file and capture evidence |
| `preview` | Screenshot, preview or otherwise reduced representation | `source:"screenshot"` or `"preview"`, capture evidence; local file optional |
| `unavailable` | Media exists in source but bytes are inaccessible | Explicit capture evidence, no local path |

`source` enum: `original_download`, `native_save`, `screenshot`, `preview`, `unknown`. Screenshot and preview sources can only have `preview` status. Native Save, zoom labels such as “Original image size,” pixel dimensions, hashes, and a file's presence alone **do not establish original-download provenance**. The CLI validates the evidence declaration and bytes; it cannot independently prove a UI action happened.

`path` is archive-relative under `assets/`. Absolute/remote paths, traversal, percent encoding, backslashes, colon schemes, and symlink escapes fail. Renderable images must be PNG, JPEG, GIF or WebP; SVG and HTML are rejected as images. Magic-byte image dimensions are checked, and supplied MIME/dimensions/hash must match. Computed `sha256`, `width`, `height`, `mime`, `bytes`, and `metadataVerified` are retained. On macOS `/usr/bin/sips` must successfully decode to a temporary PNG; that result is retained as `decoded:true`, and temporary files are removed. Other platforms retain `decoded:false` and explicitly require manual trusted-viewer checks. Local format/header/hash checks do not prove original-download provenance or visual fidelity. Files are reverified when reading/building an archive.

For unsupported native formats, use `kind:"file"`: the bytes are preserved unchanged, hashed, and shown as a plain local path. The reader neither decodes nor links an opaque file, and does not claim image dimensions. This preserves originals without converting or deleting them.

Run `node examples/synthetic/demo.mjs /absolute/new-demo-directory` for a synthetic archive with two speakers, a reply, a generated raster checkerboard, and a deliberately unavailable media record. Its incomplete status is intentional. No real chat content is included.

## Participants

Each alias record has `displayName`, `alias`, `status` and nonempty `evidence:[string]`. The generated participant table retains evidence. Conflicting aliases fail until explicitly resolved; aliases never rewrite historical speakers. Evidence may cite observed UI attribution or explicit human confirmation, not a guessed identity.

## Library

`archive.mjs` exports `initArchive`, `importCapture`, `readArchive`, `buildArchive`, `buildHtml`, `renderMarkdown`, `parseMarkdown`, `validateRound`, `mergePages`, `trimIncremental`, `messageIdentity`, `verifyMedia`, `imageInfo`, `safeAssetPath`, `localAsset`, `roundFilename`, `renderParticipants`, and `main`. `validate-chat-round.mjs` exports `validateMarkdownFiles`. Validation returns counts and completeness status separately; it never changes an incomplete capture to complete.
