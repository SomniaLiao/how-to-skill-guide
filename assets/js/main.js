// 進入點：依 body 的 data-page 載入內容。

import { appendBilingual, createLangSwitch, initLangMode, setPageTitle } from './i18n.js';
import { renderBlocks, renderChapter } from './render.js';
import { initSidebar } from './sidebar.js';

// 介面文字本身讀不到時也要能顯示，所以這一句另外寫在程式裡（與 UI-14 相同）
const LOAD_ERROR = {
  zh: '內容載入失敗，請重新整理頁面。',
  ja: '内容を読み込めませんでした。ページを再読み込みしてください。',
};

const page = document.body.dataset.page === 'teacher' ? 'teacher' : 'student';
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
  box.className = 'load-error block';
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

function renderContent(content, context) {
  // 更新日期放在頁首，讀者一開始就能判斷內容新不新（D-36）
  const updated = document.createElement('p');
  updated.className = 'page-updated';
  appendBilingual(updated, context.strings['UI-12']);
  updated.append(content.updated);
  article.append(updated);

  const intro = document.createElement('div');
  intro.className = 'page-intro';
  intro.append(renderBlocks(content.intro, context));
  article.append(intro);

  content.chapters.forEach((chapter, index) => {
    article.append(renderChapter(chapter, index + 1, context));
  });
}

// 目錄直接由內容產生，不另外維護
function toTocChapters(content, strings) {
  // 第 0 項「開始之前」指向頁面頂端，同時當作回到頂端的方法（D-37）
  const top = { id: article.id, number: 0, title: strings['UI-25'], sections: [] };
  const chapters = content.chapters.map((chapter, index) => ({
    id: chapter.id,
    number: index + 1,
    title: chapter.title,
    sections: chapter.blocks
      .filter((block) => block.type === 'subheading')
      .map((block) => ({ id: block.id, title: block.text })),
  }));
  return [top, ...chapters];
}

// 內容是載入後才建立的，瀏覽器一開始找不到網址中的錨點，所以要自己跳一次。
// 截圖與範本讀完後高度會改變，讀者還沒捲動時再校正一次
function restoreAnchor(pending) {
  const target = location.hash.length > 1 ? document.getElementById(decodeHash()) : null;
  if (!target) return;
  target.scrollIntoView();

  let moved = false;
  const events = ['wheel', 'touchmove', 'keydown', 'pointerdown'];
  const onMove = () => { moved = true; };
  events.forEach((name) => window.addEventListener(name, onMove, { once: true, passive: true }));

  const images = [...article.querySelectorAll('img')]
    .filter((image) => !image.complete)
    .map((image) => new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }));
  Promise.allSettled([...pending, ...images]).then(() => {
    if (!moved) target.scrollIntoView();
    events.forEach((name) => window.removeEventListener(name, onMove));
  });
}

function decodeHash() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return ''; // 網址中的百分號編碼不完整
  }
}

async function start() {
  initLangMode();

  let strings;
  try {
    ({ strings } = await loadJson('content/ui.json'));
  } catch (error) {
    showLoadError(error);
    return;
  }

  const subtitle = strings[page === 'teacher' ? 'UI-03' : 'UI-02'];
  setPageTitle({
    zh: `${strings['UI-01'].zh}｜${subtitle.zh}`,
    ja: `${strings['UI-01'].ja}｜${subtitle.ja}`,
  });
  appendBilingual(document.querySelector('.skip-link'), strings['UI-16']);
  renderHeader(strings, subtitle);

  const context = { strings, page, pending: [] };
  let chapters = [];
  try {
    const content = await loadJson(`content/${page}.json`);
    renderContent(content, context);
    chapters = toTocChapters(content, strings);
  } catch (error) {
    showLoadError(error);
  }

  // 內容讀取失敗時，左側欄仍可切換語言
  initSidebar({ strings, chapters, page, langSwitch: createLangSwitch(strings['UI-04']) });
  restoreAnchor(context.pending);
}

start();
