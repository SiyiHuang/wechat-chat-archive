#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const skillSource = path.join(repoRoot, "skills/archive-wechat-chat");
const skillName = "archive-wechat-chat";

function parseArgs(args) {
  let destination;
  let backupDirectory;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--dest") {
      if (!args[index + 1]) throw new Error("--dest requires a directory path");
      destination = args[++index];
    } else if (args[index] === "--backup-dir") {
      if (!args[index + 1]) throw new Error("--backup-dir requires a directory path");
      backupDirectory = args[++index];
    } else if (args[index] === "--help" || args[index] === "-h") {
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  return { destination, backupDirectory };
}

async function exists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function resolvePhysicalParent(target) {
  const resolved = path.resolve(target);
  let cursor = path.dirname(resolved);
  const suffix = [path.basename(resolved)];
  while (true) {
    try {
      const realParent = await fs.realpath(cursor);
      return path.join(realParent, ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(path.basename(cursor));
      const next = path.dirname(cursor);
      if (next === cursor) throw error;
      cursor = next;
    }
  }
}

async function resolvePhysicalDirectory(target) {
  const resolved = path.resolve(target);
  if (await exists(resolved)) return fs.realpath(resolved);
  return resolvePhysicalParent(resolved);
}

async function backupName(target, backupDirectory) {
  const stamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  const base = path.basename(target);
  let candidate = path.join(backupDirectory, `${base}-${stamp}`);
  let suffix = 1;
  while (await exists(candidate)) candidate = path.join(backupDirectory, `${base}-${stamp}-${suffix++}`);
  return candidate;
}

function overlaps(first, second) {
  const relative = path.relative(first, second);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function isRecognizedSkill(target) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  try {
    const frontmatter = (await fs.readFile(path.join(target, "SKILL.md"), "utf8")).slice(0, 2048);
    return /^---\s*\n[\s\S]*?^name:\s*archive-wechat-chat\s*$/m.test(frontmatter);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function validateTarget(target, backupDir) {
  const home = path.resolve(os.homedir());
  const root = path.parse(target).root;
  if (target === root || target === home) throw new Error("Refusing to install into a filesystem root or home directory");
  for (const protectedPath of [repoRoot, skillSource]) {
    if (overlaps(target, protectedPath) || overlaps(protectedPath, target)) {
      throw new Error(`Destination overlaps the source checkout: ${target}`);
    }
  }
  for (const skillsDirectory of [path.join(home, ".agents/skills"), path.join(home, ".codex/skills")]) {
    if (overlaps(skillsDirectory, backupDir)) throw new Error(`Backup directory must be outside skill discovery directories: ${backupDir}`);
  }
  if (overlaps(target, backupDir) || overlaps(backupDir, target)) throw new Error("Backup directory must be outside the skill destination");
  if (overlaps(backupDir, repoRoot) || overlaps(repoRoot, backupDir)) throw new Error("Backup directory must be outside the source checkout");

  if (await exists(target)) {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Destination exists and is not a skill directory: ${target}`);
    if (!(await isRecognizedSkill(target))) {
      const entries = await fs.readdir(target);
      if (entries.length) throw new Error(`Destination contains data but is not an ${skillName} skill; refusing to replace it: ${target}`);
    }
  }
}

async function install(target, backupDir) {
  await validateTarget(target, backupDir);
  const parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `.${skillName}.install-${process.pid}-${Date.now()}`);
  const oldTarget = path.join(parent, `.${skillName}.previous-${process.pid}-${Date.now()}`);
  let backup;
  let movedTarget = false;
  try {
    await fs.cp(skillSource, temporary, { recursive: true, errorOnExist: true, force: false });
    if (await exists(target)) {
      if (await isRecognizedSkill(target)) {
        await fs.mkdir(backupDir, { recursive: true });
        backup = await backupName(target, backupDir);
        await fs.cp(target, backup, { recursive: true, errorOnExist: true, force: false });
      }
      await fs.rename(target, oldTarget);
      movedTarget = true;
    }
    await fs.rename(temporary, target);
    if (movedTarget) await fs.rm(oldTarget, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (movedTarget && !(await exists(target)) && await exists(oldTarget)) await fs.rename(oldTarget, target);
    throw error;
  }
  process.stdout.write(`Installed ${skillName} to ${target}\n`);
  if (backup) process.stdout.write(`Previous installation preserved at ${backup}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`Usage: node scripts/install.mjs [--dest SKILL_DIRECTORY] [--backup-dir DIRECTORY]\n\nDefault: ${path.join(os.homedir(), ".agents/skills", skillName)}\n--dest names the final skill directory itself. Existing skill copies go to ${path.join(os.homedir(), ".local/share/wechat-chat-archive/backups")}.\n`);
    process.exit(0);
  }
  const target = path.resolve(options.destination ?? path.join(os.homedir(), ".agents/skills", skillName));
  const backupDirectory = path.resolve(options.backupDirectory ?? path.join(os.homedir(), ".local/share/wechat-chat-archive/backups"));
  if (!(await exists(path.join(skillSource, "SKILL.md")))) throw new Error(`Skill source is incomplete: ${skillSource}/SKILL.md is missing`);
  const physicalTarget = await resolvePhysicalParent(target);
  const physicalBackupDirectory = await resolvePhysicalDirectory(backupDirectory);
  await install(physicalTarget, physicalBackupDirectory);
} catch (error) {
  process.stderr.write(`Install failed: ${error.message}\n`);
  process.exitCode = 1;
}
