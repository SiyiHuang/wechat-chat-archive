#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { initArchive, importCapture } from '../../skills/archive-wechat-chat/scripts/archive.mjs';
import { createSyntheticPng } from './image-fixture.mjs';

const root = path.resolve(process.argv[2] ?? 'synthetic-demo-archive');
await initArchive(root);
const capture = JSON.parse(await fs.readFile(new URL('./capture.json', import.meta.url), 'utf8'));
const png = createSyntheticPng();
await fs.writeFile(path.join(root, 'assets', 'synthetic-pixel.png'), png, { flag: 'wx' });
capture.pages[1].messages[1].media.push({ kind: 'image', status: 'saved_unverified', source: 'native_save', evidence: ['Synthetic generated checkerboard fixture, no private data'], path: 'assets/synthetic-pixel.png', alt: 'Synthetic checkerboard fixture' });
console.log(JSON.stringify(await importCapture(root, capture, { allowIncomplete: true }), null, 2));
console.log(`Offline reader: ${path.join(root, 'index.html')}`);
