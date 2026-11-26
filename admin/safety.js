// 儲存前的安全檢查（D-37 第 9 項）。
// 後台寫入 GitHub 時不會經過 tools/pre-push-check.sh，所以在這裡用同樣的規則再檢查一次。
// 規則與 pre-push-check.sh 相同。方括號的寫法讓這個檔案本身不會被那支檢查程式誤判

const RULES = [
  { kind: 'token', pattern: /(^|[^A-Za-z0-9])(gh[pousr]_|github[_]pat_)/i },
  { kind: 'key', pattern: /PRIVATE[ ]KEY|api[_-]?key|secre[t]/i },
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
];

// 回傳第一個找到的問題種類，沒有問題時回傳 null
export function findUnsafe(text) {
  return RULES.find((rule) => rule.pattern.test(text))?.kind ?? null;
}
