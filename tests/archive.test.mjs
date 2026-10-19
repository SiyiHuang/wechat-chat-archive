import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { initArchive, importCapture, readArchive, mergePages, trimIncremental, validateRound, buildHtml, safeAssetPath, verifyMedia, parseMarkdown, renderMarkdown, imageInfo, buildArchive, parseRoundFilename, main, normalizeWechatTimestamp, messageIdentity } from '../skills/archive-wechat-chat/scripts/archive.mjs';
import { createHash } from 'node:crypto';
import { validateMarkdownFiles } from '../skills/archive-wechat-chat/scripts/validate-chat-round.mjs';
import { createSyntheticPng } from '../examples/synthetic/image-fixture.mjs';

const msg = (body, timestamp = '2026-10-11 09:00', speaker = 'Synthetic Alice') => ({ speaker, timestamp, body, evidence: { speaker: ['Synthetic speaker screenshot'], body: ['Synthetic AX full message'], timestamp: ['Synthetic explicit date/time label'] } });
const capture = (messages, overrides = {}) => ({ date: '2026-10-11', round: '01', window: 'Synthetic Chat History', source: { mode: 'merged_forward', subjectId: 'synthetic-conversation', scopeId: 'synthetic-forward-artifact', title: 'Synthetic Chat History', identityEvidence: ['Synthetic group and prepared forward artifact identity'] }, captureOrder: 'older_to_newer', requestedRange: { label: 'Entire synthetic forward artifact', evidence: ['Synthetic requested artifact'] }, boundaries: { start: { kind: 'visible_marker', direction: 'toward_older', evidence: ['Synthetic start marker'] }, end: { kind: 'visible_marker', direction: 'toward_newer', evidence: ['Synthetic end marker'] } }, captureMethod: 'Synthetic accessibility + synthetic screenshots', captureEvidence: { textSources: ['synthetic accessibility fixture'], screenshotRefs: ['synthetic screenshot context'], speakerVerification: 'all', endDetection: 'visible_end' }, completeness: { status: 'complete', recognizedItems: messages.length, skippedMedia: 0, evidence: ['Synthetic end marker and checked attribution'], limitations: [] }, participants: [], messages, ...overrides });
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-synthetic-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
const png = createSyntheticPng(1, 1);

test('maximal ordered overlap preserves legitimate repetition', () => {
  const a = msg('repeat'), b = msg('different', '2026-10-11 09:01');
  const result = mergePages([{ messages: [a, a, b] }, { messages: [a, b, a, a] }]);
  assert.deepEqual(result.overlaps, [0, 2]);
  assert.deepEqual(result.messages.map(m => m.body), ['repeat', 'repeat', 'different', 'repeat', 'repeat']);
  assert.throws(() => mergePages([{ messages: [a] }, { messages: [b] }]), /no ordered overlap/);
  assert.equal(mergePages([{ messages: [a] }, { messages: [b], contiguousEvidence: ['Adjacent end/start verified'] }]).messages.length, 2);
});

test('incremental anchoring fails missing, ambiguous, or unconfirmed preceding context', () => {
  const a = { ...msg('repeat'), id: 'old-001' }, b = { ...msg('last', '2026-10-11 09:01'), id: 'old-002' };
  assert.equal(trimIncremental([a, b, msg('new')], [a, b]).overlap, 2);
  assert.throws(() => trimIncremental([b, b], [a, b]), /Ambiguous/);
  assert.throws(() => trimIncremental([a], [a, b]), /not found/);
  assert.throws(() => trimIncremental([msg('wrong'), b], [a, b]), /exact suffix/);
  assert.throws(() => trimIncremental([b], [a,b], a.id), /latest/);
});

test('init refuses overwrite and arbitrary existing files', async t => {
  const root = await temp(t); await initArchive(root);
  await assert.rejects(initArchive(root), /already initialized/);
  const other = await temp(t); await fs.writeFile(path.join(other, 'user.md'), 'existing');
  await assert.rejects(initArchive(other), /empty directory/);
  assert.equal(await fs.readFile(path.join(other, 'user.md'), 'utf8'), 'existing');
});

test('import canonical Markdown and sidecar, incremental cross-round replies, never overwrite', async t => {
  const root = await temp(t); await initArchive(root);
  const first = [msg('Opening <script>" & * question\nsecond line'), msg('Answer', '2026-10-11 09:01')];
  const result = await importCapture(root, capture(first, { participants: [{ displayName: 'Synthetic Alice', alias: 'Synthetic A', status: 'confirmed', evidence: ['Synthetic UI alias observation'] }] }));
  assert.equal(result.messages, 2);
  await assert.rejects(importCapture(root, capture(first)), /already exists/);
  const next = capture([first[1], { ...msg('Follow-up', '2026-10-11 09:02', 'Synthetic Bob'), quote: { text: first[0].body, speaker: first[0].speaker } }], { round: '02' });
  assert.equal((await importCapture(root, next)).overlap, 1);
  const archive = await readArchive(root);
  assert.equal(archive.messages.length, 3);
  assert.equal(archive.messages[2].quote.status, 'exact');
  assert.equal(archive.messages[2].quote.targetId, '20261011-001');
  const markdown = await fs.readFile(path.join(root, 'IMPORT', '2026-10-11-02-微信聊天记录.md'), 'utf8');
  assert.match(markdown, /2026-10-11-微信聊天记录.md#20261011-001/);
  assert.equal((await validateMarkdownFiles([root])).messages, 3);
  const index = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /Opening &lt;script&gt;/);
  assert.match(index, /Synthetic A/);
});

test('sidecar cannot silently replace user Markdown edits', async t => {
  const root = await temp(t); await initArchive(root);
  const result = await importCapture(root, capture([msg('Original')]));
  await fs.appendFile(result.file, '\nUser edit\n');
  await assert.rejects(readArchive(root), /Markdown changed/);
});

test('JSON semantic edits cannot silently conflict with Markdown', async t => {
  const root = await temp(t); await initArchive(root);
  const result = await importCapture(root, capture([msg('Original')]));
  const file = result.file.replace(/\.md$/, '.json'); const round = JSON.parse(await fs.readFile(file, 'utf8'));
  round.messages[0].body = 'Edited only in JSON'; await fs.writeFile(file, JSON.stringify(round));
  await assert.rejects(readArchive(root), /JSON content conflicts/);
});

test('explicit incomplete status and counts are enforced', async t => {
  const root = await temp(t); await initArchive(root);
  const input = capture([msg('Only part')], { completeness: { status: 'incomplete', recognizedItems: 1, skippedMedia: 0, evidence: [], limitations: ['End not reached'] }, captureEvidence: {} });
  await assert.rejects(importCapture(root, input), /--allow-incomplete/);
  assert.equal((await importCapture(root, input, { allowIncomplete: true })).totals.incompleteRounds, 1);
  const other = await temp(t); await initArchive(other);
  const wrong = capture([msg('One')]); wrong.completeness.recognizedItems = 2;
  await assert.rejects(importCapture(other, wrong), /counts do not reconcile/);
  wrong.completeness.recognizedItems = 1; wrong.captureEvidence.speakerVerification = 'partial';
  await assert.rejects(importCapture(other, wrong), /every speaker verified/);
});

test('retained sticker placeholders preserve the message without counting it as skipped', async t => {
  const root = await temp(t); await initArchive(root);
  const sticker = { ...msg('[表情包：合成占位]'), media: [{ kind: 'sticker', status: 'preview', source: 'screenshot', evidence: ['Synthetic screenshot shows a sticker, no dynamic bytes retained'] }] };
  const input = capture([sticker], { completeness: { status: 'incomplete', recognizedItems: 1, skippedMedia: 0, evidence: ['Synthetic sticker occurrence'], limitations: ['Dynamic sticker file was not extracted; placeholder is archive text'] } });
  await assert.rejects(importCapture(root, input), /--allow-incomplete/);
  const result = await importCapture(root, input, { allowIncomplete: true });
  assert.equal(result.messages, 1);
  const round = (await readArchive(root)).rounds[0];
  assert.equal(round.completeness.skippedMedia, 0);
  assert.equal(round.messages[0].media[0].status, 'preview');
  assert.equal(round.messages[0].body, '[表情包：合成占位]');
});

test('omitted sticker-only records reconcile counts and require exclusion evidence', async t => {
  const root = await temp(t); await initArchive(root);
  const input = capture([msg('Retained text')], { completeness: { status: 'incomplete', recognizedItems: 2, skippedMedia: 1, evidence: ['Synthetic two source occurrences'], limitations: ['One difficult sticker-only record omitted under sticker policy'] } });
  await assert.rejects(importCapture(root, input, { allowIncomplete: true }), /exclusion evidence/);
  input.completeness.skippedMediaEvidence = ['Synthetic screenshot occurrence 2 is the explicitly omitted sticker-only message'];
  const result = await importCapture(root, input, { allowIncomplete: true });
  assert.equal(result.messages, 1);
  const round = (await readArchive(root)).rounds[0];
  assert.equal(round.completeness.recognizedItems, 2);
  assert.equal(round.completeness.skippedMedia, 1);
  assert.equal(round.completeness.status, 'incomplete');
});

test('reply statuses preserve quotes and ambiguous auto matches fail', async t => {
  const root = await temp(t); await initArchive(root);
  const input = capture([msg('Repeated'), msg('Repeated'), { ...msg('Response'), quote: { text: 'Repeated' } }]);
  await assert.rejects(importCapture(root, input), /ambiguous exact quote/);
  input.messages[2].quote = { text: 'Repeated', targetId: '20261011-001' };
  input.messages.push({ ...msg('Photo reply'), quote: { text: '[Photo]', speaker: 'Synthetic Bob', status: 'image-only' } });
  input.messages.push({ ...msg('Unresolved reply'), quote: { text: 'unavailable older text', status: 'unresolved' } });
  input.messages.push({ ...msg('Truncated reply'), quote: { text: 'Repea…', status: 'inferred', targetId: '20261011-002', evidence: ['Synthetic truncated quote attribution'] } });
  input.completeness.recognizedItems = input.messages.length;
  await importCapture(root, input);
  const round = (await readArchive(root)).rounds[0];
  assert.deepEqual(round.messages.slice(2).map(m => m.quote.status), ['exact','image-only','unresolved','inferred']);
  round.messages[2].quote.targetId = 'missing'; assert.equal(validateRound(round).valid, false);
  round.messages[2].quote.targetId = round.messages[2].id; assert.equal(validateRound(round).valid, false);
  round.messages[2].quote.targetId = round.messages[0].id; round.messages[2].quote.text = 'false exact'; assert.equal(validateRound(round).valid, false);
});

test('HTML escapes text, names, attributes and has no remote assets', () => {
  const round = { date: '2026-10-11', round: '01', messages: [], participants: [], completeness: { status: 'incomplete', limitations: ['<img src=x onerror=alert(1)>'] } };
  const m = { ...msg('<script>alert(1)</script>', '09:00', '" onmouseover="alert(1)'), id: 'safe-001', roundFile: '2026-10-11-微信聊天记录.md', quote: { status: 'unresolved', text: '</blockquote><script>alert(2)</script>' } };
  round.messages = [m]; const result = buildHtml({ rounds: [round], messages: [m] });
  assert.ok(!result.includes('<script>alert(')); assert.ok(result.includes('&lt;script&gt;'));
  assert.ok(result.includes('&quot; onmouseover=&quot;'));
  assert.ok(!/https?:\/\//.test(result)); assert.match(result, /connect-src 'none'/);
  assert.match(result, /article\.hidden/); assert.match(result, /href="#safe-001"/);
});

test('safe assets reject traversal, remote paths and symlink escapes', async t => {
  for (const bad of ['../x', '/tmp/a', 'assets/../a', 'assets//a', 'assets/a\\b', 'assets/%2e%2e/a', 'https://a/x', 'assets/javascript:x', 'C:\\a']) assert.throws(() => safeAssetPath(bad));
  assert.equal(safeAssetPath('assets/合成 image.png'), 'assets/合成 image.png');
  const root = await temp(t); await initArchive(root); const other = await temp(t);
  await fs.writeFile(path.join(other, 'outside.png'), png); await fs.symlink(path.join(other, 'outside.png'), path.join(root, 'assets', 'escape.png'));
  await assert.rejects(verifyMedia(root, { status: 'saved_unverified', source: 'native_save', evidence: ['synthetic save'], path: 'assets/escape.png' }), /escapes archive/);
});

test('media file checks distinguish original download from native save and screenshot', async t => {
  const root = await temp(t); await initArchive(root); await fs.writeFile(path.join(root, 'assets', 'synthetic.png'), png);
  const saved = { status: 'saved_unverified', source: 'native_save', evidence: ['Synthetic native save'], path: 'assets/synthetic.png' };
  const verified = await verifyMedia(root, saved);
  assert.equal(verified.status, 'saved_unverified'); assert.equal(verified.width, 1); assert.equal(verified.height, 1); assert.equal(verified.sha256.length, 64);
  await assert.rejects(verifyMedia(root, { ...saved, status: 'original_verified', sha256: verified.sha256 }), /original-download evidence/);
  await assert.rejects(verifyMedia(root, { ...saved, source: 'screenshot', status: 'original_verified', sha256: verified.sha256 }), /original-download evidence/);
  await assert.rejects(verifyMedia(root, { ...saved, source: 'screenshot' }), /only have preview/);
  await assert.rejects(verifyMedia(root, { ...saved, source: 'preview' }), /only have preview/);
  await assert.rejects(verifyMedia(root, { ...saved, sha256: '0'.repeat(64) }), /hash mismatch/);
  await assert.rejects(verifyMedia(root, { ...saved, width: 2 }), /width mismatch/);
  assert.equal((await verifyMedia(root, { ...saved, source: 'original_download', status: 'original_verified', sha256: verified.sha256, originalDownloadEvidence: ['Synthetic original-download action + selected source'] })).status, 'original_verified');
  assert.equal((await verifyMedia(root, { ...saved, source: 'screenshot', status: 'preview' })).status, 'preview');
  await fs.writeFile(path.join(root, 'assets', 'unsafe.svg'), '<svg onload="alert(1)"/>');
  await assert.rejects(verifyMedia(root, { ...saved, path: 'assets/unsafe.svg' }), /Unsupported/);
  const input = capture([{ ...msg(''), media: [saved, { status: 'unavailable', source: 'unknown', evidence: ['Synthetic source not accessible'] }] }]);
  await assert.rejects(importCapture(root, input), /requires incomplete/);
  input.completeness.status = 'incomplete'; input.completeness.limitations = ['Synthetic image bytes unavailable'];
  await importCapture(root, input, { allowIncomplete: true }); const archive = await readArchive(root);
  assert.equal(archive.messages[0].media.length, 2); assert.match(await fs.readFile(path.join(root, 'index.html'), 'utf8'), /assets\/synthetic.png/);
  await fs.writeFile(path.join(root, 'assets', 'synthetic.png'), Buffer.concat([png, Buffer.from('changed')]));
  await assert.rejects(readArchive(root), /hash mismatch/);
});

test('alias conflicts fail before publication; historical speakers stay unchanged', async t => {
  const root = await temp(t); await initArchive(root);
  const p = { displayName: 'Synthetic Alice', alias: 'Synthetic A', status: 'confirmed', evidence: ['Synthetic UI'] };
  await importCapture(root, capture([msg('First')], { participants: [p] }));
  const next = capture([msg('First'), msg('Second', '2026-10-11 09:02')], { round: '02', participants: [{ ...p, alias: 'Different' }] });
  await assert.rejects(importCapture(root, next), /Conflicting alias/);
  assert.equal((await readArchive(root)).messages.length, 1);
  assert.equal((await readArchive(root)).messages[0].speaker, 'Synthetic Alice');
});

test('legacy Markdown files validate without modification and dangling links fail', async t => {
  const root = await temp(t);
  const file = path.join(root, '2026-07-25-微信聊天记录.md');
  const source = '# 微信聊天记录\n\n- <a id="20260725-001"></a> **09:10** · **Synthetic A**：Original\n\n- <a id="20260725-002"></a> **09:12** · **Synthetic B**：Reply\n  - 回复：[20260725-001](#20260725-001)\n  > Synthetic A: Original\n';
  await fs.writeFile(file, source); assert.equal((await validateMarkdownFiles([file])).messages, 2); assert.equal(await fs.readFile(file, 'utf8'), source);
  await fs.writeFile(file, source.replace('[20260725-001](#20260725-001)', '[missing](#missing)'));
  await assert.rejects(validateMarkdownFiles([file]), /dangling/);
  assert.throws(() => parseMarkdown('- <a id="one"></a> **25:00** · **unknown**：x', 'synthetic.md'), /invalid message/);
});

test('image dimensions recognize common native-save formats', () => {
  assert.deepEqual(imageInfo(png), { mime: 'image/png', width: 1, height: 1 });
  const gif = Buffer.from('47494638396102000300', 'hex'); assert.deepEqual(imageInfo(gif), { mime: 'image/gif', width: 2, height: 3 });
  const jpg = Buffer.from('ffd8ffc000070800030002ffd9', 'hex'); assert.deepEqual(imageInfo(jpg), { mime: 'image/jpeg', width: 2, height: 3 });
  assert.throws(() => imageInfo(Buffer.from('not an image')), /Unsupported/);
});

test('multiline and Markdown-special names roundtrip in canonical text', () => {
  const messages = [{ ...msg('line one\nline two\n- 回复：正文中的文字\n> literal quote marker\n\nlast line', '09:00', 'Synthetic *A*'), id: '20261011-001' }];
  const round = { ...capture(messages), schemaVersion: 1, continuity: { overlap: 0, anchorId: null } };
  const parsed = parseMarkdown(renderMarkdown(round), '2026-10-11-微信聊天记录.md');
  assert.equal(parsed[0].speaker, messages[0].speaker); assert.equal(parsed[0].body, messages[0].body);
});

test('generated reader script filters, resets and reveals reply targets', () => {
  const rounds = [{ date: '2026-10-11', round: '01', messages: [], participants: [], completeness: { status: 'complete', limitations: [] } }];
  const articles = [
    { id: 'one', tagName: 'ARTICLE', dataset: { speaker: 'A', date: '2026-10-11', media: 'no', quote: 'none' }, textContent: 'Alpha discussion', hidden: false, scrollIntoView() { this.scrolled = true; } },
    { id: 'two', tagName: 'ARTICLE', dataset: { speaker: 'B', date: '2026-10-11', media: 'yes', quote: 'exact' }, textContent: 'Beta response', hidden: false, scrollIntoView() { this.scrolled = true; } }
  ];
  const controls = Object.fromEntries(['search','speaker','date','media','quote','reset','count'].map(id => [id, { value: '', handlers: {}, addEventListener(event, fn) { this.handlers[event] = fn; } }]));
  const handlers = {};
  const document = { querySelectorAll: () => articles, getElementById: id => controls[id] ?? articles.find(a => a.id === id), addEventListener: (event, fn) => { handlers[event] = fn; } };
  const script = buildHtml({ rounds, messages: [] }).match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(script, { document, location: { hash: '' }, addEventListener: (event, fn) => { handlers[event] = fn; } });
  assert.equal(controls.count.textContent, '2 / 2 条消息');
  controls.search.value = 'alpha'; controls.search.handlers.input(); assert.deepEqual(articles.map(a => a.hidden), [false,true]);
  controls.search.value = ''; controls.speaker.value = 'B'; controls.speaker.handlers.input(); assert.deepEqual(articles.map(a => a.hidden), [true,false]);
  controls.reset.handlers.click(); assert.deepEqual(articles.map(a => a.hidden), [false,false]);
  controls.media.value = 'yes'; controls.media.handlers.input(); assert.equal(articles[0].hidden, true);
  handlers.click({ target: { closest: () => ({ getAttribute: () => '#one' }) } });
  assert.equal(articles[0].hidden, false); assert.equal(articles[0].scrolled, true); assert.equal(controls.media.value, '');
});

test('media anchor normalization happens before incremental matching; missing assets stay fatal', async t => {
  const root = await temp(t); await initArchive(root); await fs.writeFile(path.join(root, 'assets', 'same.png'), png);
  const media = { status: 'saved_unverified', source: 'native_save', path: 'assets/same.png', evidence: ['Synthetic save'] };
  const anchor = { ...msg('Image'), media: [media] };
  await importCapture(root, capture([anchor]));
  assert.equal((await importCapture(root, capture([anchor, msg('New', '2026-10-11 09:01')], { round: '02' }))).overlap, 1);
  await fs.rm(path.join(root, 'assets', 'same.png'));
  await assert.rejects(readArchive(root), /ENOENT/);
});

test('legacy round filenames preserve first-round ordering and quote speaker identity', async t => {
  const root = await temp(t); await initArchive(root);
  const first = '- <a id="20260725-001"></a> **09:00** · **Synthetic A**：Old\n';
  const second = '- <a id="20260725-02-001"></a> **09:01** · **Synthetic B**：Reply\n  - 回复：[20260725-001](2026-07-25-微信聊天记录.md#20260725-001)\n  > Synthetic A: Old\n';
  await fs.writeFile(path.join(root, 'IMPORT', '2026-07-25-微信聊天记录.md'), first);
  await fs.writeFile(path.join(root, 'IMPORT', '2026-07-25-02-微信聊天记录.md'), second);
  assert.equal((await validateMarkdownFiles([path.join(root, 'IMPORT', '2026-07-25-02-微信聊天记录.md'), path.join(root, 'IMPORT', '2026-07-25-微信聊天记录.md')])).messages, 2);
  const archive = await readArchive(root); assert.deepEqual(archive.rounds.map(r => r.round), ['01', '02']);
  assert.equal(archive.messages[1].quote.speaker, 'Synthetic A'); assert.equal(archive.messages[1].quote.text, 'Old');
  const next = capture([{ speaker: 'Synthetic B', timestamp: '09:01', body: 'Reply', quote: { speaker: 'Synthetic A', text: 'Old', status: 'exact', targetId: '20260725-001' } }, msg('New', '2026-10-11 09:02')]);
  next.source.legacyBindingEvidence = ['Synthetic legacy files confirmed as this synthetic conversation'];
  assert.equal((await importCapture(root, next)).overlap, 1);
  assert.deepEqual(parseRoundFilename('2026-07-25-微信聊天记录.md'), { date: '2026-07-25', round: '01' });
});

test('manual participant files and edits are never overwritten', async t => {
  const root = await temp(t); await initArchive(root); const participantFile = path.join(root, 'PARTICIPANTS.md');
  await fs.writeFile(participantFile, 'Human alias evidence');
  await assert.rejects(importCapture(root, capture([msg('First')])), /untracked or manually edited/);
  assert.equal(await fs.readFile(participantFile, 'utf8'), 'Human alias evidence');
  await fs.rm(participantFile); await importCapture(root, capture([msg('First')]));
  await fs.appendFile(participantFile, '\nHuman update');
  await assert.rejects(buildArchive(root), /manually edited/);
});

test('new timestamps require source dates; CLI help is successful', async t => {
  const root = await temp(t); await initArchive(root);
  await assert.rejects(importCapture(root, capture([msg('New', '09:00')])), /source-confirmed/);
  assert.ok((await main(['--help'])).usage);
});

test('opaque unsupported media is preserved without image rendering', async t => {
  const root = await temp(t); await initArchive(root);
  await fs.writeFile(path.join(root, 'assets', 'synthetic.heic'), Buffer.from('Synthetic opaque file, not a real HEIC'));
  const input = capture([{ ...msg('Opaque source'), media: [{ kind: 'file', status: 'saved_unverified', source: 'native_save', evidence: ['Synthetic opaque native save'], path: 'assets/synthetic.heic' }] }]);
  await importCapture(root, input); const result = await readArchive(root);
  assert.equal(result.messages[0].media[0].mime, 'application/octet-stream');
  const reader = await fs.readFile(path.join(root, 'index.html'), 'utf8'); assert.ok(!reader.includes('<img')); assert.match(reader, /synthetic.heic/);
});

test('macOS decoder rejects header-only fake images', { skip: process.platform !== 'darwin' }, async t => {
  const root = await temp(t); await initArchive(root); const fake = Buffer.alloc(24); png.copy(fake, 0, 0, 24);
  await fs.writeFile(path.join(root, 'assets', 'fake.png'), fake);
  await assert.rejects(verifyMedia(root, { status: 'saved_unverified', source: 'native_save', evidence: ['Synthetic corrupt fixture'], path: 'assets/fake.png' }), /decode failed/);
});

test('nonpadded full dates normalize without losing the source label', async t => {
  assert.equal(normalizeWechatTimestamp('2026-3-4 09:05'), '2026-03-04 09:05');
  assert.equal(normalizeWechatTimestamp('2026-8-2 1:18:03'), '2026-08-02 01:18:03');
  assert.throws(() => normalizeWechatTimestamp('2026-2-30 09:00'), /Invalid timestamp/);
  assert.throws(() => normalizeWechatTimestamp('昨天 09:00'), /without a confirmed full date/);
  const root = await temp(t); await initArchive(root); await importCapture(root, capture([msg('Message', '2026-3-4 09:05')]));
  const message = (await readArchive(root)).messages[0];
  assert.equal(message.timestampRaw, '2026-3-4 09:05'); assert.equal(message.timestamp, '2026-03-04 09:05');
});

test('source binding rejects unrelated conversations and forward scopes before publication', async t => {
  const root = await temp(t); await initArchive(root); const source = capture([]).source;
  const missing = capture([msg('First')]); delete missing.source;
  await assert.rejects(importCapture(root, missing), /require an observed source/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'archive.json'), 'utf8')).sourceBinding, undefined);
  await importCapture(root, capture([msg('First')]));
  const other = capture([msg('First'), msg('Second')], { round: '02', source: { ...source, subjectId: 'different-chat' } });
  await assert.rejects(importCapture(root, other), /Wrong conversation/);
  other.source = { ...source, scopeId: 'different-forward-card' };
  await assert.rejects(importCapture(root, other), /Wrong conversation/);
  assert.equal((await readArchive(root)).messages.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'archive.json'), 'utf8')).sourceBinding, { subjectId: source.subjectId, scopeId: source.scopeId });
});

test('newer-to-older scanning reverses pages only and preserves display sequence', async t => {
  const root = await temp(t); await initArchive(root);
  const a = msg('oldest', '2026-10-11 08:00'), b = msg('middle', '2026-10-11 08:01'), c = msg('newest', '2026-10-11 08:02');
  const input = capture([], { captureOrder: 'newer_to_older', pages: [{ messages: [b,c] }, { messages: [a,b] }] }); delete input.messages;
  input.completeness.recognizedItems = 3;
  await importCapture(root, input);
  assert.deepEqual((await readArchive(root)).messages.map(m => m.body), ['oldest','middle','newest']);
  assert.deepEqual((await readArchive(root)).messages.map(m => m.id), ['20261011-001','20261011-002','20261011-003']);
});

test('repeated page overlaps require reviewed occurrence evidence', () => {
  const a = msg('Same');
  assert.throws(() => mergePages([{ messages: [a,a] }, { messages: [a,a,msg('new')] }]), /ambiguous repeated overlap/);
  const reviewed = mergePages([{ messages: [a,a] }, { messages: [a,a,msg('new')], overlap: { count: 1, evidence: ['Synthetic screenshots show one old occurrence and one new repeat'] } }]);
  assert.equal(reviewed.messages.length, 4); assert.deepEqual(reviewed.overlaps, [0,1]);
  assert.throws(() => mergePages([{ messages: [a] }, { messages: [msg('new')], overlap: { count: 1, evidence: ['wrong'] } }]), /disagrees/);
});

test('overlap unions author and text evidence recovered from adjacent screenshots', () => {
  const partial = msg('Long full AX message'); partial.evidence.speaker = [];
  const verified = msg('Long full AX message'); verified.evidence.speaker = ['Synthetic second screenshot shows complete author']; verified.evidence.body = ['Second AX snapshot'];
  const result = mergePages([{ messages: [partial] }, { messages: [verified, msg('Next')] }]);
  assert.deepEqual(result.messages[0].evidence.speaker, verified.evidence.speaker);
  assert.deepEqual(result.messages[0].evidence.body, ['Synthetic AX full message', 'Second AX snapshot']);
});

test('repeated incremental anchor can be resolved only by a unique ordered context', () => {
  const a = { ...msg('distinct predecessor'), id: 'old-1' }, b = { ...msg('repeat'), id: 'old-2' };
  const result = trimIncremental([a,b,msg('new'),b], [a,b]);
  assert.equal(result.overlap, 2); assert.equal(result.messages.length, 2);
  assert.throws(() => trimIncremental([b,msg('new'),b], [a,b]), /Ambiguous/);
});

test('complete source capture requires both directed boundaries and settled edge proof', async t => {
  const root = await temp(t); await initArchive(root);
  const input = capture([msg('First')]); delete input.boundaries.start;
  await assert.rejects(importCapture(root, input), /start boundary/);
  input.boundaries = capture([]).boundaries; input.boundaries.end = { kind: 'confirmed_scroll_boundary', direction: 'toward_newer', evidence: ['Same text twice'] };
  await assert.rejects(importCapture(root, input), /unchanged viewport alone/);
  input.boundaries.end.positionEvidence = ['Synthetic scrollbar at bottom']; input.boundaries.end.settledEvidence = ['Synthetic loading completed and final row checked'];
  input.messages[0].evidence.speaker = [];
  await assert.rejects(importCapture(root, input), /per-message speaker/);
  input.messages[0].evidence.speaker = ['Synthetic author visible in overlapping screenshot']; await importCapture(root, input);
});

test('history search can claim only the explicitly requested search scope', async t => {
  const root = await temp(t); await initArchive(root); const input = capture([msg('Result')]); input.source.mode = 'history_search';
  await assert.rejects(importCapture(root, input), /requested result scope/);
  input.boundaries.start.kind = 'requested_range'; input.boundaries.end.kind = 'requested_range';
  input.requestedRange.label = 'Synthetic named search results, not all conversation history'; await importCapture(root, input);
});

test('existing canonical source-less v1 rounds remain byte-for-byte readable', async t => {
  const root = await temp(t); await initArchive(root);
  const round = { ...capture([{ ...msg('Old canonical message'), id: '20261011-001' }]), schemaVersion: 1, continuity: { overlap: 0, anchorId: null } };
  delete round.source; delete round.captureOrder; delete round.requestedRange; delete round.boundaries;
  const markdown = renderMarkdown(round); round.markdownSha256 = createHash('sha256').update(markdown).digest('hex');
  const file = path.join(root, 'IMPORT', '2026-10-11-微信聊天记录.md'); await fs.writeFile(file, markdown); const json = JSON.stringify(round); await fs.writeFile(file.replace(/\.md$/, '.json'), json);
  assert.equal((await readArchive(root)).messages[0].id, '20261011-001'); assert.equal(await fs.readFile(file, 'utf8'), markdown); assert.equal(await fs.readFile(file.replace(/\.md$/, '.json'), 'utf8'), json);
  const input = capture([msg('Old canonical message'), msg('Next')], { round: '02' });
  await assert.rejects(importCapture(root, input), /legacyBindingEvidence/); input.source.legacyBindingEvidence = ['Synthetic old canonical archive belongs to this subject'];
  assert.equal((await importCapture(root, input)).overlap, 1);
});

test('main-chat separator times stay contextual while content coverage can be complete', async t => {
  const root = await temp(t); await initArchive(root);
  const exact = msg('Explicit source timestamp', '2026-3-4 17:34');
  const contextual = { ...msg('No individual time label', null), timeContext: { kind: 'separator', label: '17:34', evidence: ['Synthetic separator appears above this group'] } };
  const absent = { ...msg('No time label anywhere', null), timeContext: { kind: 'not_displayed', evidence: ['Synthetic screenshot and AX show no per-message time'] } };
  const input = capture([exact, contextual, absent]); input.source.mode = 'main_chat'; input.source.scopeId = 'synthetic-main-history';
  const result = await importCapture(root, input); assert.equal(result.status, 'complete');
  const archive = await readArchive(root), round = archive.rounds[0];
  assert.deepEqual(round.timePrecision, { exact: 1, separator: 1, notDisplayed: 1 });
  assert.equal(archive.messages[1].timestamp, null); assert.equal(archive.messages[1].timestampRaw, '17:34');
  assert.equal(archive.messages[2].timestampRaw, null);
  const markdown = await fs.readFile(result.file, 'utf8');
  assert.match(markdown, /\*\*时间未逐条显示（分隔标注：17:34）\*\*/); assert.match(markdown, /未显示时间 1 条/);
  const parsed = parseMarkdown(markdown, path.basename(result.file)); assert.equal(parsed[1].timestamp, null); assert.equal(parsed[1].timeContext.label, '17:34'); assert.equal(parsed[2].timestamp, null);
  assert.equal((await validateMarkdownFiles([result.file])).messages, 3);
  const reader = await fs.readFile(path.join(root, 'index.html'), 'utf8'); assert.match(reader, /仅分隔标注 1/); assert.match(reader, /时间未逐条显示（分隔标注：17:34）/);
  const next = capture([absent, msg('Next', null)], { round: '02' }); next.source = input.source; next.messages[1].timeContext = contextual.timeContext;
  assert.equal((await importCapture(root, next)).overlap, 1);
});

test('missing-time identity uses observed context and never invents or infers a date', async t => {
  const base = { ...msg('Same text', null), timeContext: { kind: 'separator', label: '17:34', evidence: ['Synthetic separator'] } };
  const later = structuredClone(base); later.timeContext.label = '18:00';
  assert.notEqual(messageIdentity(base), messageIdentity(later));
  const otherCapture = structuredClone(base); otherCapture.timeContext.evidence = ['Different screenshot of the same separator']; assert.equal(messageIdentity(base), messageIdentity(otherCapture));
  const group = structuredClone(base); group.timeContext.contextId = 'separate-observed-group'; assert.notEqual(messageIdentity(base), messageIdentity(group));
  const root = await temp(t); await initArchive(root);
  const missing = msg('No timestamp', null); await assert.rejects(importCapture(root, capture([missing])), /evidenced timeContext/);
  const guessedDate = structuredClone(base); guessedDate.timeContext.date = '2026-10-11'; await assert.rejects(importCapture(root, capture([guessedDate])), /evidenced timeContext/);
  guessedDate.timeContext.dateEvidence = ['Synthetic date header visible, not extraction filename']; await importCapture(root, capture([guessedDate]));
  assert.equal((await readArchive(root)).messages[0].timestamp, null);
});

test('unverified main author cannot enter canonical messages under a fabricated placeholder', async t => {
  const root = await temp(t); await initArchive(root); const input = capture([msg('Unattributed self-side text', '2026-10-11 17:34', 'unknown')]); input.source.mode = 'main_chat';
  await assert.rejects(importCapture(root, input), /missing reliable speaker/);
  assert.equal((await readArchive(root)).messages.length, 0); assert.equal(input.messages[0].body, 'Unattributed self-side text');
});
