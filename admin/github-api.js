// GitHub REST API 的呼叫（規格書 11.1、11.2）。
// 權杖只存在這個模組的閉包中，不寫入錯誤訊息、console 或網址。

const API_ROOT = 'https://api.github.com';

// 帳號名稱只能有英數與連字號，repo 名稱另外允許句點與底線
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function isValidRepo(value) {
  return REPO_PATTERN.test(value) && !value.includes('..');
}

// 錯誤只帶狀態碼與分類，不帶回應內容，避免意外顯示敏感資訊
export class ApiError extends Error {
  constructor(status, kind) {
    super(kind);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

function classify(status) {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409 || status === 422) return 'conflict';
  return 'other';
}

// onUnauthorized：權杖失效時呼叫，由 admin.js 清除權杖並回到登入畫面
export function createClient({ token, repo, onUnauthorized }) {
  const [owner, name] = repo.split('/');
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

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

  return {
    // 確認權杖有效，而且讀得到這個 repo
    verify: () => request(repoPath),
    request,
    repoPath,
  };
}
