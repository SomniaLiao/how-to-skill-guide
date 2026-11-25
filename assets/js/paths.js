// 網址與內部路徑的驗證（規格書 7.4）。check.html 與後台也共用這份規則。

const ALLOWED_PREFIXES = {
  figure: 'assets/img/screenshots/',
  code: 'templates/',
  download: 'downloads/',
};

// 外部網址只接受 https 開頭。合格時回傳網址，不合格時回傳 null
export function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// 內部路徑。合格時回傳原字串，不合格時回傳 null
export function safeInternalPath(kind, value) {
  if (typeof value !== 'string') return null;
  // 只允許這些字元，同時排除冒號、反斜線、百分號編碼與換行。
  // 瀏覽器會把 %2e%2e 視為 ..，也會自動略過網址中的換行，只檢查 .. 擋不住
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return null;
  if (value.includes('..') || value.includes('//')) return null;
  if (kind === 'link') return value === 'index.html' ? value : null;
  const prefix = ALLOWED_PREFIXES[kind];
  if (!prefix || !value.startsWith(prefix) || value.length === prefix.length) return null;
  return value;
}
