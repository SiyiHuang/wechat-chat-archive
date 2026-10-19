#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const home = os.homedir();
const checks = [];

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
  if (result.error) return { available: false, detail: result.error.message };
  if (result.status !== 0) {
    const lines = (result.stderr || "command failed").trim().split("\n");
    return { available: false, detail: lines.find((line) => line.includes("SDK is not supported"))?.trim() ?? lines[0] };
  }
  return { available: true, detail: (result.stdout || result.stderr).trim().split("\n")[0] };
}

const osVersion = commandVersion("sw_vers", ["-productVersion"]);
checks.push({ name: "macOS", ...osVersion });
checks.push({ name: "Architecture", available: true, detail: process.arch });
const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push({ name: "Node.js", available: nodeMajor >= 20, detail: `${process.version}${nodeMajor < 20 ? " (version 20 or newer required)" : ""}` });
checks.push({ name: "Swift", ...commandVersion("swift", ["--version"]) });
checks.push({ name: "Swift SDK compile probe", ...commandVersion("swift", ["-e", "import Foundation; print(\"Foundation ready\")"]) });
checks.push({ name: "Clang", ...commandVersion("clang", ["--version"]) });
const developerDirectory = commandVersion("xcode-select", ["-p"]);
const sdkPath = commandVersion("xcrun", ["--sdk", "macosx", "--show-sdk-path"]);
const sdkVersion = commandVersion("xcrun", ["--sdk", "macosx", "--show-sdk-version"]);
checks.push({ name: "Apple developer tools", ...developerDirectory });
checks.push({ name: "macOS SDK", ...sdkPath });
checks.push({ name: "macOS SDK version", ...sdkVersion });
const supportsDocumentPrerequisites = osVersion.available && Number(osVersion.detail.split('.')[0]) >= 26
  && sdkVersion.available && Number(sdkVersion.detail.split('.')[0]) >= 26
  && checks.find(check => check.name === "Swift SDK compile probe")?.available;
checks.push({ name: "Structured document prerequisites", available: Boolean(supportsDocumentPrerequisites), detail: supportsDocumentPrerequisites ? "macOS 26+, SDK 26+, and basic Swift compile probe passed; verify the actual document request with a sample" : "Optional: document mode needs macOS 26+, SDK 26+, and matching Swift; auto mode retains legacy text OCR" });

const candidates = [
  "/Applications/WeChat.app",
  "/Applications/Weixin.app",
  path.join(home, "Applications/WeChat.app"),
  path.join(home, "Applications/Weixin.app"),
];
const installedApps = [...new Set(candidates.filter((candidate) => fs.existsSync(candidate)))];
checks.push({
  name: "WeChat app",
  available: installedApps.length > 0,
  detail: installedApps.length ? installedApps.join(", ") : "Not found in standard Applications folders",
});

const json = process.argv.includes("--json");
const report = {
  platform: process.platform,
  architecture: process.arch,
  checks,
  notes: [
    "This check does not inspect or grant macOS UI automation or Accessibility permissions.",
    "Apple Vision OCR runs locally through system frameworks; this report does not guarantee which compute device handled a request.",
    "Document recognition is optional. Old systems and toolchains can use ocr.sh --mode text; auto mode reports the selected backend and any fallback reason.",
  ],
};
if (!checks.find((check) => check.name === "Swift SDK compile probe")?.available) {
  report.notes.push("Swift cannot currently import Foundation; the OCR launcher uses its local Objective-C Vision fallback when available.");
}

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write("Local WeChat archive runtime\n");
  for (const check of checks) {
    process.stdout.write(`${check.available ? "OK" : "MISSING"}  ${check.name}: ${check.detail}\n`);
  }
  for (const note of report.notes) process.stdout.write(`NOTE  ${note}\n`);
}

if (process.platform !== "darwin" || checks.some((check) => ["Node.js", "Clang", "Apple developer tools", "macOS SDK"].includes(check.name) && !check.available)) {
  process.exitCode = 1;
}
