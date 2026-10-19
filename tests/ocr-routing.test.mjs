import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { parseArguments, recognize, execute } from '../skills/archive-wechat-chat/scripts/ocr.mjs';

const ok = stdout => ({ status: 0, stdout, stderr: '' });
const legacy = JSON.stringify({ images: [{ lines: [{ text: 'legacy sample' }] }], engine: { api: 'VNRecognizeTextRequest', kind: 'text' } });
const document = JSON.stringify({ images: [{ lines: [{ text: 'document sample' }], documents: [{ tables: [{ rows: [['A']] }] }] }], engine: { api: 'RecognizeDocumentsRequest', kind: 'document' } });

test('OCR arguments preserve paths with spaces and explicit old-backend selection', () => {
  const options = parseArguments(['--mode', 'text', 'a file.png']);
  assert.equal(options.mode, 'text');
  assert.ok(options.files[0].endsWith('/a file.png'));
  assert.equal(parseArguments(['--', '--filename.png']).files.length, 1);
  assert.throws(() => parseArguments(['--mode', 'unknown', 'a.png']), /mode/);
  assert.throws(() => parseArguments([]), /Usage/);
});

test('old macOS uses the original backend with an explicit fallback reason', async () => {
  const calls = [];
  const run = (command, args) => { calls.push([command, args]); return command === 'sw_vers' ? ok('15.7') : ok(legacy); };
  const result = await recognize({ mode: 'auto', files: ['/tmp/image.png'] }, run);
  assert.equal(result.selection.selected, 'text');
  assert.match(result.selection.fallbackReasons[0], /macOS 26/);
  assert.deepEqual(calls.map(c => c[0]), ['sw_vers', 'bash']);
});

test('new system with old SDK falls back while document-only mode visibly fails', async () => {
  const run = (command) => command === 'sw_vers' ? ok('26.2') : command === 'xcrun' ? ok('15.2') : ok(legacy);
  assert.equal((await recognize({ mode: 'auto', files: ['/tmp/image.png'] }, run)).selection.selected, 'text');
  await assert.rejects(recognize({ mode: 'document', files: ['/tmp/image.png'] }, run), /SDK/);
});

test('document compile failure falls back without claiming document structure', async () => {
  const run = (command, args) => {
    if (command === 'sw_vers') return ok('26.2');
    if (command === 'xcrun') return args[0] === 'swiftc' ? { status: 1, stdout: '', stderr: 'synthetic SDK/compiler mismatch' } : ok('26.5');
    return ok(legacy);
  };
  const result = await recognize({ mode: 'auto', files: ['/tmp/image.png'] }, run);
  assert.equal(result.engine.kind, 'text');
  assert.match(result.selection.fallbackReasons[0], /compiler mismatch/);
  assert.equal(result.images[0].documents, undefined);
});

test('runtime failure falls back, while available documents keep table structure', async () => {
  for (const failure of [true, false]) {
    const run = (command, args) => {
      if (command === 'sw_vers') return ok('26.2');
      if (command === 'xcrun') return ok(args[0] === 'swiftc' ? '' : '26.5');
      if (command === 'bash') return ok(legacy);
      return failure ? { status: 1, stdout: '', stderr: 'synthetic unsupported device' } : ok(document);
    };
    const result = await recognize({ mode: 'auto', files: ['/tmp/image.png'] }, run);
    assert.equal(result.selection.selected, failure ? 'text' : 'document');
    if (!failure) assert.equal(result.images[0].documents[0].tables[0].rows[0][0], 'A');
    else assert.match(result.selection.fallbackReasons[0], /unsupported device/);
  }
});

test('text mode bypasses all new-toolchain checks and preserves the old CLI', async () => {
  const result = await recognize({ mode: 'text', files: ['/tmp/image.png'] }, (command, args) => {
    assert.equal(command, 'bash');
    assert.ok(args[0].endsWith('/ocr_legacy.sh'));
    return ok(legacy);
  });
  assert.deepEqual(result.selection, { requested: 'text', selected: 'text', fallbackReasons: [] });
});

test('timeout terminates a shell and its waiting child even when TERM is trapped', { skip: process.platform === 'win32' }, async () => {
  const started = Date.now();
  const result = await execute('bash', ['-c', 'trap : EXIT HUP INT TERM; sleep 20'], { timeout: 100 });
  assert.match(result.error?.message ?? '', /Process group exceeded/);
  assert.ok(Date.now() - started < 3000, 'deadline must not wait for the sleeping child');
});

test('batch budgets scale with image count and accept an explicit override', async () => {
  for (const [timeoutSeconds, expected] of [[undefined, 150000], [7, 7000]]) {
    await recognize({ mode: 'text', files: ['a', 'b', 'c'], timeoutSeconds }, (command, args, options) => {
      assert.equal(options.timeout, expected);
      assert.ok(options.env.TMPDIR.includes('wechat-legacy-ocr-'));
      return ok(legacy);
    });
  }
  assert.throws(() => parseArguments(['--timeout-seconds', '-1', 'a']), /timeout-seconds/);
});

test('launcher cancellation kills the detached group and returns promptly', { skip: process.platform === 'win32' }, async () => {
  const moduleUrl = new URL('../skills/archive-wechat-chat/scripts/ocr.mjs', import.meta.url).href;
  const script = `import { execute } from ${JSON.stringify(moduleUrl)};
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100);
    const result = await execute('bash', ['-c', 'trap : TERM; sleep 20']);
    console.log(JSON.stringify({ code: result.error?.code, exitCode: result.error?.exitCode }));`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', script], { timeout: 3000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { code: 'OCR_CANCELLED', exitCode: 143 });
});

test('cancelled recognition cleans its temporary directory without starting a fallback', async () => {
  for (const mode of ['auto', 'text']) {
    let temporary;
    const run = (command, args, options) => {
      if (command === 'sw_vers') return ok('26.2');
      if (command === 'xcrun') {
        if (args[0] === 'swiftc') { temporary = args.at(-1).replace(/\/[^/]+$/, ''); return ok(''); }
        return ok('26.5');
      }
      if (mode === 'auto') assert.notEqual(command, 'bash', 'cancellation must not start legacy OCR');
      else temporary = options.env.TMPDIR;
      return { status: null, error: Object.assign(new Error('cancelled'), { code: 'OCR_CANCELLED' }), stdout: '', stderr: '' };
    };
    await assert.rejects(recognize({ mode, files: ['/tmp/image.png'] }, run), { code: 'OCR_CANCELLED' });
    assert.equal(fs.existsSync(temporary), false);
  }
});
