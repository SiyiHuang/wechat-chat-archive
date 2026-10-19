#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
swift_binary=$(mktemp "${TMPDIR:-/tmp}/wechat-archive-ocr-swift.XXXXXX")
trap 'rm -f "$swift_binary"' EXIT HUP INT TERM
if node -e 'const { spawnSync } = require("node:child_process"); const result = spawnSync("swift", ["-e", "import Foundation"], { timeout: 10000, stdio: "ignore" }); process.exit(result.status === 0 ? 0 : 1);'; then
  if node -e 'const { spawnSync } = require("node:child_process"); const result = spawnSync("swiftc", process.argv.slice(1), { timeout: 10000, stdio: "ignore" }); process.exit(result.status === 0 ? 0 : 1);' "$SCRIPT_DIR/ocr.swift" -o "$swift_binary"; then
    "$swift_binary" "$@"
    exit $?
  fi
fi
rm -f "$swift_binary"
trap - EXIT HUP INT TERM

objc_binary=$(mktemp "${TMPDIR:-/tmp}/wechat-archive-ocr-objc.XXXXXX")
objc_log=$(mktemp "${TMPDIR:-/tmp}/wechat-archive-ocr-build.XXXXXX")
trap 'rm -f "$objc_binary" "$objc_log"' EXIT HUP INT TERM
if clang -fobjc-arc -framework Foundation -framework CoreGraphics -framework CoreML -framework ImageIO -framework Vision \
  "$SCRIPT_DIR/ocr_fallback.m" -o "$objc_binary" 2>"$objc_log"; then
  "$objc_binary" "$@"
  exit $?
fi
cat "$objc_log" >&2
exit 1
