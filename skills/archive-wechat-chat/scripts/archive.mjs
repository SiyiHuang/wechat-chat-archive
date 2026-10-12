#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const MEDIA_STATUSES = ['original_verified', 'saved_unverified', 'preview', 'unavailable'];
export const QUOTE_STATUSES = ['exact', 'inferred', 'unresolved', 'image-only'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const normalize = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const digest = data => createHash('sha256').update(data).digest('hex');
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const md = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_\[\]]/g, '\\$&');
const unmd = value => value.replace(/\\([\\`*_\[\]>|\-])/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const list = value => Array.isArray(value) && value.every(nonempty);
const runFile = promisify(execFile);

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validTimestamp(value) {
  return typeof value === 'string' && /^(?:\d{4}-\d{2}-\d{2} )?(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
    && (!value.includes(' ') || validDate(value.split(' ')[0]));
}

export function roundFilename(date, round = '01') {
  assert(validDate(date), 'Invalid round date');
  assert(typeof round === 'string' && /^\d{2,}$/.test(round) && Number(round) >= 1, 'Round must be a positive padded string, e.g. 01');
  return `${date}${round === '01' ? '' : `-${round}`}-微信聊天记录.md`;
}

export function parseRoundFilename(filename) {
  const match = path.basename(filename).match(/^(\d{4}-\d{2}-\d{2})(?:-(\d{2,}))?-微信聊天记录\.md$/);
  assert(match && validDate(match[1]), `Invalid archive round filename: ${filename}`);
  return { date: match[1], round: match[2] ?? '01' };
}

export function messageIdentity(message) {
  return JSON.stringify([normalize(message.timestamp), normalize(message.speaker), normalize(message.body),
    message.quote ? [normalize(message.quote.speaker), normalize(message.quote.text)] : null,
    (message.media ?? []).map(m => [m.kind ?? 'image', m.captureId ?? m.sha256 ?? m.path ?? null])]);
}

export function mergePages(pages) {
  assert(Array.isArray(pages) && pages.length > 0, 'Capture needs at least one page');
  const messages = [], overlaps = [];
  for (const [index, page] of pages.entries()) {
    assert(Array.isArray(page.messages), `Page ${index + 1} needs messages`);
    const incoming = page.messages;
    let overlap = 0;
    for (let size = Math.min(messages.length, incoming.length); size > 0; size--) {
      if (messages.slice(-size).every((item, i) => messageIdentity(item) === messageIdentity(incoming[i]))) { overlap = size; break; }
    }
    if (index && incoming.length && messages.length && !overlap) {
      assert(page.contiguousEvidence && list(page.contiguousEvidence) && page.contiguousEvidence.length,
        `Page ${index + 1} has no ordered overlap; provide contiguousEvidence or recapture`);
    }
    overlaps.push(overlap);
    messages.push(...incoming.slice(overlap).map(item => structuredClone(item)));
  }
  return { messages, overlaps };
}

export function trimIncremental(messages, archived, anchorId) {
  if (!archived.length) { assert(!anchorId, 'Anchor supplied for empty archive'); return { messages, overlap: 0, anchorId: null }; }
  const anchor = archived.at(-1);
  assert(!anchorId || anchorId === anchor.id, 'Incremental anchor must be the latest archived message');
  const matches = messages.flatMap((message, index) => messageIdentity(message) === messageIdentity(anchor) ? [index] : []);
  assert(matches.length, `Latest archived anchor ${anchor.id} not found in capture`);
  assert(matches.length === 1, `Ambiguous incremental anchor ${anchor.id}: ${matches.length} matches; capture a distinctive ending context`);
  const end = matches[0] + 1;
  assert(end <= archived.length, 'Capture prefix extends beyond available archived overlap');
  assert(messages.slice(0, end).every((message, i) => messageIdentity(message) === messageIdentity(archived[archived.length - end + i])),
    'Capture leading sequence is not an exact suffix of the archive');
  return { messages: messages.slice(end), overlap: end, anchorId: anchor.id };
}

export function safeAssetPath(relative) {
  assert(nonempty(relative) && !relative.includes('\\') && !relative.includes('\0') && !relative.includes('%'), 'Unsafe local asset path');
  assert(!path.posix.isAbsolute(relative) && !/^[A-Za-z]:/.test(relative) && !relative.includes(':'), 'Asset must be archive-relative');
  const segments = relative.split('/');
  assert(segments[0] === 'assets' && segments.length > 1 && segments.every(p => p && p !== '.' && p !== '..'), 'Assets must be beneath assets/ without traversal');
  return relative;
}

export async function localAsset(root, relative) {
  safeAssetPath(relative);
  const base = await fs.realpath(root);
  const resolved = await fs.realpath(path.join(root, relative));
  assert(resolved.startsWith(`${base}${path.sep}`), `Asset escapes archive via symlink: ${relative}`);
  assert((await fs.stat(resolved)).isFile(), `Asset is not a file: ${relative}`);
  return resolved;
}

export function imageInfo(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    assert(buffer.toString('ascii', 12, 16) === 'IHDR', 'Invalid PNG header');
    return { mime: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && /^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) return { mime: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  if (buffer.length >= 12 && buffer[0] === 255 && buffer[1] === 216) {
    let cursor = 2;
    while (cursor + 3 < buffer.length) {
      if (buffer[cursor++] !== 255) continue;
      while (buffer[cursor] === 255) cursor++;
      const marker = buffer[cursor++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (cursor + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(cursor);
      assert(length >= 2 && cursor + length <= buffer.length, 'Truncated JPEG segment');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        assert(length >= 7, 'Invalid JPEG frame');
        return { mime: 'image/jpeg', width: buffer.readUInt16BE(cursor + 5), height: buffer.readUInt16BE(cursor + 3) };
      }
      cursor += length;
    }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const type = buffer.toString('ascii', 12, 16);
    if (type === 'VP8X') return { mime: 'image/webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (type === 'VP8 ' && buffer[23] === 157 && buffer[24] === 1 && buffer[25] === 42) return { mime: 'image/webp', width: buffer.readUInt16LE(26) & 16383, height: buffer.readUInt16LE(28) & 16383 };
    if (type === 'VP8L' && buffer[20] === 47) return { mime: 'image/webp', width: 1 + (((buffer[22] & 63) << 8) | buffer[21]), height: 1 + (((buffer[24] & 15) << 10) | (buffer[23] << 2) | (buffer[22] >> 6)) };
  }
  throw new Error('Unsupported or invalid image: only PNG, JPEG, GIF, WebP are rendered');
}

async function decodeImage(file) {
  if (process.platform !== 'darwin') return { decoded: false, decoder: 'unavailable: manually open the image in a trusted viewer' };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wechat-image-decode-'));
  try {
    const output = path.join(directory, 'decoded.png');
    await runFile('/usr/bin/sips', ['-s', 'format', 'png', file, '--out', output], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const pixels = await fs.readFile(output);
    const dimensions = imageInfo(pixels);
    assert(dimensions.mime === 'image/png' && dimensions.width > 0 && dimensions.height > 0, 'Image decoder did not produce a raster image');
    return { decoded: true, decoder: 'macOS sips raster conversion' };
  } catch (e) { throw new Error(`Image decode failed: ${path.basename(file)} (${e.message})`); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export async function verifyMedia(root, media) {
  assert(media && MEDIA_STATUSES.includes(media.status), 'Invalid media status');
  assert(list(media.evidence) && media.evidence.length, 'Media requires capture evidence');
  assert(['original_download', 'native_save', 'screenshot', 'preview', 'unknown'].includes(media.source), 'Media requires an explicit source');
  assert(nonempty(media.kind ?? 'image'), 'Media kind is invalid');
  if (media.status === 'original_verified') {
    assert(media.source === 'original_download' && list(media.originalDownloadEvidence) && media.originalDownloadEvidence.length,
      'Original claim requires original-download evidence; a save, zoom, or screenshot is insufficient');
    assert(/^[a-f0-9]{64}$/i.test(media.sha256 ?? ''), 'Original claim requires an expected SHA-256');
  }
  if (['screenshot', 'preview'].includes(media.source)) assert(media.status === 'preview', 'Screenshots and preview representations may only have preview status');
  if (media.status === 'unavailable') { assert(!media.path, 'Unavailable media cannot have a file path'); return structuredClone(media); }
  if (!media.path) { assert(media.status === 'preview', 'Saved or original media requires a local file'); return structuredClone(media); }
  const resolved = await localAsset(root, media.path);
  const bytes = await fs.readFile(resolved);
  const actual = digest(bytes);
  assert(!media.sha256 || media.sha256.toLowerCase() === actual, `Media hash mismatch: ${media.path}`);
  if (media.kind === 'file') {
    assert(!own(media, 'width') && !own(media, 'height'), 'Opaque file media cannot claim image dimensions');
    return { ...structuredClone(media), mime: 'application/octet-stream', sha256: actual, bytes: bytes.length, metadataVerified: true };
  }
  const info = imageInfo(bytes);
  assert(info.width > 0 && info.height > 0, 'Invalid image dimensions');
  assert(!own(media, 'width') || media.width === info.width, `Media width mismatch: ${media.path}`);
  assert(!own(media, 'height') || media.height === info.height, `Media height mismatch: ${media.path}`);
  assert(!media.mime || media.mime === info.mime, `Media MIME mismatch: ${media.path}`);
  const decoding = await decodeImage(resolved);
  return { ...structuredClone(media), ...info, ...decoding, sha256: actual, bytes: bytes.length, metadataVerified: true };
}

function validateParticipants(participants) {
  assert(Array.isArray(participants), 'participants must be an array');
  const seen = new Set();
  for (const p of participants) {
    assert(nonempty(p.displayName) && nonempty(p.alias) && nonempty(p.status) && list(p.evidence) && p.evidence.length, 'Alias requires displayName, alias, status, and evidence');
    assert(!seen.has(p.displayName), `Duplicate participant alias: ${p.displayName}`); seen.add(p.displayName);
  }
}

export function validateRound(round, earlier = []) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  check(round?.schemaVersion === 1, 'Unsupported schemaVersion');
  check(validDate(round?.date), 'Invalid round date');
  try { roundFilename(round.date, round.round); } catch (e) { errors.push(e.message); }
  check(nonempty(round.window) && nonempty(round.captureMethod), 'Round requires window and captureMethod');
  check(Array.isArray(round.messages), 'Round requires messages array');
  const ids = new Map(earlier.map((m, index) => [m.id, { message: m, index }]));
  const all = [...earlier, ...(round.messages ?? [])];
  for (const [i, message] of (round.messages ?? []).entries()) {
    check(safeId(message.id), `Invalid message ID: ${message.id}`);
    check(!ids.has(message.id), `Duplicate message ID: ${message.id}`);
    check(nonempty(message.speaker) && !/^(unknown|未知|发言人待确认)$/i.test(message.speaker.trim()), `${message.id}: missing reliable speaker`);
    check(validTimestamp(message.timestamp), `${message.id}: invalid timestamp`);
    check(nonempty(message.body) || (Array.isArray(message.media) && message.media.length > 0), `${message.id}: empty body without media`);
    check(message.body === undefined || typeof message.body === 'string', `${message.id}: body must be a string`);
    check(message.media === undefined || Array.isArray(message.media), `${message.id}: media must be an array`);
    for (const media of message.media ?? []) {
      check(MEDIA_STATUSES.includes(media.status), `${message.id}: invalid media status`);
      check(list(media.evidence) && media.evidence.length, `${message.id}: missing media evidence`);
      check(['original_download', 'native_save', 'screenshot', 'preview', 'unknown'].includes(media.source), `${message.id}: invalid media source`);
      check(media.status === 'unavailable' ? !media.path : media.status === 'preview' || nonempty(media.path), `${message.id}: media path/status mismatch`);
      if (media.path) { try { safeAssetPath(media.path); } catch (e) { errors.push(`${message.id}: ${e.message}`); } }
      if (media.status === 'original_verified') check(media.source === 'original_download' && list(media.originalDownloadEvidence) && media.originalDownloadEvidence.length && /^[a-f0-9]{64}$/i.test(media.sha256 ?? '') && media.metadataVerified === true,
        `${message.id}: unverified original claim`);
      if (['screenshot', 'preview'].includes(media.source)) check(media.status === 'preview', `${message.id}: screenshot/preview cannot be saved/original`);
    }
    if (message.quote) {
      const q = message.quote;
      check(QUOTE_STATUSES.includes(q.status) && nonempty(q.text), `${message.id}: invalid or empty quote`);
      if (['exact', 'inferred'].includes(q.status)) {
        check(safeId(q.targetId) && ids.has(q.targetId), `${message.id}: reply target is absent or not earlier: ${q.targetId}`);
        if (q.status === 'inferred') check(list(q.evidence) && q.evidence.length, `${message.id}: inferred reply needs evidence`);
        if (q.status === 'exact' && ids.has(q.targetId)) {
          const target = ids.get(q.targetId).message;
          check(normalize(q.text) === normalize(target.body) && (!q.speaker || normalize(q.speaker) === normalize(target.speaker)), `${message.id}: exact quote does not match target`);
        }
      } else check(!q.targetId, `${message.id}: unlinked quote must not claim a target`);
    }
    ids.set(message.id, { message, index: earlier.length + i });
  }
  const c = round.completeness;
  check(c && ['complete', 'incomplete'].includes(c.status), 'Explicit completeness status required');
  check(c && list(c.evidence) && list(c.limitations), 'Completeness requires evidence and limitations arrays');
  check(c && Number.isInteger(c.recognizedItems) && c.recognizedItems >= 0 && Number.isInteger(c.skippedMedia) && c.skippedMedia >= 0, 'Recognized and skipped item counts must be nonnegative integers');
  const overlap = round.continuity?.overlap ?? 0;
  check(Number.isInteger(overlap) && overlap >= 0, 'Invalid continuity overlap');
  check(c && c.recognizedItems === (round.messages?.length ?? 0) + overlap + c.skippedMedia, 'Item counts do not reconcile: recognizedItems = retained messages + prior overlap + explicitly skipped media');
  if (c?.skippedMedia) check(list(c.skippedMediaEvidence) && c.skippedMediaEvidence.length, 'Skipped media requires explicit exclusion evidence');
  if (c?.status === 'complete') {
    check(c.evidence?.length > 0 && c.limitations?.length === 0, 'Complete round needs evidence and no known limitations');
    const e = round.captureEvidence;
    check(e && list(e.textSources) && e.textSources.length && list(e.screenshotRefs) && e.screenshotRefs.length, 'Complete capture needs text sources and screenshot attribution references');
    check(e?.speakerVerification === 'all' && ['visible_end', 'two_identical_bottom_states'].includes(e?.endDetection), 'Complete capture needs every speaker verified and a detected end');
  }
  if ((round.messages ?? []).some(m => (m.media ?? []).some(media => ['preview', 'unavailable'].includes(media.status)))) {
    check(c?.status === 'incomplete' && c.limitations?.length > 0, 'Preview or unavailable media requires incomplete status and an explicit media limitation');
  }
  try { validateParticipants(round.participants ?? []); } catch (e) { errors.push(e.message); }
  return { valid: !errors.length, errors, counts: { messages: round.messages?.length ?? 0, media: (round.messages ?? []).reduce((n,m) => n + (m.media?.length ?? 0), 0), replies: (round.messages ?? []).filter(m => m.quote?.targetId).length, speakers: new Set(all.map(m => m.speaker)).size }, status: c?.status };
}

function resolveQuotes(messages, earlier) {
  const prior = [...earlier];
  for (const message of messages) {
    if (message.quote) {
      const q = message.quote;
      if (!q.status || q.status === 'auto') {
        const candidates = prior.filter(m => normalize(m.body) === normalize(q.text) && (!q.speaker || normalize(m.speaker) === normalize(q.speaker)));
        if (q.targetId) {
          const chosen = prior.find(m => m.id === q.targetId);
          assert(chosen && normalize(chosen.body) === normalize(q.text) && (!q.speaker || normalize(chosen.speaker) === normalize(q.speaker)), `${message.id}: supplied exact quote target does not match`);
          q.status = 'exact';
        } else {
          assert(candidates.length <= 1, `${message.id}: ambiguous exact quote; provide targetId or mark unresolved`);
          if (candidates.length) { q.status = 'exact'; q.targetId = candidates[0].id; }
          else q.status = 'unresolved';
        }
      }
    }
    prior.push(message);
  }
}

export function renderMarkdown(round, allMessages = []) {
  const filename = roundFilename(round.date, round.round);
  const byId = new Map([...allMessages, ...round.messages].map(m => [m.id, m]));
  const c = round.completeness;
  const lines = ['# 微信聊天记录', '', `- 抓取日期：${round.date}`, `- 轮次：${round.round}`, `- 原窗口：${md(round.window)}`, `- 消息时间范围：${md(round.messages[0]?.timestamp ?? '无新消息')}—${md(round.messages.at(-1)?.timestamp ?? '无新消息')}`, `- 提取方式：${md(round.captureMethod)}`, `- 完整性：${c.status === 'complete' ? '完整' : '不完整'}；共识别 ${c.recognizedItems} 个记录项；保留 ${round.messages.length} 条消息，包含 ${round.messages.reduce((n,m) => n + (m.media?.length ?? 0), 0)} 个媒体项；前轮重叠 ${round.continuity.overlap} 条；明确跳过 ${c.skippedMedia} 个媒体项。`, `- 发言人：${round.captureEvidence?.speakerVerification === 'all' ? '全部已核对' : '未全部核对；本轮不得标记完整'}`, `- 与上一轮衔接：${round.continuity.anchorId ? `以前一轮末条消息 ${round.continuity.anchorId} 为重叠锚点；本文件不重复收录该消息。` : '首轮，无前轮锚点。'}`, `- 证据：${md(c.evidence.join('；') || '未提供')}`, `- 已知限制：${md(c.limitations.join('；') || '无')}`, `- 结构化数据：${md(filename.replace(/\.md$/, '.json'))}`, ''];
  for (const m of round.messages) {
    const bodyLines = (m.body || '[媒体]').split('\n');
    lines.push(`- <a id="${m.id}"></a> **${md(m.timestamp)}** · **${md(m.speaker)}**：${md(bodyLines[0])}`);
    for (const line of bodyLines.slice(1)) lines.push(`  ${md(line).replace(/^(?:- |>)/, value => `\\${value}`)}`);
    if (m.quote) {
      const q = m.quote;
      if (q.targetId) {
        const target = byId.get(q.targetId);
        const link = target?.roundFile && target.roundFile !== filename ? `${target.roundFile}#${q.targetId}` : `#${q.targetId}`;
        lines.push(`  - 回复：[${q.targetId}](${link})${q.status === 'inferred' ? '（推定）' : ''}`);
      } else lines.push(`  - 回复：未匹配（${q.status === 'image-only' ? '仅图片引文' : '未解析'}）`);
      for (const [i, line] of q.text.split('\n').entries()) lines.push(`  > ${i === 0 && q.speaker ? `${md(q.speaker)}: ` : ''}${md(line)}`);
    }
    for (const media of m.media ?? []) {
      lines.push(`  - 媒体：${media.status}${media.path ? ` [本地文件](../${media.path})` : '（无本地文件）'}${media.sha256 ? `；SHA-256 ${media.sha256}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function parseMarkdown(markdown, filename) {
  const messages = [];
  const lines = markdown.split(/\r?\n/);
  let current = null;
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('- <a')) {
      const match = line.match(/^- <a id="([^"]+)"><\/a> \*\*([^*]+)\*\* · \*\*((?:\\.|[^*])+)\*\*：(.*)$/);
      assert(match, `${filename}:${index + 1}: malformed message header or missing speaker`);
      current = { id: match[1], timestamp: unmd(match[2]), speaker: unmd(match[3]), body: unmd(match[4]), roundFile: path.basename(filename) };
      messages.push(current);
    } else if (current && /^\s+- 回复：/.test(line)) {
      const linked = line.match(/^\s+- 回复：\[([^\]]+)\]\(([^)]*)#([^)]*)\)(（推定）)?$/);
      if (linked) {
        assert(linked[1] === linked[3], `${filename}:${index + 1}: reply label and fragment disagree`);
        assert(!linked[2] || /^[\w\-\u4e00-\u9fff]+\.md$/.test(linked[2]), `${filename}:${index + 1}: unsafe reply path`);
        current.quote = { status: linked[4] ? 'inferred' : 'exact', targetId: linked[1], text: '', evidence: linked[4] ? ['Legacy Markdown explicitly marks inferred'] : [], targetFile: linked[2] || path.basename(filename) };
      } else { assert(/^\s+- 回复：未匹配/.test(line), `${filename}:${index + 1}: malformed reply`); current.quote = { status: line.includes('仅图片') ? 'image-only' : 'unresolved', text: '' }; }
    } else if (current?.quote && /^  >/.test(line)) {
      const text = unmd(line.replace(/^  > ?/, ''));
      current.quote.text += `${current.quote.text ? '\n' : ''}${text}`;
    } else if (current && /^  /.test(line) && !/^  - 媒体：/.test(line)) current.body += `\n${unmd(line.slice(2))}`;
  }
  for (const m of messages) {
    assert(safeId(m.id) && validTimestamp(m.timestamp) && nonempty(m.speaker) && !/^(unknown|未知|发言人待确认)$/i.test(m.speaker) && nonempty(m.body), `${filename}: invalid message ${m.id}`);
    if (m.quote) assert(nonempty(m.quote.text), `${filename}: empty quote ${m.id}`);
  }
  return messages;
}

export async function readArchive(root) {
  const importDir = path.join(root, 'IMPORT');
  let files;
  try { files = (await fs.readdir(importDir)).filter(f => /^\d{4}-\d{2}-\d{2}(?:-\d{2,})?-微信聊天记录\.md$/.test(f)).sort((a,b) => parseRoundFilename(a).date.localeCompare(parseRoundFilename(b).date) || Number(parseRoundFilename(a).round) - Number(parseRoundFilename(b).round)); }
  catch (e) { if (e.code === 'ENOENT') return { rounds: [], messages: [] }; throw e; }
  const rounds = [], messages = [], ids = new Set(), legacyIds = new Set();
  for (const file of files) {
    const markdown = await fs.readFile(path.join(importDir, file), 'utf8');
    let round, sidecarText;
    try {
      sidecarText = await fs.readFile(path.join(importDir, file.replace(/\.md$/, '.json')), 'utf8');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (sidecarText !== undefined) {
      round = JSON.parse(sidecarText);
      assert(round.markdownSha256 === digest(markdown), `${file}: Markdown changed after generation; reconcile sidecar before proceeding`);
      assert(roundFilename(round.date, round.round) === file, `${file}: sidecar identity mismatch`);
      const result = validateRound(round, messages);
      assert(result.valid, `${file}: ${result.errors.join('; ')}`);
      assert(digest(renderMarkdown(round, messages)) === round.markdownSha256, `${file}: JSON content conflicts with canonical Markdown; reconcile both representations`);
      for (const m of round.messages) for (const media of m.media ?? []) await verifyMedia(root, media);
    } else {
      assert(!markdown.includes('- 结构化数据：'), `${file}: canonical JSON sidecar is missing`);
      const legacy = parseMarkdown(markdown, file);
      for (const message of legacy) legacyIds.add(message.id);
      round = { schemaVersion: 1, ...parseRoundFilename(file), messages: legacy, participants: [], completeness: { status: 'incomplete', evidence: ['Legacy Markdown imported'], limitations: ['Legacy capture evidence and media counts unavailable'], recognizedItems: legacy.length, skippedMedia: 0 }, continuity: { overlap: 0, anchorId: null }, window: 'Legacy archive', captureMethod: 'Legacy Markdown' };
    }
    for (const m of round.messages) { assert(!ids.has(m.id), `Duplicate message ID ${m.id}`); ids.add(m.id); m.roundFile = file; messages.push(m); }
    rounds.push(round);
  }
  for (const m of messages) if (m.quote?.targetId) {
    const sourceIndex = messages.indexOf(m), targetIndex = messages.findIndex(x => x.id === m.quote.targetId);
    assert(targetIndex >= 0 && targetIndex < sourceIndex, `${m.id}: dangling or future reply ${m.quote.targetId}`);
    if (m.quote.targetFile) assert(messages[targetIndex].roundFile === m.quote.targetFile, `${m.id}: reply file does not contain target`);
    const targetSpeakerPrefix = `${messages[targetIndex].speaker}: `;
    if (legacyIds.has(m.id) && !m.quote.speaker && m.quote.text.startsWith(targetSpeakerPrefix)) {
      m.quote.speaker = messages[targetIndex].speaker;
      m.quote.text = m.quote.text.slice(targetSpeakerPrefix.length);
    }
  }
  return { rounds, messages };
}

export function renderParticipants(participants) {
  const cell = value => md(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return ['# 参与者别名', '', '| 聊天记录显示名 | 主群界面别名 | 状态 | 依据 |', '|---|---|---|---|', ...participants.map(p => `| ${cell(p.displayName)} | ${cell(p.alias)} | ${cell(p.status)} | ${cell(p.evidence.join('；'))} |`), ''].join('\n');
}

export function buildHtml(archive) {
  const aliases = new Map(archive.rounds.flatMap(r => r.participants ?? []).map(p => [p.displayName, p.alias]));
  const speakers = [...new Set(archive.messages.map(m => m.speaker))].sort();
  const dates = [...new Set(archive.rounds.map(r => r.date))].sort();
  const cards = archive.messages.map(m => {
    const date = m.roundFile.slice(0,10);
    const quote = m.quote ? `<blockquote>${m.quote.speaker ? `<strong>${html(m.quote.speaker)}</strong>: ` : ''}${html(m.quote.text)}<footer>${m.quote.targetId ? `<a href="#${html(m.quote.targetId)}">回复 ${html(m.quote.targetId)}</a> (${html(m.quote.status)})` : html(m.quote.status)}</footer></blockquote>` : '';
    const media = (m.media ?? []).map(item => {
      if (item.path) safeAssetPath(item.path);
      const url = item.path?.split('/').map(encodeURIComponent).join('/');
      return `<figure>${url && item.kind !== 'file' ? `<a href="${html(url)}"><img loading="lazy" src="${html(url)}" alt="${html(item.alt ?? `媒体：${item.status}`)}"></a>` : ''}<figcaption>${html(item.status)}${item.width ? ` · ${item.width} × ${item.height}` : ''}${item.kind === 'file' ? ' · 原文件已保留，阅读器不解码' : ''}${item.path ? ` · ${html(item.path)}` : ' · 无本地文件'}</figcaption></figure>`;
    }).join('');
    return `<article id="${html(m.id)}" data-speaker="${html(m.speaker)}" data-date="${html(date)}" data-media="${(m.media ?? []).length ? 'yes' : 'no'}" data-quote="${html(m.quote?.status ?? 'none')}"><header><a href="#${html(m.id)}">${html(m.timestamp)}</a> <strong>${html(m.speaker)}</strong>${aliases.has(m.speaker) ? ` <span>(${html(aliases.get(m.speaker))})</span>` : ''} <small>${html(m.id)}</small></header><p>${html(m.body || '[媒体]')}</p>${quote}${media}</article>`;
  }).join('\n');
  const report = archive.rounds.map(r => `<li>${html(r.date)} / ${html(r.round)}：${r.completeness.status === 'complete' ? '完整' : '不完整'}；${r.messages.length} 条消息；${r.messages.reduce((n,m) => n + (m.media?.length ?? 0), 0)} 媒体项${r.completeness.limitations.length ? `；${html(r.completeness.limitations.join('；'))}` : ''}</li>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>微信聊天归档</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#202024;background:#fff;margin:0}main{max-width:960px;margin:auto;padding:24px}h1{font-size:26px}.controls{display:flex;gap:8px;flex-wrap:wrap;position:sticky;top:0;background:#fff;padding:12px 0;border-bottom:1px solid #ccc}input,select,button{font:inherit;padding:6px;border:1px solid #aaa;border-radius:4px;max-width:100%;box-sizing:border-box}input{flex:1;min-width:160px}article{padding:18px 0;border-bottom:1px solid #ddd;scroll-margin-top:120px}article:target{background:#eaf5fb}header small,figcaption{color:#61616b;font-size:13px}header,figcaption{overflow-wrap:anywhere}p,blockquote{white-space:pre-wrap;overflow-wrap:anywhere}blockquote{border-left:3px solid #b7bdc5;padding-left:14px;margin-left:12px}figure{margin:12px 0}img{max-width:100%;height:auto;max-height:600px}a{color:#12628a}footer{margin-top:6px;font-size:14px}[hidden]{display:none!important}@media(max-width:640px){.controls{position:static}article{scroll-margin-top:12px}main{padding:16px}}</style></head><body><main><h1>微信聊天归档</h1><details><summary>归档状态与证据限制</summary><ul>${report}</ul></details><div class="controls"><input id="search" type="search" aria-label="搜索正文、发言人、引用" placeholder="搜索"><select id="speaker" aria-label="发言人"><option value="">全部发言人</option>${speakers.map(s => `<option>${html(s)}</option>`).join('')}</select><select id="date" aria-label="抓取日期"><option value="">全部抓取日期</option>${dates.map(d => `<option>${html(d)}</option>`).join('')}</select><select id="media" aria-label="媒体"><option value="">全部消息</option><option value="yes">含媒体</option><option value="no">无媒体</option></select><select id="quote" aria-label="引用"><option value="">全部引用状态</option>${['none', ...QUOTE_STATUSES].map(s => `<option>${s}</option>`).join('')}</select><button id="reset" type="button">重置</button></div><p id="count" aria-live="polite"></p>${cards}</main><script>
const articles=[...document.querySelectorAll('article')];
const controls=['search','speaker','date','media','quote'].map(id=>document.getElementById(id));
function filter(){const [search,speaker,date,media,quote]=controls.map(c=>c.value);let count=0;for(const article of articles){article.hidden=!!((search&&!article.textContent.toLocaleLowerCase().includes(search.toLocaleLowerCase()))||(speaker&&article.dataset.speaker!==speaker)||(date&&article.dataset.date!==date)||(media&&article.dataset.media!==media)||(quote&&article.dataset.quote!==quote));if(!article.hidden)count++;}document.getElementById('count').textContent=count+' / '+articles.length+' 条消息';}
for(const c of controls)c.addEventListener('input',filter);
document.getElementById('reset').addEventListener('click',()=>{for(const c of controls)c.value='';filter();});
function navigate(){const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(target?.tagName==='ARTICLE'){for(const c of controls)c.value='';filter();target.scrollIntoView();}}
document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link){const target=document.getElementById(link.getAttribute('href').slice(1));if(target){for(const c of controls)c.value='';filter();target.scrollIntoView();}}});
addEventListener('hashchange',navigate);filter();navigate();
</script></body></html>\n`;
}

async function exists(file) { try { await fs.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function writeNew(file, data) { await fs.writeFile(file, data, { flag: 'wx' }); }

export async function initArchive(root) {
  await fs.mkdir(root, { recursive: true });
  const manifest = path.join(root, 'archive.json');
  assert(!await exists(manifest), 'Archive already initialized; refusing overwrite');
  const entries = await fs.readdir(root);
  assert(entries.every(name => ['assets', 'IMPORT'].includes(name)), 'Initialization requires an empty directory or only assets/ and IMPORT/');
  await fs.mkdir(path.join(root, 'IMPORT'), { recursive: true });
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await writeNew(manifest, `${JSON.stringify({ schemaVersion: 1, format: 'wechat-chat-archive', localOnly: true }, null, 2)}\n`);
  return { root: path.resolve(root), initialized: true };
}

async function assertArchive(root) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'archive.json'), 'utf8'));
  assert(metadata.schemaVersion === 1 && metadata.format === 'wechat-chat-archive', 'Not an initialized archive');
  return metadata;
}

async function assertDerivedUnchanged(root, metadata) {
  for (const filename of ['PARTICIPANTS.md', 'PARTICIPANTS.json']) {
    const file = path.join(root, filename);
    if (!await exists(file)) continue;
    assert(metadata.generatedHashes?.[filename] && metadata.generatedHashes[filename] === digest(await fs.readFile(file)), `${filename} is untracked or manually edited; preserve it and reconcile alias evidence before rebuilding`);
  }
}

async function atomicReplace(file, text) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeNew(temp, text); await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); }
}

export async function buildArchive(root) {
  const metadata = await assertArchive(root);
  await assertDerivedUnchanged(root, metadata);
  const archive = await readArchive(root);
  const participants = [];
  for (const round of archive.rounds) for (const item of round.participants ?? []) {
    const prior = participants.find(p => p.displayName === item.displayName);
    if (prior) { assert(prior.alias === item.alias, `Conflicting alias for ${item.displayName}; resolve explicitly`); prior.evidence = [...new Set([...prior.evidence, ...item.evidence])]; prior.status = item.status; }
    else participants.push(structuredClone(item));
  }
  const derivatives = { 'PARTICIPANTS.json': `${JSON.stringify(participants, null, 2)}\n`, 'PARTICIPANTS.md': renderParticipants(participants), 'index.html': buildHtml(archive) };
  for (const [filename, content] of Object.entries(derivatives)) await atomicReplace(path.join(root, filename), content);
  await atomicReplace(path.join(root, 'archive.json'), `${JSON.stringify({ ...metadata, generatedHashes: Object.fromEntries(Object.entries(derivatives).map(([name, content]) => [name, digest(content)])) }, null, 2)}\n`);
  return { rounds: archive.rounds.length, messages: archive.messages.length, media: archive.messages.reduce((n,m) => n + (m.media?.length ?? 0), 0), incompleteRounds: archive.rounds.filter(r => r.completeness.status !== 'complete').length };
}

export async function importCapture(root, capture, { allowIncomplete = false } = {}) {
  const metadata = await assertArchive(root);
  await assertDerivedUnchanged(root, metadata);
  const lock = path.join(root, '.import.lock');
  let lockHandle;
  try { lockHandle = await fs.open(lock, 'wx'); } catch (e) { if (e.code === 'EEXIST') throw new Error('Archive is locked by another import; inspect stale lock before removing'); throw e; }
  let tempDirectory;
  try {
    const archive = await readArchive(root);
    const date = capture.date, roundNumber = capture.round ?? '01', filename = roundFilename(date, roundNumber);
    const destination = path.join(root, 'IMPORT', filename), sidecar = destination.replace(/\.md$/, '.json');
    assert(!await exists(destination) && !await exists(sidecar), `Round already exists: ${filename}; never renumber or overwrite`);
    if (archive.rounds.length) {
      const latest = archive.rounds.at(-1);
      assert(date > latest.date || (date === latest.date && Number(roundNumber) > Number(latest.round)), 'New round must follow the latest archived date and round');
    }
    const merged = capture.pages ? mergePages(capture.pages) : { messages: structuredClone(capture.messages ?? []), overlaps: [] };
    assert(!(capture.pages && capture.messages), 'Capture must use pages or messages, not both');
    assert(Array.isArray(merged.messages), 'messages must be an array');
    for (const message of merged.messages) if (message.media) {
      assert(Array.isArray(message.media), 'media must be an array');
      message.media = await Promise.all(message.media.map(media => verifyMedia(root, media)));
    }
    const trimmed = trimIncremental(merged.messages, archive.messages, capture.anchorId);
    const prefix = `${date.replaceAll('-', '')}${roundNumber === '01' ? '' : `-${roundNumber}`}`;
    for (const [index, message] of trimmed.messages.entries()) {
      assert(validTimestamp(message.timestamp) && message.timestamp.includes(' '), 'New messages require source-confirmed YYYY-MM-DD HH:MM[:SS] timestamps; do not infer dates from extraction filenames');
      message.id ??= `${prefix}-${String(index + 1).padStart(3, '0')}`;
      assert(message.id.startsWith(`${prefix}-`), 'New message ID must use its round filename prefix');
      message.roundFile = filename;
    }
    resolveQuotes(trimmed.messages, archive.messages);
    const round = { schemaVersion: 1, date, round: roundNumber, window: capture.window, captureMethod: capture.captureMethod, captureEvidence: capture.captureEvidence ?? {}, completeness: capture.completeness, participants: capture.participants ?? [], continuity: { anchorId: trimmed.anchorId, overlap: trimmed.overlap, pageOverlaps: merged.overlaps }, messages: trimmed.messages };
    const result = validateRound(round, archive.messages);
    assert(result.valid, result.errors.join('\n'));
    assert(allowIncomplete || round.completeness.status === 'complete', 'Capture is incomplete; use --allow-incomplete to preserve an explicitly incomplete round');
    const prospective = { rounds: [...archive.rounds, round], messages: [...archive.messages, ...round.messages] };
    const aliasMap = new Map();
    for (const p of prospective.rounds.flatMap(r => r.participants ?? [])) { assert(!aliasMap.has(p.displayName) || aliasMap.get(p.displayName) === p.alias, `Conflicting alias for ${p.displayName}`); aliasMap.set(p.displayName, p.alias); }
    buildHtml(prospective);
    const markdown = renderMarkdown(round, archive.messages);
    round.markdownSha256 = digest(markdown);
    tempDirectory = path.join(root, 'IMPORT', `.stage-${randomUUID()}`);
    await fs.mkdir(tempDirectory);
    const stagedMarkdown = path.join(tempDirectory, filename), stagedJson = stagedMarkdown.replace(/\.md$/, '.json');
    await writeNew(stagedMarkdown, markdown);
    await writeNew(stagedJson, `${JSON.stringify(round, null, 2)}\n`);
    // Hard links provide exclusive publication; JSON is inert until Markdown appears.
    await fs.link(stagedJson, sidecar);
    try { await fs.link(stagedMarkdown, destination); } catch (e) { await fs.rm(sidecar); throw e; }
    const totals = await buildArchive(root);
    return { file: destination, status: round.completeness.status, ...result.counts, overlap: trimmed.overlap, totals };
  } finally {
    if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
    await lockHandle.close(); await fs.rm(lock, { force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { usage: 'archive.mjs init|import|build|validate <archive-dir> [capture.json] [--allow-incomplete]', commands: { init: 'Create a local archive without overwriting files', import: 'Validate and append a structured capture', build: 'Regenerate offline reader and evidence-backed participant table', validate: 'Validate all rounds, replies, and local media' } };
  const [command, root, input, ...rest] = args;
  assert(root, 'Usage: archive.mjs init|import|build|validate <archive-dir> [capture.json] [--allow-incomplete]');
  if (command === 'init') { assert(!input, 'init takes only an archive directory'); return initArchive(root); }
  if (command === 'import') {
    assert(input && rest.every(item => item === '--allow-incomplete'), 'import requires capture.json and optional --allow-incomplete');
    return importCapture(root, JSON.parse(await fs.readFile(input, 'utf8')), { allowIncomplete: rest.includes('--allow-incomplete') });
  }
  assert(!input, `${command} takes only an archive directory`);
  if (command === 'build') return buildArchive(root);
  if (command === 'validate') { await assertArchive(root); const archive = await readArchive(root); return { valid: true, rounds: archive.rounds.length, messages: archive.messages.length, incompleteRounds: archive.rounds.filter(r => r.completeness.status !== 'complete').length }; }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
