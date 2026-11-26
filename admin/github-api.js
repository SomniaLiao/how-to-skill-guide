// GitHub REST API 的呼叫（規格書 11.1、11.2）。
// 權杖只存在這個模組的閉包中，不寫入錯誤訊息、console 或網址。

import { findUnsafe } from './safety.js';

const API_ROOT = 'https://api.github.com';

// 帳號名稱只能有英數與連字號，repo 名稱另外允許句點與底線
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

// 後台只能寫入這些資料夾。程式出錯時也不會改到其他檔案（例如 admin.html）
const WRITABLE = ['content/', 'templates/', 'assets/img/screenshots/', 'downloads/'];

export function isValidRepo(value) {
  return REPO_PATTERN.test(value) && !value.includes('..');
}

export function isWritablePath(path) {
  return WRITABLE.some((prefix) => path.startsWith(prefix))
    && !/\.\.|\/\/|\\|:/.test(path)
    && !path.endsWith('/');
}

// 錯誤只帶狀態碼與分類，不帶回應內容，避免意外顯示敏感資訊
export class ApiError extends Error {
  constructor(status, kind, detail) {
    super(kind);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.detail = detail; // unsafe 時是問題種類（token、key、email）
  }
}

function classify(status) {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  // 409：sha 不符。422：檔案已存在卻沒附 sha。兩者都代表檔案已被別人改過（規格書 11.2）
  if (status === 409 || status === 422) return 'conflict';
  return 'other';
}

// ---------- Base64 ----------
// GitHub 以 Base64 傳送檔案內容。btoa、atob 只能處理單一位元組的字元，
// 中日文要先用 TextEncoder 轉成 UTF-8 的位元組（規格書 11.2 第三項）

export function bytesToBase64(bytes) {
  let binary = '';
  // 分段處理，避免大檔案一次展開時超過函式參數的上限
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64.replace(/\s/g, '')); // GitHub 每 60 字會換行
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const textToBytes = (text) => new TextEncoder().encode(text);
// fatal：遇到不是 UTF-8 的內容時直接報錯，不默默換成亂碼
export const bytesToText = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

// ---------- 用戶端 ----------

// onUnauthorized：權杖失效時呼叫，由 admin.js 清除權杖並回到登入畫面
export function createClient({ token, repo, onUnauthorized }) {
  const [owner, name] = repo.split('/');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  let identity = null;

  async function request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetch(API_ROOT + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',       // 每次都拿最新的檔案與 sha
        credentials: 'omit',     // 不送出瀏覽器的 cookie
        referrerPolicy: 'no-referrer',
      });
    } catch {
      // 斷線或被擋時 fetch 直接丟出錯誤，原本的錯誤內容不往外傳
      throw new ApiError(0, classify(0));
    }
    if (response.status === 401) onUnauthorized();
    if (!response.ok) throw new ApiError(response.status, classify(response.status));
    return response.status === 204 ? null : response.json();
  }

  // 路徑的每一段分別編碼，斜線保留
  const contentsPath = (path) => `${repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  // 讀取檔案。回傳位元組與 sha，sha 在寫入時要附上
  async function readFile(path) {
    const data = await request(contentsPath(path));
    if (Array.isArray(data) || data.type !== 'file') throw new ApiError(404, 'not-found');
    // 超過 1MB 的檔案，contents 端點不附內容，改用 blob 端點讀取
    if (data.encoding !== 'base64') {
      const blob = await request(`${repoPath}/git/blobs/${encodeURIComponent(data.sha)}`);
      return { bytes: base64ToBytes(blob.content), sha: data.sha };
    }
    return { bytes: base64ToBytes(data.content), sha: data.sha };
  }

  async function readText(path) {
    const { bytes, sha } = await readFile(path);
    return { text: bytesToText(bytes), sha };
  }

  async function readJson(path) {
    const { text, sha } = await readText(path);
    return { data: JSON.parse(text), sha };
  }

  // 提交者一律使用 GitHub 的 noreply 地址，個人信箱不會進入提交紀錄（規格書 8.4、D-37）。
  // 名稱與本機提交相同，使用 repo 名稱，不使用帳號名稱
  async function getIdentity() {
    if (!identity) {
      const user = await request('/user');
      identity = { name, email: `${user.id}+${user.login}@users.noreply.github.com` };
    }
    return identity;
  }

  // 寫入檔案。content 為 { text } 或 { bytes }。
  // sha 是讀取時拿到的版本。新檔案不附 sha。回傳新的 sha 與提交編號
  async function writeFile(path, content, { sha, message }) {
    if (!isWritablePath(path)) throw new ApiError(0, 'path');
    let bytes = content.bytes;
    if (content.text !== undefined) {
      // 文字內容先做安全檢查，有問題就不送出
      const unsafe = findUnsafe(content.text);
      if (unsafe) throw new ApiError(0, 'unsafe', unsafe);
      bytes = textToBytes(content.text);
    }
    const author = await getIdentity();
    const body = { message, content: bytesToBase64(bytes), committer: author, author };
    if (sha) body.sha = sha;
    const result = await request(contentsPath(path), { method: 'PUT', body });
    return { sha: result.content.sha, commit: result.commit.sha };
  }

  // 列出某個資料夾下的所有檔案（含子資料夾）。一次取得整個 repo 的檔案樹，再篩選。
  // 以「.」開頭的檔案或資料夾不列出
  // 回傳 [{ path, sha }]。sha 在覆蓋圖片時要附上，不必另外讀取檔案
  async function listEntries(prefix) {
    const data = await request(`${repoPath}/git/trees/HEAD?recursive=1`);
    return data.tree
      .filter((item) => item.type === 'blob' && item.path.startsWith(prefix))
      .filter((item) => !item.path.split('/').some((part) => part.startsWith('.')))
      .map((item) => ({ path: item.path, sha: item.sha }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  const listFiles = async (prefix) => (await listEntries(prefix)).map((item) => item.path);

  return {
    // 確認權杖有效，而且讀得到這個 repo
    verify: () => request(repoPath),
    listFiles,
    listEntries,
    readFile,
    readText,
    readJson,
    writeFile,
    getIdentity,
  };
}

// 寫入 JSON 的格式與 repo 中的檔案一致：兩格縮排，結尾換行。
// 格式一致，GitHub 上的差異比對才只會顯示真正改動的地方
export function formatJson(data) {
  if (!isStringsFile(data)) return `${JSON.stringify(data, null, 2)}\n`;
  // ui.json 與 strings.json 的每一句寫在同一行，方便對照中日文
  const lines = Object.entries(data).map(([key, value]) => {
    if (key !== 'strings') return `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
    const entries = Object.entries(value).map(([id, text]) => {
      const pairs = Object.entries(text).map(([lang, words]) => `${JSON.stringify(lang)}: ${JSON.stringify(words)}`);
      return `    ${JSON.stringify(id)}: { ${pairs.join(', ')} }`;
    });
    return `  "strings": {\n${entries.join(',\n')}\n  }`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

function isStringsFile(data) {
  return data !== null && typeof data.strings === 'object' && !Array.isArray(data.strings) && !('chapters' in data);
}

// 今天的日期（YYYY-MM-DD），用於 updated 欄位（D-37 第 7 項）。以使用者電腦的時區計算
export function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
