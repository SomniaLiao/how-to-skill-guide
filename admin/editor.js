// 編輯器：左側清單、以編號搜尋、區塊表單、即時檢查與預覽（規格書 11.3、D-37）。

import { checkBlock, checkFiles, ERROR, LEVEL_TEXT } from '../assets/js/check.js';
import { appendBilingual, attributeText } from '../assets/js/i18n.js';
import { isHidden, renderBlock } from '../assets/js/render.js';
import { BLOCK_TYPES, buildBlockForm, excerpt } from './fields.js';

const PAGES = [
  { key: 'student', path: 'content/student.json', name: 'AD-49' },
  { key: 'teacher', path: 'content/teacher.json', name: 'AD-50' },
];
const UI_PATH = 'content/ui.json';
const REFRESH_MS = 200; // 輸入停下來後多久更新檢查與預覽

// docs：path → { data, sha }。dirty：path → 修改過的區塊編號
const state = { docs: new Map(), dirty: new Map(), selected: null, text: null, nodes: null };

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
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

// ---------- 資料 ----------

// 讀取兩頁的內容與介面文字。介面文字也是預覽需要的
export async function loadDocs(client) {
  state.docs.clear();
  state.dirty.clear();
  const paths = [UI_PATH, ...PAGES.map((page) => page.path)];
  const results = await Promise.all(paths.map((path) => client.readJson(path)));
  paths.forEach((path, index) => state.docs.set(path, results[index]));
}

// 某一頁的所有章，第 0 項是開始之前（intro）
function sectionsOf(page) {
  const data = state.docs.get(page.path).data;
  return [
    { id: 'intro', number: 0, title: lookup('UI-25'), blocks: data.intro },
    ...data.chapters.map((chapter, index) => ({ id: chapter.id, number: index + 1, title: chapter.title, blocks: chapter.blocks })),
  ];
}

function findBlock(id) {
  const wanted = id.trim().toLowerCase();
  for (const page of PAGES) {
    for (const section of sectionsOf(page)) {
      const block = section.blocks.find((item) => String(item.id).toLowerCase() === wanted);
      if (block) return { page, section, block };
    }
  }
  return null;
}

function markDirty(path, id) {
  if (!state.dirty.has(path)) state.dirty.set(path, new Set());
  state.dirty.get(path).add(id);
}

export const dirtyFiles = () => state.dirty;

// ---------- 左側清單 ----------

function blockButton(page, section, block) {
  const button = element('button', 'tree-block');
  button.type = 'button';
  button.dataset.id = block.id;
  const id = element('span', 'tree-id');
  id.textContent = block.id;
  const type = label(BLOCK_TYPES[block.type]?.name ?? 'AD-95', 'tree-type');
  const snippet = element('span', 'tree-excerpt');
  snippet.textContent = excerpt(block);
  snippet.lang = 'zh-Hant-TW';
  button.append(id, type, snippet);
  updateBlockButton(button, page, block);
  button.addEventListener('click', () => select(page, section, block));
  return button;
}

// 隱藏與已修改的標示
function updateBlockButton(button, page, block) {
  button.classList.toggle('is-hidden', isHidden(block));
  button.classList.toggle('is-dirty', state.dirty.get(page.path)?.has(block.id) ?? false);
  button.querySelector('.tree-excerpt').textContent = excerpt(block);
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
      for (const block of section.blocks) list.append(blockButton(page, section, block));
      sectionBox.append(head, list);
      pageBox.append(sectionBox);
    }
    tree.append(pageBox);
  }
  return tree;
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
    select(found.page, found.section, found.block);
    // 搜尋後焦點移到表單第一個輸入框，可以直接開始修改
    state.nodes.main.querySelector('textarea, input, select')?.focus();
  });
  return form;
}

function fill(textObject, values) {
  const apply = (value) => value.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  return { zh: apply(textObject.zh), ja: apply(textObject.ja) };
}

// ---------- 編輯區 ----------

let refreshTimer = 0;

function select(page, section, block) {
  state.selected = { page, section, block };
  // 清單中展開所在的章並標示目前的區塊
  for (const button of state.nodes.tree.querySelectorAll('.tree-block')) {
    const current = button.dataset.id === block.id && button.closest('.tree-section').dataset.page === page.key;
    if (current) {
      button.setAttribute('aria-current', 'true');
      button.closest('details.tree-section').open = true;
      button.scrollIntoView({ block: 'nearest' });
    } else {
      button.removeAttribute('aria-current');
    }
  }
  renderEditor();
}

function renderEditor() {
  const { main } = state.nodes;
  main.replaceChildren();
  if (!state.selected) {
    main.append(label('AD-51', 'editor-empty', 'p'));
    return;
  }
  const { page, block } = state.selected;
  const head = element('div', 'editor-head');
  const title = element('h2', 'editor-title');
  const id = element('span', 'editor-id');
  id.textContent = block.id;
  title.append(id, label(BLOCK_TYPES[block.type]?.name ?? 'AD-95', 'editor-type'));
  head.append(title);
  if (isHidden(block)) head.append(label('AD-55', 'badge'));

  const ctx = {
    label,
    attr,
    onChange: () => {
      markDirty(page.path, block.id);
      updateSelectedButton();
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshResults, REFRESH_MS);
    },
    // 新增、刪除、移動項目後重新建立表單，焦點留在編輯區
    rerender: () => {
      const scroll = window.scrollY;
      renderEditor();
      window.scrollTo({ top: scroll, behavior: 'instant' });
    },
  };

  const checkBox = element('section', 'editor-check');
  checkBox.append(label('AD-53', 'editor-section-title', 'h3'), element('div', 'check-list'));
  const previewBox = element('section', 'editor-preview');
  previewBox.append(label('AD-52', 'editor-section-title', 'h3'), element('div', 'preview-body'));

  main.append(head, buildBlockForm(block, ctx), checkBox, previewBox);
  refreshResults();
}

function updateSelectedButton() {
  const { page, block } = state.selected;
  const button = state.nodes.tree.querySelector(`.tree-section[data-page="${page.key}"] .tree-block[data-id="${CSS.escape(block.id)}"]`);
  if (button) updateBlockButton(button, page, block);
}

// 檢查與預覽。檢查用的規則與 check.html 相同
async function refreshResults() {
  if (!state.selected) return;
  const { page, block } = state.selected;
  const { main } = state.nodes;

  const files = [];
  const issues = checkBlock(block, { file: page.path, page: page.key, files });
  const list = main.querySelector('.check-list');
  const preview = main.querySelector('.preview-body');
  showIssues(list, issues);
  showPreview(preview, page, block);

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
