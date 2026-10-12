#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, parseRoundFilename, readArchive } from './archive.mjs';

export async function validateMarkdownFiles(files) {
  if (!files.length) throw new Error('Usage: validate-chat-round.mjs IMPORT/*.md or <archive-dir>');
  if (files.length === 1 && (await fs.stat(files[0])).isDirectory()) {
    const archive = await readArchive(files[0]);
    return { valid: true, messages: archive.messages.length, rounds: archive.rounds.length, incompleteRounds: archive.rounds.filter(r => r.completeness.status !== 'complete').length };
  }
  const messages = [], ids = new Map(), counts = [];
  const ordered = [...files].sort((a,b) => {
    try { const first = parseRoundFilename(a), second = parseRoundFilename(b); return first.date.localeCompare(second.date) || Number(first.round) - Number(second.round); }
    catch { return a.localeCompare(b); }
  });
  for (const file of ordered) {
    const entries = parseMarkdown(await fs.readFile(file, 'utf8'), file);
    if (!entries.length) throw new Error(`${file}: no compliant messages found`);
    for (const message of entries) {
      if (ids.has(message.id)) throw new Error(`${file}: duplicate message ID ${message.id}`);
      ids.set(message.id, message); messages.push(message);
    }
    counts.push({ file, messages: entries.length });
  }
  for (const [index, message] of messages.entries()) if (message.quote?.targetId) {
    const target = ids.get(message.quote.targetId);
    if (!target) throw new Error(`${message.id}: dangling reply ${message.quote.targetId}`);
    if (messages.indexOf(target) >= index) throw new Error(`${message.id}: reply target must be earlier`);
    if (target.roundFile !== message.quote.targetFile) throw new Error(`${message.id}: reply target filename mismatch`);
  }
  return { valid: true, counts, messages: messages.length, speakers: new Set(messages.map(m => m.speaker)).size, linkedReplies: messages.filter(m => m.quote?.targetId).length, limitations: ['Markdown-only validation cannot verify capture completeness or media; validate the archive directory for those checks.'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateMarkdownFiles(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(`ERROR: ${error.message}`); process.exitCode = 1; });
}
