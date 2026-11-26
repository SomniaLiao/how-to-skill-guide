// 編輯器：左側清單、以編號搜尋、區塊表單、即時檢查與預覽（規格書 11.3、D-37）。
// 區塊的新增、刪除、移動、隱藏，以及章標題的修改（P2-3c）。

import { checkBlock, checkFiles, ERROR, LEVEL_TEXT } from '../assets/js/check.js';
import { appendBilingual, attributeText } from '../assets/js/i18n.js';
import { isHidden, renderBlock } from '../assets/js/render.js';
import { BLOCK_TYPES, buildBlockForm, excerpt, ID_PATTERN, newBlock } from './fields.js';

const PAGES = [
  { key: 'student', path: 'content/student.json', name: 'AD-49' },
  { key: 'teacher', path: 'content/teacher.json', name: 'AD-50' },
];
const UI_PATH = 'content/ui.json';
const INTRO = 'intro';
const REFRESH_MS = 200; // 輸入停下來後多久更新檢查與預覽

// docs：path → { data, sha }。dirty：path → 修改過的編號（區塊或章）。
// selected：{ kind: 'block', page, block } 或 { kind: 'section', page, sectionId }
const state = { docs: new Map(), dirty: new Map(), selected: null, text: null, nodes: null };

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(className, content, onClick) {
  const node = element('button', className);
  node.type = 'button';
  node.append(content);
  node.addEventListener('click', onClick);
  return node;
}

// ---------- 文字 ----------

// 後台文字（AD-）與前台介面文字（UI-）都可以用
function lookup(id) {
  if (id.startsWith('UI-')) return state.docs.get(UI_PATH)?.data.strings[id] ?? { zh: id, ja: id };
  return state.text(id);
}

function label(id, className = '', tag = 'span') {
  return appendBilingual(element(tag, className), lookup(id));
}

const attr = (id) => attributeText(lookup(id));

function fill(textObject, values) {
  const apply = (value) => value.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  return { zh: apply(textObject.zh), ja: apply(textObject.ja) };
}

// ---------- 資料 ----------

// 讀取兩頁的內容與介面文字。介面文字也是預覽需要的
export async function loadDocs(client) {
  state.docs.clear();
  state.dirty.clear();
  const paths = [UI_PATH, ...PAGES.map((page) => page.path)];
  const results = await Promise.all(paths.map((path) => client.readJson(path)));
  paths.forEach((path, index) => state.docs.set(path, results[index]));
}

// 某一頁的所有章，第 0 項是開始之前（intro）。chapter 是資料中的章物件，修改標題時用
function sectionsOf(page) {
  const data = state.docs.get(page.path).data;
  return [
    { id: INTRO, number: 0, title: lookup('UI-25'), blocks: data.intro, chapter: null },
    ...data.chapters.map((chapter, index) => ({
      id: chapter.id, number: index + 1, title: chapter.title, blocks: chapter.blocks, chapter,
    })),
  ];
}

const sectionOf = (page, sectionId) => sectionsOf(page).find((section) => section.id === sectionId);
const sectionOfBlock = (page, block) => sectionsOf(page).find((section) => section.blocks.includes(block));

function findBlock(id) {
  const wanted = id.trim().toLowerCase();
  for (const page of PAGES) {
    for (const section of sectionsOf(page)) {
      const block = section.blocks.find((item) => String(item.id).toLowerCase() === wanted);
      if (block) return { page, block };
    }
  }
  return null;
}

// 編號不分大小寫，兩頁的區塊與章都不能重複
function idExists(id) {
  const wanted = id.toLowerCase();
  return PAGES.some((page) => sectionsOf(page).some((section) =>
    section.id.toLowerCase() === wanted || section.blocks.some((block) => String(block.id).toLowerCase() === wanted)));
}

function markDirty(path, id) {
  if (!state.dirty.has(path)) state.dirty.set(path, new Set());
  state.dirty.get(path).add(id);
}

export const dirtyFiles = () => state.dirty;

// 本月（YYYY-MM），新增截圖區塊時用
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- 左側清單 ----------

function blockButton(page, block) {
  const node = element('button', 'tree-block');
  node.type = 'button';
  node.dataset.id = block.id;
  const id = element('span', 'tree-id');
  id.textContent = block.id;
  const type = label(BLOCK_TYPES[block.type]?.name ?? 'AD-95', 'tree-type');
  const snippet = element('span', 'tree-excerpt');
  snippet.lang = 'zh-Hant-TW';
  node.append(id, type, snippet);
  updateBlockButton(node, page, block);
  node.addEventListener('click', () => select({ kind: 'block', page, block }));
  return node;
}

// 隱藏與已修改的標示
function updateBlockButton(node, page, block) {
  node.classList.toggle('is-hidden', isHidden(block));
  node.classList.toggle('is-dirty', state.dirty.get(page.path)?.has(block.id) ?? false);
  node.querySelector('.tree-excerpt').textContent = excerpt(block);
}

function buildTree() {
  const tree = element('div', 'tree');
  for (const page of PAGES) {
    const pageBox = element('details', 'tree-page');
    pageBox.open = true;
    const summary = element('summary', 'tree-page-title');
    summary.append(label(page.name));
    pageBox.append(summary);
    for (const section of sectionsOf(page)) {
      const sectionBox = element('details', 'tree-section');
      sectionBox.dataset.page = page.key;
      sectionBox.dataset.section = section.id;
      const head = element('summary', 'tree-section-title');
      const num = element('span', 'tree-num');
      num.textContent = String(section.number);
      head.append(num, appendBilingual(element('span'), section.title));
      const list = element('div', 'tree-blocks');
      // 每章的第一項是「本章設定」：修改章標題、在章的最後新增區塊
      const settings = button('tree-settings', label('AD-108'), () => select({ kind: 'section', page, sectionId: section.id }));
      settings.dataset.section = section.id;
      list.append(settings);
      for (const block of section.blocks) list.append(blockButton(page, block));
      sectionBox.append(head, list);
      pageBox.append(sectionBox);
    }
    tree.append(pageBox);
  }
  return tree;
}

// 結構改變（新增、刪除、移動）後重建清單，保留展開的章與捲動位置
function refreshTree() {
  const { nav, tree } = state.nodes;
  const open = new Set([...tree.querySelectorAll('details.tree-section[open]')].map((node) => `${node.dataset.page}/${node.dataset.section}`));
  const scroll = nav.scrollTop;
  const next = buildTree();
  for (const node of next.querySelectorAll('details.tree-section')) {
    node.open = open.has(`${node.dataset.page}/${node.dataset.section}`);
  }
  tree.replaceWith(next);
  state.nodes.tree = next;
  nav.scrollTop = scroll;
  markCurrent();
}

// 清單中標示目前選擇的項目，並展開所在的章
function markCurrent() {
  const current = state.selected;
  for (const node of state.nodes.tree.querySelectorAll('.tree-block, .tree-settings')) {
    const pageKey = node.closest('.tree-section').dataset.page;
    let active = false;
    if (current && pageKey === current.page.key) {
      active = current.kind === 'block'
        ? node.classList.contains('tree-block') && node.dataset.id === current.block.id
        : node.classList.contains('tree-settings') && node.dataset.section === current.sectionId;
    }
    if (active) {
      node.setAttribute('aria-current', 'true');
      node.closest('details.tree-section').open = true;
      node.scrollIntoView({ block: 'nearest' });
    } else {
      node.removeAttribute('aria-current');
    }
  }
}

function buildSearch() {
  const form = element('form', 'tree-search');
  form.noValidate = true;
  const field = element('label', 'tree-search-field');
  const input = element('input', 'text-input');
  input.type = 'search';
  input.placeholder = 'S3-62';
  input.spellcheck = false;
  input.autocomplete = 'off';
  field.append(label('AD-47', 'field-label'), input);
  const message = element('div', 'tree-search-message');
  message.setAttribute('role', 'status');
  form.append(field, message);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    message.replaceChildren();
    const value = input.value.trim();
    if (!value) return;
    const found = findBlock(value);
    if (!found) {
      appendBilingual(message, fill(lookup('AD-48'), { id: value }));
      return;
    }
    select({ kind: 'block', ...found });
    // 搜尋後焦點移到表單第一個輸入框，可以直接開始修改
    state.nodes.main.querySelector('.block-form :is(textarea, input, select)')?.focus();
  });
  return form;
}

// ---------- 編輯區 ----------

let refreshTimer = 0;

function select(selection) {
  state.selected = selection;
  markCurrent();
  renderEditor();
}

function renderEditor() {
  const { main } = state.nodes;
  main.replaceChildren();
  const current = state.selected;
  if (!current) main.append(label('AD-51', 'editor-empty', 'p'));
  else if (current.kind === 'section') renderSection(current);
  else renderBlockEditor(current);
}

// 重新建立編輯區後，捲動位置不變
function rerender() {
  const scroll = window.scrollY;
  renderEditor();
  window.scrollTo({ top: scroll, behavior: 'instant' });
}

// ---------- 區塊 ----------

function renderBlockEditor({ page, block }) {
  const { main } = state.nodes;
  const section = sectionOfBlock(page, block);

  const head = element('div', 'editor-head');
  const title = element('h2', 'editor-title');
  const id = element('span', 'editor-id');
  id.textContent = block.id;
  title.append(id, label(BLOCK_TYPES[block.type]?.name ?? 'AD-95', 'editor-type'));
  head.append(title);
  if (isHidden(block)) head.append(label('AD-55', 'badge'));
  head.append(blockActions(page, section, block));

  const ctx = {
    label,
    attr,
    onChange: () => {
      markDirty(page.path, block.id);
      updateSelectedButton();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshResults, REFRESH_MS);
    },
    rerender,
  };

  const checkBox = element('section', 'editor-check');
  checkBox.append(label('AD-53', 'editor-section-title', 'h3'), element('div', 'check-list'));
  const previewBox = element('section', 'editor-preview');
  previewBox.append(label('AD-52', 'editor-section-title', 'h3'), element('div', 'preview-body'));
  const addBox = addForm(page, section, block, 'AD-110');

  main.append(head, buildBlockForm(block, ctx), checkBox, previewBox, addBox);
  refreshResults();
}

// 隱藏、上移、下移、刪除
function blockActions(page, section, block) {
  const actions = element('div', 'editor-actions');
  const list = section.blocks;
  const index = list.indexOf(block);
  const changed = () => {
    markDirty(page.path, block.id);
    refreshTree();
    rerender();
  };

  actions.append(button('admin-button admin-button-quiet', label(isHidden(block) ? 'AD-98' : 'AD-97'), () => {
    // 顯示時直接刪掉欄位，JSON 保持乾淨
    if (isHidden(block)) delete block.hidden;
    else block.hidden = true;
    changed();
  }));

  for (const [symbol, labelId, step] of [['↑', 'AD-58', -1], ['↓', 'AD-59', 1]]) {
    const move = button('icon-button', symbol, () => {
      list.splice(index, 1);
      list.splice(index + step, 0, block);
      changed();
    });
    move.disabled = index + step < 0 || index + step >= list.length;
    move.title = attr(labelId);
    move.setAttribute('aria-label', attr(labelId));
    actions.append(move);
  }

  actions.append(button('admin-button admin-button-quiet is-danger', label('AD-99'), () => {
    // 確認視窗只能放一種語言，依目前的語言模式
    if (!window.confirm(attributeText(fill(lookup('AD-100'), { id: block.id })))) return;
    list.splice(index, 1);
    markDirty(page.path, block.id);
    // 刪除後回到所在章的設定畫面，並顯示已刪除
    state.selected = { kind: 'section', page, sectionId: section.id, notice: fill(lookup('AD-113'), { id: block.id }) };
    refreshTree();
    renderEditor();
  }));
  return actions;
}

function updateSelectedButton() {
  const { page, block } = state.selected;
  const node = state.nodes.tree.querySelector(`.tree-section[data-page="${page.key}"] .tree-block[data-id="${CSS.escape(block.id)}"]`);
  if (node) updateBlockButton(node, page, block);
}

// 檢查與預覽。檢查用的規則與 check.html 相同
async function refreshResults() {
  const current = state.selected;
  if (current?.kind !== 'block') return;
  const { page, block } = current;
  const { main } = state.nodes;

  const files = [];
  const issues = checkBlock(block, { file: page.path, page: page.key, files });
  const list = main.querySelector('.check-list');
  showIssues(list, issues);
  showPreview(main.querySelector('.preview-body'), page, block);

  // 檔案是否存在要連線確認，結果晚一點才加上
  const missing = await checkFiles(files);
  if (missing.length > 0 && state.selected?.block === block) showIssues(list, [...issues, ...missing]);
}

function showIssues(list, issues) {
  list.replaceChildren();
  if (issues.length === 0) {
    list.append(label('AD-54', 'check-ok', 'p'));
    return;
  }
  const ul = element('ul', 'check-issues');
  for (const issue of issues) {
    const item = element('li', issue.level === ERROR ? 'is-error' : 'is-notice');
    const level = appendBilingual(element('span', 'check-level'), LEVEL_TEXT[issue.level]);
    const field = element('code', 'check-field');
    field.textContent = issue.field;
    item.append(level, field, appendBilingual(element('span', 'check-message'), issue.message));
    ul.append(item);
  }
  list.append(ul);
}

// 預覽使用前台的 renderBlock，看到的就是上線後的樣子
function showPreview(preview, page, block) {
  preview.replaceChildren();
  if (isHidden(block)) preview.append(label('AD-94', 'preview-note', 'p'));
  const context = { strings: state.docs.get(UI_PATH).data.strings, page: page.key, pending: [] };
  const node = renderBlock(structuredClone(block), context);
  if (node) {
    node.removeAttribute('id'); // 預覽不需要錨點，也避免與頁面上的 id 重複
    preview.append(node);
  }
}

// ---------- 新增區塊 ----------

// after 為 null 時加在章的最後
function addForm(page, section, after, hintId) {
  const box = element('section', 'editor-add');
  box.append(label('AD-101', 'editor-section-title', 'h3'), label(hintId, 'editor-hint', 'p'));

  const form = element('form', 'add-form');
  form.noValidate = true;
  const typeField = element('label', 'add-field');
  const typeSelect = element('select', 'choice-input');
  for (const [type, info] of Object.entries(BLOCK_TYPES)) {
    // 連結區塊只能用在教師頁
    if (type === 'link' && page.key !== 'teacher') continue;
    const option = element('option');
    option.value = type;
    option.textContent = `${attr(info.name)}（${type}）`;
    typeSelect.append(option);
  }
  typeField.append(label('AD-102', 'field-label'), typeSelect);

  const idField = element('label', 'add-field');
  const idInput = element('input', 'text-input');
  idInput.type = 'text';
  idInput.spellcheck = false;
  idInput.autocomplete = 'off';
  idInput.placeholder = after ? `${after.id}-1` : '';
  idField.append(label('AD-103', 'field-label'), idInput);

  const submit = element('button', 'admin-button');
  submit.type = 'submit';
  submit.append(label('AD-104'));
  const message = element('div', 'add-message');
  message.setAttribute('role', 'alert');
  form.append(typeField, idField, submit, message);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    message.replaceChildren();
    const id = idInput.value.trim();
    let error = null;
    if (!id) error = lookup('AD-105');
    else if (!ID_PATTERN.test(id)) error = lookup('AD-106');
    else if (idExists(id)) error = fill(lookup('AD-107'), { id });
    if (error) {
      appendBilingual(message, error);
      idInput.focus();
      return;
    }
    const block = newBlock(typeSelect.value, id, thisMonth());
    const list = section.blocks;
    list.splice(after ? list.indexOf(after) + 1 : list.length, 0, block);
    markDirty(page.path, id);
    state.selected = { kind: 'block', page, block };
    refreshTree();
    renderEditor();
    state.nodes.main.querySelector('.block-form :is(textarea, input, select)')?.focus();
  });
  box.append(form);
  return box;
}

// ---------- 章 ----------

function renderSection({ page, sectionId, notice }) {
  const { main } = state.nodes;
  const section = sectionOf(page, sectionId);
  if (!section) {
    main.append(label('AD-51', 'editor-empty', 'p'));
    return;
  }
  const head = element('div', 'editor-head');
  const title = element('h2', 'editor-title');
  const num = element('span', 'editor-id');
  num.textContent = String(section.number);
  title.append(num, label('AD-108', 'editor-type'));
  head.append(title);
  main.append(head);
  if (notice) main.append(appendBilingual(element('p', 'editor-notice'), notice));

  if (section.chapter) {
    // 章標題用與區塊相同的中日並排欄位
    const ctx = {
      label,
      attr,
      onChange: () => {
        markDirty(page.path, section.id);
        // 清單中的章標題跟著更新
        const summary = state.nodes.tree.querySelector(`.tree-section[data-page="${page.key}"][data-section="${CSS.escape(section.id)}"] > summary > span:last-child`);
        if (summary) {
          summary.replaceChildren();
          appendBilingual(summary, section.chapter.title);
        }
      },
      rerender,
    };
    const form = buildBlockForm({ type: 'subheading', text: section.chapter.title }, ctx);
    form.querySelector('.field-label').replaceWith(label('AD-109', 'field-label'));
    main.append(form);
  } else {
    main.append(label('AD-112', 'editor-hint', 'p'));
  }
  main.append(addForm(page, section, null, 'AD-111'));
}

// ---------- 進入點 ----------

// container 是放編輯器的元素。text(id) 回傳後台文字
export function mountEditor(container, { text }) {
  state.text = text;
  const nav = element('nav', 'editor-nav');
  const tree = buildTree();
  nav.append(buildSearch(), tree);
  const main = element('div', 'editor-main');
  state.nodes = { nav, tree, main };
  state.selected = null;
  container.replaceChildren(nav, main);
  renderEditor();
}

// 切換語言時，屬性中的文字（按鈕說明、選項）要重新產生
document.addEventListener('htsg:langchange', () => {
  if (state.nodes && state.selected) renderEditor();
});

export function unmountEditor(container) {
  state.docs.clear();
  state.dirty.clear();
  state.selected = null;
  state.nodes = null;
  container.replaceChildren();
}
