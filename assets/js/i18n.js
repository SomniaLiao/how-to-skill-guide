// 語言模式的切換與保存，以及雙語文字的共用工具（規格書第 6 節）。

const STORAGE_KEY = 'htsg.langMode';
const DEFAULT_MODE = 'both';

// 選項文字固定，不隨模式改變（UI-05）
const MODES = [
  { value: 'zh', label: '中文', lang: 'zh-Hant-TW' },
  { value: 'ja', label: '日本語', lang: 'ja' },
  { value: 'both', label: '中文＋日本語', lang: 'zh-Hant-TW' },
];

const root = document.documentElement;
let pageTitle = null;

// ---------- 雙語文字的共用工具 ----------

// 反引號包住的部分拆成 code 元素，其餘為文字節點。全部以 textContent 寫入
function appendInline(parent, text) {
  for (const part of text.split(/(`[^`]+`)/)) {
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      parent.append(code);
    } else if (part) {
      parent.append(part); // append 字串等同建立文字節點
    }
  }
}

// 把雙語文字輸出成兩個元素，由 CSS 決定顯示哪一個
export function appendBilingual(parent, text, tag = 'span') {
  for (const [key, lang] of [['zh', 'zh-Hant-TW'], ['ja', 'ja']]) {
    const node = document.createElement(tag);
    node.className = `t t-${key}`;
    node.lang = lang;
    // 中日文字完全相同時（例如平台名稱），雙語模式只顯示一次
    if (key === 'ja' && text.ja === text.zh) node.classList.add('t-same');
    appendInline(node, text[key]);
    parent.append(node);
  }
  return parent;
}

// 屬性只能放一種語言：ja 模式用日語，其他模式用中文
export function attributeText(text) {
  return root.dataset.langMode === 'ja' ? text.ja : text.zh;
}

// ---------- 保存 ----------

// 無痕模式或停用儲存時，localStorage 可能直接丟出錯誤
function readMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.some((mode) => mode.value === saved) ? saved : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function saveMode(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // 存不了就不記住，不影響切換
  }
}

// ---------- 套用 ----------

function updateTitle() {
  if (!pageTitle) return;
  const mode = root.dataset.langMode;
  document.title = mode === 'both' ? `${pageTitle.zh} / ${pageTitle.ja}` : pageTitle[mode];
}

// 只改 html 的屬性，顯示與隱藏交給 CSS，不重新載入頁面
function applyMode(value) {
  root.dataset.langMode = value;
  root.lang = MODES.find((mode) => mode.value === value).lang;
  for (const radio of document.querySelectorAll('input[name="langMode"]')) {
    radio.checked = radio.value === value;
  }
  updateTitle();
  document.dispatchEvent(new CustomEvent('htsg:langchange'));
}

// ---------- 切換時保持閱讀位置 ----------

// 畫面最上方正在讀的區塊。只找區塊、小節標題與章標題，
// 包住整頁的外框（#article）也有 id，但它的頂端不會隨內容移動，不能拿來對位。
// 隱藏中的元素沒有方框，跳過
const ANCHOR_SELECTOR = 'main .block[id], main .section-title[id], main .chapter-title[id]';

function findReadingAnchor() {
  for (const node of document.querySelectorAll(ANCHOR_SELECTOR)) {
    if (node.getClientRects().length === 0) continue;
    if (node.getBoundingClientRect().bottom > 0) return node;
  }
  return null;
}

// 切換語言後文字變多或變少，頁面高度改變，捲動位置卻不變，閱讀位置就會跑掉。
// 所以先記住區塊在畫面上的位置，切換後捲回同樣的位置
function keepReadingPosition(change) {
  const anchor = findReadingAnchor();
  const before = anchor ? anchor.getBoundingClientRect() : null;
  change();
  if (!anchor) return;
  // 讀取位置時瀏覽器會先重新排版，所以這裡拿到的是切換後的位置
  const after = anchor.getBoundingClientRect();
  let target = before.top;
  if (before.top < 0 && before.height > 0) {
    // 區塊上半部已捲出畫面時，改為保持「讀到區塊的幾成」。
    // 只保持頂端的話，區塊變長或變短，畫面上看到的部分還是會跑掉
    target = (before.top / before.height) * after.height;
  }
  // instant：不要平滑捲動，否則看起來像畫面在跳
  window.scrollTo({ top: window.scrollY + (after.top - target), behavior: 'instant' });
}

// 在內容顯示之前呼叫，避免先閃過預設的語言
export function initLangMode() {
  applyMode(readMode());
  // 按上一頁時，瀏覽器可能直接還原舊畫面，所以重新讀一次設定
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) applyMode(readMode());
  });
}

// title 的格式：{ zh, ja }
export function setPageTitle(title) {
  pageTitle = title;
  updateTitle();
}

// ---------- 切換元件 ----------

export function createLangSwitch(legendText) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'lang-switch';
  fieldset.append(appendBilingual(document.createElement('legend'), legendText));

  const options = document.createElement('div');
  options.className = 'lang-switch-options';
  for (const mode of MODES) {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'langMode';
    radio.value = mode.value;
    radio.lang = mode.lang;
    radio.checked = mode.value === root.dataset.langMode;
    radio.addEventListener('change', () => {
      keepReadingPosition(() => applyMode(mode.value));
      saveMode(mode.value);
    });

    const label = document.createElement('label');
    label.className = 'lang-option';
    label.lang = mode.lang;
    const text = document.createElement('span');
    text.textContent = mode.label;
    label.append(radio, text);
    options.append(label);
  }
  fieldset.append(options);
  return fieldset;
}
