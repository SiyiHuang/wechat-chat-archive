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

  const ocr = spawnSync("bash", [path.join(root, "skills/archive-wechat-chat/scripts/ocr.sh"), fixture], { encoding: "utf8" });
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
});

test.after(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});
