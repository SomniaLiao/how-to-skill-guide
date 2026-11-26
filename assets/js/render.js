// 區塊渲染（規格書 7.3、7.4）。所有文字一律以 textContent 寫入。

import { createCopyButton } from './copy.js';
import { appendBilingual, attributeText } from './i18n.js';
import { safeExternalUrl, safeInternalPath } from './paths.js';

// ---------- 小工具 ----------

function element(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

const bilingual = (tag, className, text, childTag = 'span') =>
  appendBilingual(element(tag, className), text, childTag);

function warn(block, message) {
  console.warn(`[${block.id ?? '沒有編號'}] ${message}`);
}

// ---------- 截圖 ----------

// 替代文字是屬性，只能放一種語言，所以切換語言時要更新
const altTexts = new WeakMap();

function applyAlt(image) {
  const text = altTexts.get(image);
  if (!text) return;
  image.alt = attributeText(text);
  image.lang = document.documentElement.lang;
}

document.addEventListener('htsg:langchange', () => {
  document.querySelectorAll('.shot img').forEach(applyAlt);
});

function missingShot(className, strings) {
  return element('div', `shot-missing ${className}`, bilingual('div', '', strings['UI-10']));
}

function createShot(block, src, className, strings) {
  const path = safeInternalPath('figure', src);
  if (!path) {
    warn(block, `截圖路徑不符合規則：${src}`);
    return missingShot(className, strings);
  }
  const image = element('img', className);
  altTexts.set(image, block.alt);
  applyAlt(image);
  image.addEventListener('error', () => {
    warn(block, `找不到截圖：${path}`);
    image.replaceWith(missingShot(className, strings));
  }, { once: true });
  image.src = path;
  return image;
}

// ---------- 各類型的區塊，每種一個函式 ----------

const renderers = {
  paragraph: (block) => bilingual('div', 'paragraph', block.text, 'p'),

  subheading: (block) => bilingual('h3', 'section-title font-head', block.text),

  list: (block) => element('ul', 'list', ...block.items.map((item) => bilingual('li', '', item))),

  steps: (block, { strings }) => element('div', '',
    bilingual('div', 'steps-label', block.label ?? strings['UI-17']),
    element('ol', 'steps', ...block.items.map((item) => bilingual('li', '', item)))),

  note: (block, { strings }) => {
    const isWarning = block.variant === 'warning';
    const node = element('div', `note ${isWarning ? 'note-warning' : 'note-tip'}`,
      bilingual('div', 'note-label', strings[isWarning ? 'UI-18' : 'UI-19']));
    return appendBilingual(node, block.text, 'p');
  },

  flow: (block) => element('ol', 'flow', ...block.items.map((item) => bilingual('li', '', item))),

  table: (block) => {
    const headCells = block.columns.map((column) => {
      const cell = bilingual('th', '', column);
      cell.scope = 'col';
      return cell;
    });
    const rows = block.rows.map((row) => element('tr', '', ...row.map((cell) => bilingual('td', '', cell))));
    const wrap = element('div', 'table-wrap',
      element('table', 'table',
        element('thead', '', element('tr', '', ...headCells)),
        element('tbody', '', ...rows)));
    wrap.tabIndex = 0; // 讓鍵盤也能水平捲動
    return wrap;
  },

  figure: (block, { strings }) => {
    const node = element('figure', `shot ${block.device === 'mobile' ? 'shot-mobile' : 'shot-desktop'}`,
      createShot(block, block.src, 'shot-img-zh', strings));
    if (block.src_ja) {
      node.classList.add('shot-has-ja');
      node.append(createShot(block, block.src_ja, 'shot-img-ja', strings));
    }
    if (block.date) {
      const caption = bilingual('figcaption', '', strings['UI-24']);
      caption.append(block.date);
      node.append(caption);
    }
    return node;
  },

  code: (block, { strings, page, pending }) => {
    const path = safeInternalPath('code', block.file);
    if (!path) {
      warn(block, `範本路徑不符合規則：${block.file}`);
      return null;
    }
    const code = element('code');
    // 題組檔以日語為主，其他範本以中文為主，用來決定漢字的字形
    code.lang = path.includes('/references/') ? 'ja' : 'zh-Hant-TW';
    const pre = element('pre', 'code-body', code);
    pre.tabIndex = 0;

    const title = element('div', '', bilingual('div', 'code-caption', block.caption), element('div', 'code-file', path));
    const head = element('div', 'code-head', title);
    const node = element('div', 'code-block', head, pre);

    pending.push(fetch(path, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`回應 ${response.status}`);
        return response.text();
      })
      .then((text) => {
        code.textContent = text;
        // 讀到內容後才放複製按鈕，避免複製到空白
        if (page === 'teacher') head.append(createCopyButton(code, strings));
      })
      .catch((error) => {
        warn(block, `無法讀取範本 ${path}：${error.message}`);
        pre.replaceWith(bilingual('div', 'load-error', strings['UI-14'], 'p'));
      }));
    return node;
  },

  download: (block) => {
    const items = [];
    for (const item of block.items) {
      const path = safeInternalPath('download', item.file);
      if (!path) {
        warn(block, `下載路徑不符合規則：${item.file}`);
        continue;
      }
      const fileName = path.split('/').pop();
      const link = bilingual('a', 'download-link', item.label);
      link.href = path;
      link.download = fileName;
      link.append(element('span', 'download-file', fileName));
      items.push(element('li', '', link));
    }
    return items.length > 0 ? element('ul', 'download', ...items) : null;
  },

  sources: (block, { strings }) => {
    const items = block.items.map((item) => {
      const url = safeExternalUrl(item.url);
      if (!url) {
        warn(block, `網址不符合規則：${item.url}`);
        return bilingual('li', '', item.label); // 只顯示文字，不輸出連結
      }
      const link = bilingual('a', '', item.label);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return element('li', '', link);
    });
    return element('div', 'sources', bilingual('div', 'sources-title', strings['UI-11']), element('ul', '', ...items));
  },

  faq: (block) => element('details', 'faq',
    bilingual('summary', '', block.q),
    bilingual('div', 'faq-answer', block.a, 'p')),

  link: (block, { page }) => {
    const path = safeInternalPath('link', block.href);
    if (!path || page !== 'teacher') {
      warn(block, `內部連結不符合規則：${block.href}`);
      return null;
    }
    const link = bilingual('a', '', block.label);
    link.href = path;
    return element('div', 'page-link', link);
  },
};

// ---------- 對外的函式 ----------

// context 的格式：{ strings, page, pending }。
// pending 收集尚未讀完的範本，呼叫的人可以等它們全部完成
export function renderBlock(block, context) {
  // 用 hasOwn 判斷，避免 type 寫成 constructor 之類的內建名稱
  if (!Object.hasOwn(renderers, block.type)) {
    warn(block, `未知的類型：${block.type}`);
    return null;
  }
  try {
    const node = renderers[block.type](block, context);
    if (!node) return null;
    node.id = block.id;
    if (block.type !== 'subheading') node.classList.add('block');
    return node;
  } catch (error) {
    // 一個區塊的資料有誤時，不影響其他區塊
    warn(block, `無法渲染：${error.message}`);
    return null;
  }
}

// 頁面上不顯示的區塊（D-37 第 3 項）。後台的預覽直接呼叫 renderBlock，仍看得到
export const isHidden = (block) => block.hidden === true;

export function renderBlocks(blocks, context) {
  const fragment = document.createDocumentFragment();
  for (const block of blocks) {
    if (isHidden(block)) continue;
    const node = renderBlock(block, context);
    if (node) fragment.append(node);
  }
  return fragment;
}

export function renderChapter(chapter, number, context) {
  const num = element('span', 'chapter-num');
  num.textContent = String(number);
  const title = element('h2', 'chapter-title font-head', num, bilingual('span', '', chapter.title));
  title.id = chapter.id;
  return element('section', 'chapter', title, renderBlocks(chapter.blocks, context));
}
