// 後台的進入點：權杖登入、登出與畫面切換（規格書 11.1）。

import { ApiError, createClient, isValidRepo } from './github-api.js';

const TOKEN_KEY = 'htsg.admin.token';
const REPO_KEY = 'htsg.admin.repo';

const $ = (id) => document.getElementById(id);
const views = { loading: $('loading-view'), login: $('login-view'), app: $('app-view') };

let client = null;

// ---------- 保存 ----------

// 無痕模式或停用儲存時，存取可能直接丟出錯誤，所以每一處都包起來
function safely(action, fallback = null) {
  try {
    return action();
  } catch {
    return fallback;
  }
}

// 預設只存在分頁中（關閉分頁就消失）。勾選「記住此裝置」才長期保存
function saveToken(token, remember) {
  clearToken();
  const storage = remember ? localStorage : sessionStorage;
  return safely(() => { storage.setItem(TOKEN_KEY, token); return true; }, false);
}

function loadToken() {
  return safely(() => sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY));
}

// 登出與權杖失效時，兩個地方都清除
function clearToken() {
  safely(() => sessionStorage.removeItem(TOKEN_KEY));
  safely(() => localStorage.removeItem(TOKEN_KEY));
}

// repo 名稱不是機密，記住它省得每次輸入
function loadRepo() {
  const saved = safely(() => localStorage.getItem(REPO_KEY));
  return saved && isValidRepo(saved) ? saved : repoFromLocation();
}

// 在 GitHub Pages 上，網址就是「帳號名稱.github.io/repo 名稱/」
function repoFromLocation() {
  const { hostname, pathname } = window.location;
  if (!hostname.endsWith('.github.io')) return '';
  const owner = hostname.slice(0, -'.github.io'.length);
  const name = pathname.split('/')[1] ?? '';
  const repo = `${owner}/${name}`;
  return isValidRepo(repo) ? repo : '';
}

// ---------- 畫面 ----------

function show(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  // 換畫面後把焦點移到標題，螢幕報讀器才知道內容變了
  views[name].querySelector('h1')?.focus();
}

function setMessage(text) {
  $('login-message').textContent = text;
}

// 只依錯誤種類顯示固定的文字，不顯示 GitHub 的回應內容
function describe(error) {
  if (!(error instanceof ApiError)) return '發生未預期的錯誤，請重新整理頁面。';
  switch (error.kind) {
    case 'network': return '無法連線到 GitHub。請確認網路後再試一次。';
    case 'unauthorized': return '權杖無效或已過期，請重新登入。';
    case 'not-found': return '找不到這個 repo，或權杖沒有它的權限。請確認 repo 名稱與權杖的「Repository access」。';
    case 'forbidden': return 'GitHub 拒絕了這次的要求，可能是權杖的權限不足，或短時間內要求太多次。請稍後再試。';
    default: return `GitHub 回應錯誤（代碼 ${error.status}），請稍後再試。`;
  }
}

function showLogin(message = '') {
  client = null;
  $('repo-input').value = loadRepo();
  setMessage(message);
  show('login');
}

// 任何一次 API 回應 401，都清除權杖並回到登入畫面
function handleUnauthorized() {
  clearToken();
  showLogin('權杖無效或已過期，請重新登入。');
}

function showApp(repo) {
  $('repo-name').textContent = repo;
  show('app');
}

// ---------- 登入與登出 ----------

async function login(event) {
  event.preventDefault(); // CSP 禁止表單送出，一律由程式處理
  const repoInput = $('repo-input');
  const tokenInput = $('token-input');
  const button = $('login-button');
  const repo = repoInput.value.trim();
  const token = tokenInput.value.trim();

  if (!isValidRepo(repo)) {
    setMessage('Repo 的格式應為「帳號名稱/repo 名稱」。');
    repoInput.focus();
    return;
  }
  // 權杖不會有空白。含空白多半是複製時多選了文字
  if (!token || /\s/.test(token)) {
    setMessage('請貼上權杖。權杖中不會有空白。');
    tokenInput.focus();
    return;
  }

  button.disabled = true;
  setMessage('確認中');
  // 登入時的 401 只顯示訊息，不需要另外清除（還沒保存）
  const candidate = createClient({ token, repo, onUnauthorized: () => {} });
  try {
    await candidate.verify();
  } catch (error) {
    setMessage(describe(error));
    button.disabled = false;
    return;
  }
  button.disabled = false;

  const remember = $('remember-input').checked;
  const saved = saveToken(token, remember);
  safely(() => localStorage.setItem(REPO_KEY, repo));
  // 輸入框不留權杖，返回登入畫面時也不會看到
  tokenInput.value = '';
  $('remember-input').checked = false;
  client = createClient({ token, repo, onUnauthorized: handleUnauthorized });
  showApp(repo);
  if (!saved) {
    // 瀏覽器不允許儲存時仍可使用，只是重新整理後要再登入
    $('admin-main').querySelector('.admin-lead').textContent = '瀏覽器不允許儲存權杖，重新整理頁面後需要再登入一次。';
  }
}

function logout() {
  clearToken();
  showLogin('已登出。');
}

// 開啟頁面時，有保存的權杖就先確認它還能用
async function start() {
  $('login-form').addEventListener('submit', login);
  $('logout-button').addEventListener('click', logout);

  const token = loadToken();
  const repo = loadRepo();
  if (!token || !isValidRepo(repo)) {
    showLogin();
    return;
  }
  const candidate = createClient({ token, repo, onUnauthorized: handleUnauthorized });
  try {
    await candidate.verify();
  } catch (error) {
    // 401 已由 handleUnauthorized 處理。其他錯誤保留權杖，網路恢復後重新整理即可
    if (error.kind !== 'unauthorized') {
      if (error.kind === 'not-found') clearToken();
      showLogin(describe(error));
    }
    return;
  }
  client = candidate;
  showApp(repo);
}

start();

// 之後的步驟（讀寫、編輯器）由這裡取得已登入的 client
export function getClient() {
  return client;
}
