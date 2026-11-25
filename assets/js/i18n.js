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

// 把雙語文字輸出成兩個元素，由 CSS 決定顯示哪一個
export function appendBilingual(parent, text, tag = 'span') {
  for (const [key, lang] of [['zh', 'zh-Hant-TW'], ['ja', 'ja']]) {
    const node = document.createElement(tag);
    node.className = `t t-${key}`;
    node.lang = lang;
    node.textContent = text[key];
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
      applyMode(mode.value);
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
