#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const fail = message => { throw new Error(message); };

export function parseArguments(args) {
  let mode = 'auto';
  let timeoutSeconds;
  const files = [];
  let options = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (options && arg === '--') options = false;
    else if (options && arg === '--mode') mode = args[++index];
    else if (options && arg === '--timeout-seconds') {
      timeoutSeconds = Number(args[++index]);
      if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) fail('--timeout-seconds must be an integer from 1 to 86400');
    }
    else if (options && ['--help', '-h'].includes(arg)) return { help: true };
    else if (options && arg.startsWith('-')) fail(`Unknown OCR option: ${arg}`);
    else files.push(path.resolve(arg));
  }
  if (!['auto', 'document', 'text'].includes(mode)) fail('--mode must be auto, document, or text');
  if (!files.length) fail('Usage: ocr.sh [--mode auto|document|text] [--] IMAGE [IMAGE ...]');
  return { mode, files, timeoutSeconds };
}

export function execute(command, args, { timeout = 60000, maxBuffer = 32 * 1024 * 1024, env = process.env } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env });
    const stdout = [], stderr = [];
    let bytes = 0, failure;
    const stop = error => {
      failure ??= error;
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch (killError) { if (killError.code !== 'ESRCH') failure = killError; }
    };
    const cancel = signal => stop(Object.assign(new Error(`OCR cancelled by ${signal}`), { code: 'OCR_CANCELLED', exitCode: signal === 'SIGINT' ? 130 : 143 }));
    const onInterrupt = () => cancel('SIGINT');
    const onTerminate = () => cancel('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    const timer = setTimeout(() => stop(new Error(`Process group exceeded ${timeout} ms: ${command}`)), timeout);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) stop(new Error(`OCR output exceeded ${maxBuffer} bytes`));
      else chunks.push(chunk);
    });
    child.on('error', error => { failure ??= error; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
      resolve({ status, signal, error: failure, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() });
    });
  });
}

function resultJson(result, label) {
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr].filter(Boolean).join('\n').trim() || `exit ${result.status}`;
    fail(`${label}: ${detail.slice(-3000)}`);
  }
  const data = JSON.parse(result.stdout);
  if (!Array.isArray(data.images) || !data.engine) fail(`${label}: invalid output schema`);
  return data;
}

export async function recognize({ mode, files, timeoutSeconds }, run = execute) {
  const budget = timeoutSeconds === undefined ? 60000 + 30000 * files.length : timeoutSeconds * 1000;
  const invoke = async (command, args, timeout = budget, env) => {
    const result = await run(command, args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, ...(env ? { env } : {}) });
    if (result.error?.code === 'OCR_CANCELLED') throw result.error;
    return result;
  };
  const reasons = [];
  if (mode !== 'text') {
    const version = await invoke('sw_vers', ['-productVersion'], 10000);
    if (version.status !== 0 || Number(version.stdout.trim().split('.')[0]) < 26) {
      reasons.push('Document recognition requires macOS 26 or newer.');
    } else {
      const sdk = await invoke('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], 10000);
      if (sdk.status !== 0 || Number(sdk.stdout.trim().split('.')[0]) < 26) {
        reasons.push('Document recognition requires a matching macOS 26+ SDK and Swift toolchain.');
      } else {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-document-ocr-'));
        try {
          const binary = path.join(temp, 'ocr-documents');
          const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos26.0`;
          const compile = await invoke('xcrun', ['swiftc', '-parse-as-library', '-target', target, path.join(scriptDir, 'ocr_documents.swift'), '-o', binary], 45000);
          if (compile.error || compile.status !== 0) {
            reasons.push(`Document backend could not compile: ${(compile.stderr || compile.error?.message || 'compiler failed').trim().slice(-1500)}`);
          } else {
            try {
              const output = resultJson(await invoke(binary, files), 'Document recognition failed');
              output.selection = { requested: mode, selected: 'document', fallbackReasons: [] };
              return output;
            } catch (error) {
              if (error.code === 'OCR_CANCELLED') throw error;
              reasons.push(error.message);
            }
          }
        } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      }
    }
    if (mode === 'document') fail(reasons.join('\n'));
  }
  const legacyTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'wechat-legacy-ocr-'));
  let output;
  try {
    output = resultJson(await invoke('bash', [path.join(scriptDir, 'ocr_legacy.sh'), ...files], budget, { ...process.env, TMPDIR: legacyTemp }), 'Legacy text OCR failed');
  } finally { fs.rmSync(legacyTemp, { recursive: true, force: true }); }
  output.selection = { requested: mode, selected: 'text', fallbackReasons: reasons };
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: ocr.sh [--mode auto|document|text] [--timeout-seconds N] [--] IMAGE [IMAGE ...]\nauto: prefer native structured documents and fall back to the original text OCR.\ndocument: require the new API; fail visibly if unavailable.\ntext: force the original compatible OCR.\nDefault runtime budget per backend: 60 seconds plus 30 seconds per image.\n');
    else process.stdout.write(`${JSON.stringify(await recognize(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`OCR failed: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
