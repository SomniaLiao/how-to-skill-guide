// 進入點：依 body 的 data-page 載入內容。

import { appendBilingual, createLangSwitch, initLangMode, setPageTitle } from './i18n.js';
import { initSidebar } from './sidebar.js';

// 介面文字本身讀不到時也要能顯示，所以這一句另外寫在程式裡（與 UI-14 相同）
const LOAD_ERROR = {
  zh: '內容載入失敗，請重新整理頁面。',
  ja: '内容を読み込めませんでした。ページを再読み込みしてください。',
};

const page = document.body.dataset.page;
const article = document.getElementById('article');

async function loadJson(path) {
  // no-cache 會先向伺服器確認有沒有新版，教師更新後讀者才看得到
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} 回應 ${response.status}`);
  return response.json();
}

function showLoadError(error) {
  console.error(error);
  const box = document.createElement('div');
  box.className = 'load-error';
  box.setAttribute('role', 'alert');
  article.append(appendBilingual(box, LOAD_ERROR, 'p'));
}

function renderHeader(strings, subtitle) {
  const title = document.createElement('h1');
  title.className = 'page-title font-head';
  const sub = document.createElement('div');
  sub.className = 'page-subtitle';
  article.append(appendBilingual(title, strings['UI-01']), appendBilingual(sub, subtitle, 'p'));
}

async function start() {
  initLangMode();
  try {
    const { strings } = await loadJson('content/ui.json');
    const subtitle = strings[page === 'teacher' ? 'UI-03' : 'UI-02'];
    setPageTitle({
      zh: `${strings['UI-01'].zh}｜${subtitle.zh}`,
      ja: `${strings['UI-01'].ja}｜${subtitle.ja}`,
    });
    appendBilingual(document.querySelector('.skip-link'), strings['UI-16']);
    renderHeader(strings, subtitle);
    initSidebar({ strings, chapters: [], page, langSwitch: createLangSwitch(strings['UI-04']) });
  } catch (error) {
    showLoadError(error);
  }
}

start();
