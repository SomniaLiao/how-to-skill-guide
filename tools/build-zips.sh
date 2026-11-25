#!/usr/bin/env bash
# 產生學生下載用的 ZIP 檔。範本修改後要重新執行並提交。
# 用法：bash tools/build-zips.sh

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT/templates"

# Windows 以 winget 安裝的 zip 不會自動加入 PATH
if ! command -v zip >/dev/null 2>&1; then
  PATH="$PATH:/c/Program Files (x86)/GnuWin32/bin"
fi
command -v zip >/dev/null 2>&1 || { echo "找不到 zip，請先安裝" >&2; exit 2; }
command -v unzip >/dev/null 2>&1 || { echo "找不到 unzip，請先安裝" >&2; exit 2; }

mkdir -p ../downloads

for skill in japanese-qa-practice japanese-tts-grammar-coach; do
  target="../downloads/$skill.zip"
  # 先刪除舊檔。zip 遇到既有檔案會合併，範本中已刪除的檔案會留在 ZIP 裡
  rm -f "$target"
  # -X 不記錄檔案的擁有者等額外資訊，-x 排除隱藏檔
  zip -q -r -X "$target" "$skill" -x "*/.*" -x ".*"
  echo "== $skill.zip"
  unzip -l "$target"
done
