import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "scripts/install.mjs");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "wechat-archive runtime "));

test("installer copies a self-contained skill into a destination containing spaces", async () => {
  const destination = path.join(temporaryRoot, "custom skills", "archive-wechat-chat");
  const result = spawnSync(process.execPath, [installer, "--dest", destination], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(await fs.readFile(path.join(destination, "SKILL.md"), "utf8"), /archive-wechat-chat/i);
  await fs.access(path.join(destination, "scripts/doctor.mjs"));
  await fs.access(path.join(destination, "scripts/ocr.swift"));
  await fs.access(path.join(destination, "scripts/ocr.sh"));
  await fs.access(path.join(destination, "scripts/ocr.mjs"));
  await fs.access(path.join(destination, "scripts/ocr_documents.swift"));
  await fs.access(path.join(destination, "scripts/ocr_legacy.sh"));
});

test("installer preserves an existing destination in a timestamped backup", async () => {
  const destination = path.join(temporaryRoot, "existing skill");
  const backupDirectory = path.join(temporaryRoot, "preserved installs");
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "SKILL.md"), "---\nname: archive-wechat-chat\n---\n");
  await fs.writeFile(path.join(destination, "user-data.txt"), "preserve me");

  const result = spawnSync(process.execPath, [installer, "--dest", destination, "--backup-dir", backupDirectory], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  const backupLine = result.stdout.split("\n").find((line) => line.startsWith("Previous installation preserved at "));
  assert.ok(backupLine, result.stdout);
  const backup = backupLine.slice("Previous installation preserved at ".length);
  assert.ok(backup.startsWith(await fs.realpath(backupDirectory)));
  assert.equal(await fs.readFile(path.join(backup, "user-data.txt"), "utf8"), "preserve me");
  await fs.access(path.join(destination, "scripts/ocr.swift"));
});

test("installer refuses to replace a populated directory that is not this skill", async () => {
  const destination = path.join(temporaryRoot, "important files");
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, "keep.txt"), "keep me");

  const result = spawnSync(process.execPath, [installer, "--dest", destination], { encoding: "utf8" });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to replace/i);
  assert.equal(await fs.readFile(path.join(destination, "keep.txt"), "utf8"), "keep me");
});

test("Claude installation includes read-only workers and can be repeated without changing them", async () => {
  const destination = path.join(temporaryRoot, "claude project", ".claude", "skills", "archive-wechat-chat");
  const backup = path.join(temporaryRoot, "claude backups");
  const args = [installer, "--client", "claude", "--with-agents", "--thinking-model", "inherit", "--execution-model", "haiku", "--dest", destination, "--backup-dir", backup];
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const installed = await fs.readFile(path.join(destination, "SKILL.md"), "utf8");
  assert.equal(installed, await fs.readFile(path.join(root, "skills/archive-wechat-chat/SKILL.md"), "utf8"));
  const worker = await fs.readFile(path.join(path.dirname(path.dirname(destination)), "agents/wechat-transcriber.md"), "utf8");
  assert.match(worker, /^model: haiku$/m);
  assert.match(worker, /^tools: Read, Glob, Grep$/m);
  const reviewer = await fs.readFile(path.join(path.dirname(path.dirname(destination)), "agents/wechat-reviewer.md"), "utf8");
  assert.match(reviewer, /^model: inherit$/m);
  await fs.access(path.join(destination, "references/claude-code.md"));
  const help = spawnSync(process.execPath, [path.join(destination, "scripts/archive.mjs"), "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
});

test("Claude installer preserves a conflicting user agent and leaves skill uninstalled", async () => {
  const config = path.join(temporaryRoot, "claude conflict", ".claude");
  await fs.mkdir(path.join(config, "agents"), { recursive: true });
  const existing = path.join(config, "agents/wechat-transcriber.md");
  await fs.writeFile(existing, "user-owned agent");
  const destination = path.join(config, "skills/archive-wechat-chat");
  const result = spawnSync(process.execPath, [installer, "--client", "claude", "--with-agents", "--thinking-model", "inherit", "--execution-model", "haiku", "--dest", destination], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Existing agent differs/);
  assert.equal(await fs.readFile(existing, "utf8"), "user-owned agent");
  await assert.rejects(fs.access(destination), { code: "ENOENT" });
});

test("installer rejects invalid clients and Claude-only flags before mutation", () => {
  for (const args of [["--client", "invalid"], ["--client"], ["--with-agents"]]) {
    const result = spawnSync(process.execPath, [installer, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /client/);
  }
});

test("Claude workers require explicit choices for both models", async () => {
  const destination = path.join(temporaryRoot, "unselected models", ".claude/skills/archive-wechat-chat");
  for (const extra of [[], ["--thinking-model", "inherit"], ["--execution-model", "haiku"]]) {
    const result = spawnSync(process.execPath, [installer, "--client", "claude", "--with-agents", "--dest", destination, ...extra], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Ask the user/);
    await assert.rejects(fs.access(destination), { code: "ENOENT" });
  }
});

test("installer refuses source checkout and home destinations", async () => {
  for (const destination of [root, os.homedir()]) {
    const result = spawnSync(process.execPath, [installer, "--dest", destination], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing|overlaps/i);
  }
});

test("installer resolves a symlinked parent before applying source protection", async (context) => {
  const alias = path.join(temporaryRoot, "source alias");
  try {
    await fs.symlink(root, alias, "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return context.skip("symlink creation is unavailable");
    throw error;
  }
  const result = spawnSync(process.execPath, [installer, "--dest", path.join(alias, "nested-install")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /overlaps the source checkout/i);
});

test("doctor reports runtime checks as JSON without asserting UI permission", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/doctor.mjs"), "--json"], { encoding: "utf8" });
  const report = JSON.parse(result.stdout);
  const ready = report.checks.every((check) => !["Node.js", "Clang", "Apple developer tools", "macOS SDK"].includes(check.name) || check.available);
  assert.equal(result.status, ready ? 0 : 1);
  assert.equal(report.platform, process.platform);
  assert.ok(report.checks.some((check) => check.name === "WeChat app"));
  assert.ok(report.checks.some((check) => check.name === "macOS SDK"));
  assert.ok(report.notes.some((note) => note.includes("does not inspect or grant")));
});

test("local Vision OCR reads generated Chinese and English text and returns confidence and boxes", { skip: process.platform !== "darwin" }, async () => {
  const fixture = path.join(temporaryRoot, "synthetic text image.png");
  const generator = path.join(temporaryRoot, "ocr-fixture-generator");
  const compile = spawnSync("clang", ["-fobjc-arc", "-framework", "AppKit", "-framework", "Foundation", path.join(root, "tests/ocr-fixture.m"), "-o", generator], { encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr);
  const generated = spawnSync(generator, [fixture], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);

  const ocr = spawnSync("bash", [path.join(root, "skills/archive-wechat-chat/scripts/ocr.sh"), "--mode", "text", fixture], { encoding: "utf8" });
  assert.equal(ocr.status, 0, ocr.stderr);
  const result = JSON.parse(ocr.stdout);
  const line = result.images[0].lines.find((entry) => entry.text.includes("WeChat archive fixture 123"));
  assert.ok(line, ocr.stdout);
  const recognized = result.images[0].lines.map((entry) => entry.text).join("\n");
  assert.ok(recognized.includes("微信归档"), ocr.stdout);
  assert.ok(recognized.includes("合成测试"), ocr.stdout);
  assert.ok(recognized.includes("09:30"), ocr.stdout);
  assert.ok(line.confidence >= 0 && line.confidence <= 1);
  assert.ok(line.bbox.width > 0 && line.bbox.height > 0);
  assert.equal(result.compute.selection, "automatic");
  assert.equal(result.engine.api, "VNRecognizeTextRequest");
  assert.equal(result.engine.kind, "text");
  assert.ok(["swift", "objective-c"].includes(result.engine.implementation));
  assert.ok(result.engine.supportedRevisions.length > 0);
  assert.equal(result.engine.revision, Math.max(...result.engine.supportedRevisions));
  assert.deepEqual(result.engine.recognitionLanguages, ["zh-Hans", "en-US"]);
  assert.equal(result.engine.recognitionLevel, "accurate");

  const fallbackBinary = path.join(temporaryRoot, "objective-c-ocr");
  const fallbackCompile = spawnSync("clang", ["-fobjc-arc", "-framework", "Foundation", "-framework", "CoreGraphics", "-framework", "CoreML", "-framework", "ImageIO", "-framework", "Vision", path.join(root, "skills/archive-wechat-chat/scripts/ocr_fallback.m"), "-o", fallbackBinary], { encoding: "utf8" });
  assert.equal(fallbackCompile.status, 0, fallbackCompile.stderr);
  const fallbackRun = spawnSync(fallbackBinary, [fixture], { encoding: "utf8" });
  assert.equal(fallbackRun.status, 0, fallbackRun.stderr);
  const fallback = JSON.parse(fallbackRun.stdout);
  assert.equal(fallback.engine.implementation, "objective-c");
  assert.ok(fallback.images[0].lines.some(entry => entry.text.includes("微信归档")), fallbackRun.stdout);
});

test("native document API reads generated tables and auto mode uses actual structure", { skip: process.platform !== "darwin" }, async (context) => {
  const macOS = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf8" });
  const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-version"], { encoding: "utf8" });
  if (Number(macOS.stdout.trim().split('.')[0]) < 26 || sdk.status !== 0 || Number(sdk.stdout.trim().split('.')[0]) < 26) return context.skip("Document API needs macOS and SDK 26+, old text OCR remains covered");
  const fixture = path.join(temporaryRoot, "synthetic structured document.png");
  const generator = path.join(temporaryRoot, "document-fixture-generator");
  const compile = spawnSync("clang", ["-fobjc-arc", "-framework", "AppKit", "-framework", "Foundation", path.join(root, "tests/document-fixture.m"), "-o", generator], { encoding: "utf8" });
  assert.equal(compile.status, 0, compile.stderr);
  assert.equal(spawnSync(generator, [fixture]).status, 0);
  const script = path.join(root, "skills/archive-wechat-chat/scripts/ocr.sh");
  const strict = spawnSync("bash", [script, "--mode", "document", fixture], { encoding: "utf8", timeout: 90000 });
  assert.equal(strict.status, 0, strict.stderr);
  const result = JSON.parse(strict.stdout);
  assert.equal(result.engine.api, "RecognizeDocumentsRequest");
  assert.equal(result.engine.kind, "document");
  assert.equal(result.selection.selected, "document");
  const documents = result.images[0].documents;
  assert.ok(documents.length > 0, strict.stdout);
  const transcript = documents.map(document => document.transcript).join('\n');
  assert.ok(transcript.includes('微信归档'), transcript);
  assert.ok(transcript.includes('Alice'), transcript);
  assert.ok(documents.some(document => document.paragraphs.length > 0), strict.stdout);
  const tables = documents.flatMap(document => document.tables);
  assert.ok(tables.length > 0, strict.stdout);
  const aliceRow = tables.flatMap(table => table.rows).find(row => row.some(cell => cell.text.includes('Alice')));
  assert.ok(aliceRow?.some(cell => cell.text.includes('42')), JSON.stringify(tables));
  assert.ok(aliceRow.length >= 3, JSON.stringify(tables));
  assert.ok(result.images[0].lines.every(line => line.bbox.width > 0 && line.bbox.height > 0));

  const auto = spawnSync("bash", [script, fixture, fixture], { encoding: "utf8", timeout: 90000 });
  assert.equal(auto.status, 0, auto.stderr);
  const selected = JSON.parse(auto.stdout);
  assert.equal(selected.selection.selected, 'document');
  assert.deepEqual(selected.selection.fallbackReasons, []);
  assert.equal(selected.images.length, 2);
});

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});
