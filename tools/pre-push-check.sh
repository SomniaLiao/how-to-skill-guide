#!/usr/bin/env bash
# 上傳前的憑證與隱私檢查。
# 用法：bash tools/pre-push-check.sh
# 結束代碼：0 為沒有問題，1 為發現問題，2 為檢查本身無法執行。
#
# 檢查範圍有兩部分：
#   一、git 追蹤的全部檔案（暫存區的內容）
#   二、即將上傳的每一筆提交。檔案後來刪掉了，仍會留在歷史紀錄中
#
# 只列出位置、不印出內容，避免憑證再次出現在畫面或對話紀錄裡。

set -u

fail() {
  echo "檢查無法執行：$1" >&2
  exit 2
}

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "這裡不是 git repo"
cd "$ROOT" || fail "無法進入 repo 根目錄"

# 樣式中使用方括號（例如 [t]），讓這份檔案的文字不會符合自己的樣式。
TOKEN_PATTERN='(^|[^A-Za-z0-9])(gh[pousr]_|github[_]pat_)'
KEY_PATTERN='PRIVATE[ ]KEY|api[_-]?key|secre[t]'
EMAIL_PATTERN='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'

# 不該出現在 repo 的檔案。
HIDDEN_PATTERN='(^|/)(\.DS_Store|Thumbs\.db)$'
PRIVATE_PATH_PATTERN='^(0_Data|handoff)/|(^|/)CLAUDE\.md$|(^|/)\.env(\.[^/]*)?$|\.(pem|key)$'

NOREPLY_SUFFIX='@users.noreply.github.com'

problems=0
token_found=0

report() { # $1 類別　$2 位置
  echo "[$1] $2"
  problems=$((problems + 1))
}

# 在暫存區或指定的提交中搜尋內容。
scan_content() { # $1 類別　$2 樣式　$3 提交（空字串代表暫存區）
  local category="$1" pattern="$2" commit="$3" output status fields

  # -z 讓檔名後以空字元分隔，再換成冒號，檔名含中文時也能正確顯示
  if [ -n "$commit" ]; then
    output="$(set -o pipefail; git grep -I -i -n -z -E -e "$pattern" "$commit" -- | tr '\0' ':')"
    status=$?
    fields=1-3
  else
    output="$(set -o pipefail; git grep --cached -I -i -n -z -E -e "$pattern" -- | tr '\0' ':')"
    status=$?
    fields=1-2
  fi

  # git grep 的 1 代表沒找到，大於 1 代表執行失敗。失敗不能當成沒有問題
  [ "$status" -le 1 ] || fail "git grep 執行失敗（$category）"
  [ -n "$output" ] || return 0

  while IFS= read -r location; do
    report "$category" "$location"
  done < <(printf '%s\n' "$output" | cut -d: -f"$fields")
  [ "$category" = "GitHub 權杖" ] && token_found=1
  return 0
}

# 檢查檔案清單中有沒有不該上傳的檔案。
scan_paths() { # $1 檔案清單　$2 位置的前綴
  local list="$1" prefix="$2" path
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if printf '%s' "$path" | grep -qiE "$HIDDEN_PATTERN"; then
      report "隱藏檔" "$prefix$path"
    elif printf '%s' "$path" | grep -qiE "$PRIVATE_PATH_PATTERN"; then
      report "不該上傳的檔案" "$prefix$path"
    fi
  done <<< "$list"
}

scan_all_content() { # $1 提交（空字串代表暫存區）
  scan_content "GitHub 權杖" "$TOKEN_PATTERN" "$1"
  scan_content "一般金鑰" "$KEY_PATTERN" "$1"
  scan_content "電子郵件" "$EMAIL_PATTERN" "$1"
}

# 一、git 追蹤的全部檔案
files="$(git -c core.quotepath=off ls-files)" || fail "無法取得檔案清單"
[ -n "$files" ] || fail "沒有任何被追蹤的檔案，請先 git add"
scan_paths "$files" ""
scan_all_content ""

# 二、即將上傳的提交（還不在任何遠端分支上的提交）
commits=""
if git rev-parse -q --verify HEAD >/dev/null; then
  commits="$(git rev-list HEAD --not --remotes)" || fail "無法取得提交清單"
fi

commit_count=0
for commit in $commits; do
  commit_count=$((commit_count + 1))
  short="${commit:0:8}"

  commit_files="$(git -c core.quotepath=off ls-tree -r --name-only "$commit")" || fail "無法讀取提交 $short"
  scan_paths "$commit_files" "$short:"
  scan_all_content "$commit"

  # 提交訊息也會公開
  message="$(git log -1 --format=%B "$commit")" || fail "無法讀取提交訊息 $short"
  if printf '%s' "$message" | grep -qiE "$TOKEN_PATTERN"; then
    report "GitHub 權杖" "$short 的提交訊息"
    token_found=1
  fi
  if printf '%s' "$message" | grep -qiE "$KEY_PATTERN"; then
    report "一般金鑰" "$short 的提交訊息"
  fi
  if printf '%s' "$message" | grep -qiE "$EMAIL_PATTERN"; then
    report "電子郵件" "$short 的提交訊息"
  fi

  # 作者與提交者的電子郵件只能是 noreply 地址
  emails="$(git log -1 --format='%ae%n%ce' "$commit")" || fail "無法讀取提交者 $short"
  while IFS= read -r email; do
    case "$email" in
      *"$NOREPLY_SUFFIX") ;;
      *) report "提交者的電子郵件不是 noreply" "$short" ;;
    esac
  done <<< "$emails"
done

echo "已檢查 $(printf '%s\n' "$files" | wc -l | tr -d ' ') 個檔案、$commit_count 筆即將上傳的提交。"
echo "發現問題：$problems 項"

if [ "$token_found" -eq 1 ]; then
  echo "發現 GitHub 權杖：除了移除檔案，也必須立即到 GitHub 撤銷該權杖。" >&2
fi

[ "$problems" -eq 0 ] || exit 1
exit 0
