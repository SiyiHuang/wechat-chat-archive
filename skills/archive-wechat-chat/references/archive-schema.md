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

Use structured JSON with `date` (valid `YYYY-MM-DD` extraction date), `round` (positive padded string, default `01`), `window`, `source`, `requestedRange`, `captureOrder`, `boundaries`, `captureMethod`, `messages` **or** `pages`, `captureEvidence`, `completeness`, and optional `participants` / `anchorId`. New imports require source context; existing source-less version-1 rounds remain readable and byte-for-byte unchanged.

`source` has `mode:"main_chat"|"merged_forward"|"history_search"`, `subjectId`, `scopeId`, `title`, and nonempty `identityEvidence:[string]`. `subjectId` names the evidenced original conversation; `scopeId` names the selected live history, prepared forward artifact, or search scope. They are locally assigned identifiers grounded in observed evidence, not guessed native WeChat IDs. A generic window title such as `Chat History for Saved Groups` does not identify a conversation or forward artifact. An archive binds its first imported `subjectId` + `scopeId`; another subject or scope needs its own archive directory. Main chat and forwarded artifacts use distinct scopes by default. Matching display names or matching message text do not justify assigning the same identity across windows. Binding old source-less rounds requires nonempty `source.legacyBindingEvidence` that explicitly connects the old archive to this source. Failed validation does not bind an empty archive.

`requestedRange` has a meaningful `label`, optional observed `start` / `end` labels, and nonempty `evidence:[string]`. Complete always refers to this requested content scope, not all possible messages in the original conversation. `history_search` covers a finite result scope only.

`captureOrder` is `older_to_newer` or `newer_to_older` and describes the **order pages were captured**. Every page's `messages` must remain in the visual top-to-bottom order obtained from a fresh full AX tree plus screenshot. For upward scanning, the CLI reverses the page array only; it never reverses messages within each page or sorts by timestamp. A flat `messages` input must already be `older_to_newer`. CUA incremental AX diffs can print newly added earlier rows at the end: diff output order is not message order. Refresh the full tree for each page; transient AX element numbers can change and are not stable message identities. Optional page `orderEvidence:[string]` records the full-snapshot ordering reference.

`boundaries` has `start` and `end` records. Each record has `kind:"visible_marker"|"confirmed_scroll_boundary"|"requested_range"`, `direction:"toward_older"` for start or `"toward_newer"` for end, and nonempty `evidence:[string]`. `confirmed_scroll_boundary` additionally requires `positionEvidence:[string]` (e.g. scrollbar at the corresponding edge and last row fully checked) and `settledEvidence:[string]` (loading settled/reload check); two unchanged text snapshots alone are insufficient. Top-edge upward scrolling cannot prove the newest end. Complete captures require both directed boundaries. `history_search` requires `requested_range` boundaries; it cannot claim the full chat. If an endpoint is not proved, preserve an incomplete round with the exact coverage limitation.

`pages` is an ordered array of `{messages:[...]}`. Adjacent pages merge using exact suffix/prefix identity. If multiple overlap lengths or repeated identical sequences permit different occurrence alignments, import fails rather than silently discarding a legitimate repeat. The chronologically later page may explicitly provide `overlap:{count:integer,evidence:[string]}` based on reviewed AX/screenshot occurrence evidence; its selected suffix/prefix must still match exactly. A page without overlap requires `contiguousEvidence:["observed boundary evidence"]`. Reviewed overlap, ordering and contiguity evidence are retained under `continuity.pageEvidence` with the original captured page index. `completeness.recognizedItems` counts unique captured records **after page overlap is removed and before prior-round overlap is removed**.

When an overlap supplies additional per-message evidence, the CLI unions its evidence arrays without rewriting speaker, body or time. This allows a complete AX message to retain its author attribution from an adjacent screenshot after that author becomes visible. A visually clipped first/last item can have complete AX text, but its author still needs visible attribution from this or an overlapping page. Do not drop AX rows merely because they disappeared from an incremental tool diff.

`captureEvidence` contains `textSources:[string]`, `screenshotRefs:[string]` and `speakerVerification:"all"|"partial"`. Legacy `endDetection:"visible_end"|"two_identical_bottom_states"|"not_reached"` remains readable; new source-present captures use the directed `boundaries` above. References identify actual saved captures or precise UI observation contexts. Strings record provenance; the software cannot independently prove a human UI observation.

`completeness` contains:

- `status`: `complete` or `incomplete`.
- `recognizedItems`: nonnegative integer; retained messages + previous-round overlap + explicitly skipped media.
- `skippedMedia`: nonnegative integer, normally zero. In the reconciliation equation this counts wholly omitted media-only message records, not files left undownloaded for retained messages. Ordinary media records are retained by default; difficult stickers may be explicitly omitted under the skill's sticker policy. A media-only message is one recognized record regardless of attachment count.
- `skippedMediaEvidence`: required nonempty string array if media was explicitly excluded.
- `evidence`: string array describing capture coverage.
- `limitations`: string array describing omissions or uncertainty.

`complete` requires nonempty coverage evidence, no known coverage limitations, both text-source and screenshot-attribution references, every retained speaker verified, both scope boundaries proved, and reconciled item counts. Faithful contextual or undisplayed time representation can accompany complete content coverage: it does not claim precise individual timestamps. A round containing preview or unavailable media must be `incomplete` with a media limitation. `saved_unverified` can satisfy exported-file coverage but does not imply original fidelity. Incomplete source captures must state a limitation. Content coverage, time precision, quote resolution and media fidelity are reported separately.

### Completeness and sticker policy

The skill permits text placeholders or omission of difficult stickers without requiring dynamic-file extraction. A retained placeholder is one normal message, not a skipped record. Preserve its author/time evidence and distinguish source-visible text from the archive's placeholder. With actual screenshot evidence, retain a `kind:"sticker", status:"preview", source:"screenshot"` media record; no local `path` is required. Keep `skippedMedia:0` for that retained message. Report the missing dynamic bytes as a media limitation, with `status:"incomplete"` under the existing validator.

If the entire sticker-only message is omitted, increment `skippedMedia` once for that message, keep its source occurrence evidence, and explain the sticker policy and omission in `skippedMediaEvidence` and `limitations`. Include it in `recognizedItems`; mark the round `incomplete` so the allowed omission is visible. Do not increment `skippedMedia` merely because a retained message's attachment was not downloaded, and do not use `unavailable` to mean intentionally skipped. Do not rewrite previous rounds or their overlap identities to adopt a new placeholder policy.

## Messages and ordered identity

Message fields are `speaker`, `timestamp`, `body`, `evidence`, and optional `id`, `timestampRaw`, `timeContext`, `quote`, `media`. `evidence` contains nonempty `speaker:[string]`, `body:[string]`, and `timestamp:[string]` attribution references for every retained new message. AX text without author attribution is insufficient. `body` may be empty only when there is a media record. Speaker is the observed historical display name, never an alias replacement or placeholder such as `unknown`. In main chat, a right-side bubble with no shown name does not justify inventing the account owner's name. Preserve unverified author records in private pending capture/evidence and mark the content range incomplete until attribution is confirmed; do not put them into canonical messages as `unknown`.

If an individual full timestamp is displayed, `timestamp` contains source-confirmed `YYYY-MM-DD HH:MM[:SS]`. Nonpadded full labels such as `2026-3-4 09:05` are normalized to `2026-03-04 09:05`; `timestampRaw` preserves the displayed label. Relative dates or missing years are not guessed. Legacy validation preserves `HH:MM` / `HH:MM:SS`, including an exact time-only old anchor in the discarded overlap. Do not infer dates from extraction filenames.

If individual times are absent, set `timestamp:null` and supply `timeContext:{kind:"separator"|"not_displayed",label?:string,date?:"YYYY-MM-DD",dateEvidence?:[string],evidence:[string],contextId?:string}`. Separator context requires the exact displayed `label`; optional date requires separate source-confirmed `dateEvidence`. `timestampRaw` preserves that label, or remains null when none is displayed. Optional `contextId` distinguishes an evidenced separator occurrence and must be stable in the selected source; never use transient AX numbers. The CLI does not copy a separator's minute into each message. It renders `时间未逐条显示（分隔标注：17:34）` or `时间未显示`, and reports computed `timePrecision:{exact,separator,notDisplayed}` counts in JSON, Markdown and the HTML status section. Context-only times do not by themselves make faithfully captured content incomplete.

Identity compares normalized displayed timestamp or the observed timeContext kind/label/date/contextId, speaker and body, preserved quote speaker/text, and ordered media captureId/hash/path, in that priority. Snapshot filenames and evidence arrays are not identity: another screenshot of the same record must not create another message. Whitespace and Unicode NFC are normalized for comparison only; stored text is preserved. For media across screenshots use an evidenced stable `captureId` consistently across pages and rounds, never a transient AX element number. Timestamps and media are normalized/verified before page and incremental matching. No global text deduplication is performed.

Incremental capture must begin with an exact suffix of existing messages and include the latest archived item. If that last identity repeats, a unique matching preceding suffix of at least two records can disambiguate it; a single repeated record cannot. Multiple valid suffix alignments still fail. `anchorId` optionally checks the expected latest ID; it cannot override ambiguity. Resolve ambiguity with distinctive observed ending context or confirmed source dates. Never select an arbitrary repeat. Re-importing an entirely overlapping block can produce a zero-new-message round without changing existing IDs.

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

Every retained image/sticker attachment has a record; wholly omitted sticker-only messages are accounted for separately under the sticker policy above. `media` is an array with `kind` (normally `image` or `sticker`; `file` preserves opaque/unsupported originals such as HEIC), `status`, `source`, `evidence:[string]`, and optional `captureId`, `path`, `alt`, `sha256`, `width`, `height`, `mime`, `originalDownloadEvidence`.

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

`archive.mjs` exports `initArchive`, `importCapture`, `readArchive`, `buildArchive`, `buildHtml`, `renderMarkdown`, `parseMarkdown`, `validateRound`, `mergePages`, `trimIncremental`, `messageIdentity`, `normalizeWechatTimestamp`, `timestampDisplay`, `timePrecision`, `verifyMedia`, `imageInfo`, `safeAssetPath`, `localAsset`, `roundFilename`, `parseRoundFilename`, `renderParticipants`, and `main`. `validate-chat-round.mjs` exports `validateMarkdownFiles`. Validation returns counts and completeness status separately; it never changes an incomplete capture to complete.
