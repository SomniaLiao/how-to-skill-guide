// 內容檢查（規格書第 9 節）。check.html 使用，第二階段的後台直接匯入同一份規則。

import { safeExternalUrl, safeInternalPath } from './paths.js';

export const ERROR = '錯誤';
export const NOTICE = '提醒';

// ---------- 文字規則 ----------

const CJK = '\\u3005-\\u3007\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef';
const DASH = /[—–―‐‑‒−－]|--+/;
// 前後都是空白、中日文字或文字的開頭結尾。japanese-qa-practice 這類單字中的連字號不算
const LONE_HYPHEN = new RegExp(`(?:^|[\\s${CJK}])-(?=$|[\\s${CJK}])`, 'u');
const PENDING = /（待核對）|（要確認）/;

// 回傳 [{ level, message }]
export function checkText(text) {
  const problems = [];
  const plain = text.replace(/`[^`]+`/g, '`'); // 行內程式碼不受限。留下反引號，避免前後的字被接在一起
  if (/[;；]/.test(plain)) problems.push({ level: ERROR, message: '含有分號' });
  if (DASH.test(plain)) problems.push({ level: ERROR, message: '含有破折號或連續的連字號' });
  if (LONE_HYPHEN.test(plain)) problems.push({ level: ERROR, message: '含有單獨的連字號' });
  if (PENDING.test(plain)) problems.push({ level: NOTICE, message: '含有「（待核對）」或「（要確認）」' });
  return problems;
}

function checkBilingual(text, field, add) {
  for (const key of ['zh', 'ja']) {
    const value = text?.[key];
    if (typeof value !== 'string' || value.trim() === '') {
      add(`${field}.${key}`, ERROR, '缺少翻譯');
      continue;
    }
    for (const problem of checkText(value)) add(`${field}.${key}`, problem.level, problem.message);
  }
}

function checkList(items, field, add, checkItem) {
  if (!Array.isArray(items) || items.length === 0) {
    add(field, ERROR, '缺少內容');
    return;
  }
  items.forEach((item, index) => checkItem(item, `${field}[${index + 1}]`));
}

// ---------- 各類型的區塊 ----------

const PATH_MESSAGE = '內部路徑不符合規則';

function checkPath(kind, path, field, add, files) {
  if (!safeInternalPath(kind, path)) add(field, ERROR, PATH_MESSAGE);
  else if (files) files.push({ path, field, kind });
}

const blockCheckers = {
  paragraph: (block, { add }) => checkBilingual(block.text, 'text', add),
  subheading: (block, { add }) => checkBilingual(block.text, 'text', add),
  list: (block, { add }) => checkList(block.items, 'items', add, (item, field) => checkBilingual(item, field, add)),
  steps: (block, { add }) => {
    if (block.label !== undefined) checkBilingual(block.label, 'label', add);
    checkList(block.items, 'items', add, (item, field) => checkBilingual(item, field, add));
  },
  note: (block, { add }) => {
    if (!['tip', 'warning'].includes(block.variant)) add('variant', ERROR, '只能是 tip 或 warning');
    checkBilingual(block.text, 'text', add);
  },
  flow: (block, { add }) => checkList(block.items, 'items', add, (item, field) => checkBilingual(item, field, add)),
  table: (block, { add }) => {
    checkList(block.columns, 'columns', add, (item, field) => checkBilingual(item, field, add));
    checkList(block.rows, 'rows', add, (row, rowField) => {
      checkList(row, rowField, add, (cell, field) => checkBilingual(cell, field, add));
      if (row?.length !== block.columns?.length) add(rowField, ERROR, '格數與欄位數不同');
    });
  },
  figure: (block, { add, files }) => {
    checkPath('figure', block.src, 'src', add, files);
    if (block.src_ja !== undefined) checkPath('figure', block.src_ja, 'src_ja', add, files);
    checkBilingual(block.alt, 'alt', add);
    if (!['mobile', 'desktop'].includes(block.device)) add('device', ERROR, '缺少 device，或不是 mobile、desktop');
    if (!/^\d{4}-\d{2}$/.test(block.date ?? '')) add('date', NOTICE, '缺少截圖日期，或格式不是 YYYY-MM');
  },
  code: (block, { add, files }) => {
    checkPath('code', block.file, 'file', add, files);
    checkBilingual(block.caption, 'caption', add);
  },
  download: (block, { add, files }) => checkList(block.items, 'items', add, (item, field) => {
    checkPath('download', item?.file, `${field}.file`, add, files);
    checkBilingual(item?.label, `${field}.label`, add);
  }),
  sources: (block, { add }) => checkList(block.items, 'items', add, (item, field) => {
    if (!safeExternalUrl(item?.url)) add(`${field}.url`, ERROR, '網址不是 https 開頭，或無法解析');
    checkBilingual(item?.label, `${field}.label`, add);
  }),
  faq: (block, { add }) => {
    checkBilingual(block.q, 'q', add);
    checkBilingual(block.a, 'a', add);
  },
  link: (block, { add, page }) => {
    checkPath('link', block.href, 'href', add);
    if (page !== 'teacher') add('href', ERROR, '連結區塊只能用在教師頁');
    checkBilingual(block.label, 'label', add);
  },
};

// ---------- 檔案 ----------

// 檢查一個區塊。files 收集需要確認是否存在的檔案
export function checkBlock(block, { file, page, files = [] }) {
  const issues = [];
  const id = block?.id ?? '沒有編號';
  const add = (field, level, message) => issues.push({ file, id, field, level, message });
  if (!block || !Object.hasOwn(blockCheckers, block.type)) {
    add('type', ERROR, `未知的類型：${block?.type}`);
    return issues;
  }
  const found = [];
  blockCheckers[block.type](block, { add, page, files: found });
  for (const item of found) files.push({ ...item, file, id });
  return issues;
}

// 檢查 student.json 或 teacher.json
export function checkPage(content, file, files = []) {
  const issues = [];
  const page = content.page;
  const addFor = (id) => (field, level, message) => issues.push({ file, id, field, level, message });
  const checkBlocks = (blocks, id) => {
    if (!Array.isArray(blocks)) {
      addFor(id)('blocks', ERROR, '缺少內容');
      return;
    }
    for (const block of blocks) issues.push(...checkBlock(block, { file, page, files }));
  };

  checkBlocks(content.intro, 'intro');
  if (!Array.isArray(content.chapters)) {
    addFor('chapters')('chapters', ERROR, '缺少內容');
    return issues;
  }
  for (const chapter of content.chapters) {
    checkBilingual(chapter.title, 'title', addFor(chapter.id));
    checkBlocks(chapter.blocks, chapter.id);
  }
  return issues;
}

// 檢查 ui.json
export function checkUi(content, file) {
  const issues = [];
  for (const [id, text] of Object.entries(content.strings ?? {})) {
    checkBilingual(text, 'text', (field, level, message) => issues.push({ file, id, field, level, message }));
  }
  if (issues.length === 0 && Object.keys(content.strings ?? {}).length === 0) {
    issues.push({ file, id: 'strings', field: 'strings', level: ERROR, message: '缺少內容' });
  }
  return issues;
}

// 以 fetch 確認檔案是否存在。截圖列為提醒，其他列為錯誤
export async function checkFiles(files) {
  const results = await Promise.all(files.map(async ({ path, field, kind, file, id }) => {
    try {
      const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) return null;
    } catch {
      // 連線失敗視為不存在
    }
    return { file, id, field, level: kind === 'figure' ? NOTICE : ERROR, message: `檔案不存在：${path}` };
  }));
  return results.filter(Boolean);
}

// ---------- check.html ----------

async function loadAndCheck(name, files) {
  const file = `content/${name}.json`;
  try {
    const response = await fetch(file, { cache: 'no-store' });
    if (!response.ok) throw new Error(`回應 ${response.status}`);
    const content = await response.json();
    return name === 'ui' ? checkUi(content, file) : checkPage(content, file, files);
  } catch (error) {
    return [{ file, id: '整個檔案', field: '整個檔案', level: ERROR, message: `無法讀取：${error.message}` }];
  }
}

function showResult(issues) {
  const errors = issues.filter((issue) => issue.level === ERROR);
  const notices = issues.filter((issue) => issue.level === NOTICE);
  document.getElementById('check-summary').textContent = `錯誤 ${errors.length} 項，提醒 ${notices.length} 項。`;

  const body = document.getElementById('check-rows');
  body.replaceChildren();
  for (const issue of [...errors, ...notices]) {
    const row = document.createElement('tr');
    row.className = issue.level === ERROR ? 'check-error' : 'check-notice';
    for (const value of [issue.level, issue.file, issue.id, issue.field, issue.message]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  document.getElementById('check-table').hidden = issues.length === 0;
}

async function runCheckPage() {
  const files = [];
  const issues = (await Promise.all(['ui', 'student', 'teacher'].map((name) => loadAndCheck(name, files)))).flat();
  issues.push(...await checkFiles(files));
  showResult(issues);
}

// 只有 check.html 會自動執行，後台匯入時不會
if (globalThis.document?.body?.dataset.page === 'check') runCheckPage();
