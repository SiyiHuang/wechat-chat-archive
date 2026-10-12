#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw new Error('No tracked release files. Stage the intended public files first.');
const errors = [];
for (const file of files) {
  const path = resolve(root, file);
  if (relative(root, path).startsWith('..') || lstatSync(path).isSymbolicLink()) errors.push(`${file}: unsafe path or symlink`);
  if (/(^|\/)(IMPORT|archives|captures|private|evidence|node_modules|\.DS_Store)(\/|$)/i.test(file)) errors.push(`${file}: private/runtime path in release`);
  const content = readFileSync(path);
  if (content.includes(0)) { errors.push(`${file}: binary must be individually reviewed before release`); continue; }
  const text = content.toString('utf8');
  if (/\/(?:Users|home)\/[a-zA-Z0-9._-]+\//.test(text)) errors.push(`${file}: machine-specific home path`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{20,}|\bsk-[A-Za-z0-9]{32,}/.test(text)) errors.push(`${file}: possible credential`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Release scan passed: ${files.length} tracked text files. Manual privacy review still required.`);
