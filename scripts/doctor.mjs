#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(here, "../skills/archive-wechat-chat/scripts/doctor.mjs"));
