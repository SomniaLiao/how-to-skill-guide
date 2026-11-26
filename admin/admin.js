// 後台的進入點：介面文字、語言切換、權杖登入與登出（規格書 11.1、D-38）。

import { appendBilingual, createLangSwitch, initLangMode, setPageTitle } from '../assets/js/i18n.js';
import { ApiError, createClient, isValidRepo } from './github-api.js';

const TOKEN_KEY = 'htsg.admin.token';
const REPO_KEY = 'htsg.admin.repo';

// 介面文字讀不到時，只能用寫在程式裡的這一句
const LOAD_ERROR = {
  zh: '後台的介面文字載入失敗，請重新整理頁面。',
  ja: '管理画面の表示用テキストを読み込めませんでした。ページを再読み込みしてください。',
};

const $ = (id) => document.getElementById(id);
const views = { loading: $('loading-view'), login: $('login-view'), app: $('app-view') };

let strings = {};
let langSwitch = null;
let client = null;

// ---------- 介面文字 ----------

// 取得編號對應的雙語文字。{status} 這類的位置換成實際的值
function text(id, values = {}) {
  const source = strings[id] ?? { zh: id, ja: id };
  const fill = (value) => value.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
  return { zh: fill(source.zh), ja: fill(source.ja) };
}

// 把雙語文字寫進元素，先清空原本的內容
function setText(node, id, values) {
  node.replaceChildren();
  appendBilingual(node, text(id, values));
}

function fillStaticText() {
  for (const node of document.querySelectorAll('[data-str]')) setText(node, node.dataset.str);
}

async function loadStrings() {
  const response = await fetch('admin/strings.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()).strings;
}

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
  // 語言切換只有一個，跟著畫面搬過去。做兩個的話，選項會被瀏覽器當成同一組
  const slot = views[name].querySelector('.admin-lang-slot');
  if (slot && langSwitch) slot.append(langSwitch);
  // 換畫面後把焦點移到標題，螢幕報讀器才知道內容變了
  views[name].querySelector('h1')?.focus();
}

// id 為空時清除訊息
function setMessage(id, values) {
  const node = $('login-message');
  if (id) setText(node, id, values);
  else node.replaceChildren();
}

// 只依錯誤種類顯示固定的文字，不顯示 GitHub 的回應內容
function describe(error) {
  if (!(error instanceof ApiError)) return ['AD-30'];
  switch (error.kind) {
    case 'network': return ['AD-25'];
    case 'unauthorized': return ['AD-26'];
    case 'not-found': return ['AD-27'];
    case 'forbidden': return ['AD-28'];
    default: return ['AD-29', { status: error.status }];
  }
}

function showLogin(message = []) {
  client = null;
  $('repo-input').value = loadRepo();
  setMessage(...message);
  show('login');
}

// 任何一次 API 回應 401，都清除權杖並回到登入畫面
function handleUnauthorized() {
  clearToken();
  showLogin(['AD-26']);
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
    setMessage('AD-23');
    repoInput.focus();
    return;
  }
  // 權杖不會有空白。含空白多半是複製時多選了文字
  if (!token || /\s/.test(token)) {
    setMessage('AD-24');
    tokenInput.focus();
    return;
  }

  button.disabled = true;
  setMessage('AD-21');
  // 登入時的 401 只顯示訊息，不需要另外清除（還沒保存）
  const candidate = createClient({ token, repo, onUnauthorized: () => {} });
  try {
    await candidate.verify();
  } catch (error) {
    setMessage(...describe(error));
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
  // 瀏覽器不允許儲存時仍可使用，只是重新整理後要再登入
  setText($('app-lead'), saved ? 'AD-20' : 'AD-31');
  showApp(repo);
}

function logout() {
  clearToken();
  showLogin(['AD-22']);
}

// ---------- 開始 ----------

async function start() {
  initLangMode(); // 與前台共用語言設定

  try {
    strings = await loadStrings();
  } catch {
    views.loading.replaceChildren();
    appendBilingual(views.loading, LOAD_ERROR, 'p');
    return;
  }
  fillStaticText();
  setPageTitle(strings['AD-01']);
  langSwitch = createLangSwitch(strings['AD-18']);

  $('login-form').addEventListener('submit', login);
  $('logout-button').addEventListener('click', logout);

  // 有保存的權杖就先確認它還能用
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
