// 編輯器：左側清單、以編號搜尋、區塊表單、即時檢查與預覽（規格書 11.3、D-37）。
// 區塊的新增、刪除、移動、隱藏，以及章標題的修改（P2-3c）。

import { checkBlock, checkFiles, checkPage, checkUi, ERROR, LEVEL_TEXT } from '../assets/js/check.js';
import { appendBilingual, attributeText } from '../assets/js/i18n.js';
import { isHidden, renderBlock } from '../assets/js/render.js';
import { BLOCK_TYPES, buildBlockForm, excerpt, ID_PATTERN, newBlock } from './fields.js';
import { formatJson, today } from './github-api.js';
import { findUnsafe } from './safety.js';
import { buildZip, ZIP_SKILLS as ZIP_NAMES, zipPath } from './zip.js';
import { editImage, groupShots, nextShotId, SHOT_DIR, shotName, shotPath, validateFile } from './shots.js';

const PAGES = [
  { key: 'student', path: 'content/student.json', name: 'AD-49' },
  { key: 'teacher', path: 'content/teacher.json', name: 'AD-50' },
];
const UI_PATH = 'content/ui.json';
const TEMPLATE_DIR = 'templates/';
// 這兩個資料夾的範本會放進學生下載的 ZIP（規格書第 10 節）
const ZIP_SKILLS = ['templates/japanese-qa-practice/', 'templates/japanese-tts-grammar-coach/'];
const INTRO = 'intro';
const REFRESH_MS = 200; // 輸入停下來後多久更新檢查與預覽

// docs：path → { data, sha }（JSON）或 { text, sha }（範本，選到時才讀取）。
// dirty：path → 修改過的編號（區塊、章、介面文字編號，範本則是檔案路徑）。
// selected 的種類：block、section、ui、template
const state = {
  docs: new Map(), dirty: new Map(), templates: [], client: null, selected: null, text: null, nodes: null,
  // shotFiles：截圖路徑 → GitHub 上的 sha（新增的為 null）。assets：尚未儲存的圖片，路徑 → { bytes, url }
  shotFiles: new Map(), assets: new Map(),
};

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
  state.client = client;
  const paths = [UI_PATH, ...PAGES.map((page) => page.path)];
  const [templates, shots, ...results] = await Promise.all([
    client.listFiles(TEMPLATE_DIR),
    client.listEntries(SHOT_DIR),
    ...paths.map((path) => client.readJson(path)),
  ]);
  paths.forEach((path, index) => state.docs.set(path, results[index]));
  state.templates = templates;
  clearAssets();
  state.shotFiles = new Map(shots.map((item) => [item.path, item.sha]));
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
  updateSaveBar();
}

export const dirtyFiles = () => state.dirty;

// 本月（YYYY-MM），新增截圖區塊時用
function thisMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- 左側清單 ----------

// 清單中每個項目的識別字串，用來標示目前選擇的項目
function keyOf(selection) {
  switch (selection.kind) {
    case 'block': return `block:${selection.page.key}:${selection.block.id}`;
    case 'section': return `section:${selection.page.key}:${selection.sectionId}`;
    case 'ui': return `ui:${selection.id}`;
    case 'shot': return `shot:${selection.id}`;
    case 'shot-new': return 'shot-new';
    case 'zip': return 'zip';
    default: return `template:${selection.path}`;
  }
}

function blockButton(page, block) {
  const node = element('button', 'tree-block');
  node.type = 'button';
  node.dataset.id = block.id;
  node.dataset.key = keyOf({ kind: 'block', page, block });
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
      settings.dataset.key = keyOf({ kind: 'section', page, sectionId: section.id });
      list.append(settings);
      for (const block of section.blocks) list.append(blockButton(page, block));
      sectionBox.append(head, list);
      pageBox.append(sectionBox);
    }
    tree.append(pageBox);
  }
  tree.append(uiGroup(), templateGroup(), shotGroup());
  return tree;
}

// 介面文字：每個編號一項
function uiGroup() {
  const group = element('details', 'tree-page tree-group');
  group.dataset.group = 'ui';
  const summary = element('summary', 'tree-page-title');
  summary.append(label('AD-114'));
  const list = element('div', 'tree-blocks');
  for (const [id, words] of Object.entries(state.docs.get(UI_PATH).data.strings)) {
    const node = treeItem({ kind: 'ui', id }, id, words.zh);
    node.classList.toggle('is-dirty', state.dirty.get(UI_PATH)?.has(id) ?? false);
    list.append(node);
  }
  group.append(summary, list);
  return group;
}

// 範本檔案：以 templates/ 之後的路徑顯示
function templateGroup() {
  const group = element('details', 'tree-page tree-group');
  group.dataset.group = 'templates';
  const summary = element('summary', 'tree-page-title');
  summary.append(label('AD-72'));
  const list = element('div', 'tree-blocks');
  const zip = button('tree-settings', label('AD-156'), () => select({ kind: 'zip' }));
  zip.dataset.key = keyOf({ kind: 'zip' });
  list.append(zip);
  for (const path of state.templates) {
    const node = treeItem({ kind: 'template', path }, path.slice(TEMPLATE_DIR.length), '');
    node.classList.toggle('is-dirty', state.dirty.get(path)?.has(path) ?? false);
    list.append(node);
  }
  group.append(summary, list);
  return group;
}

function treeItem(selection, title, snippetText) {
  const node = element('button', 'tree-block');
  node.type = 'button';
  node.dataset.key = keyOf(selection);
  const id = element('span', 'tree-id');
  id.textContent = title;
  node.append(id);
  if (snippetText) {
    const snippet = element('span', 'tree-excerpt');
    snippet.lang = 'zh-Hant-TW';
    snippet.textContent = snippetText;
    node.append(snippet);
  }
  node.addEventListener('click', () => select(selection));
  return node;
}

// 結構改變（新增、刪除、移動）後重建清單，保留展開的章與捲動位置
function refreshTree() {
  const { nav, tree } = state.nodes;
  const keyOfDetails = (node) => node.dataset.group ?? `${node.dataset.page}/${node.dataset.section}`;
  const open = new Set([...tree.querySelectorAll('details.tree-section[open], details.tree-group[open]')].map(keyOfDetails));
  const scroll = nav.scrollTop;
  const next = buildTree();
  for (const node of next.querySelectorAll('details.tree-section, details.tree-group')) {
    node.open = open.has(keyOfDetails(node));
  }
  tree.replaceWith(next);
  state.nodes.tree = next;
  nav.scrollTop = scroll;
  markCurrent();
}

// 清單中標示目前選擇的項目，並展開所在的章
function markCurrent() {
  const key = state.selected ? keyOf(state.selected) : null;
  for (const node of state.nodes.tree.querySelectorAll('[data-key]')) {
    if (node.dataset.key === key) {
      node.setAttribute('aria-current', 'true');
      // 所在的每一層都展開，才看得到
      for (let box = node.closest('details'); box; box = box.parentElement.closest('details')) box.open = true;
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
  else if (current.kind === 'ui') renderUiEditor(current);
  else if (current.kind === 'template') renderTemplateEditor(current);
  else if (current.kind === 'shot') renderShot(current);
  else if (current.kind === 'shot-new') renderNewShot();
  else if (current.kind === 'zip') renderZip();
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
    shots: () => [...state.shotFiles.keys()].sort(),
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
  const node = state.nodes.tree.querySelector(`[data-key="${CSS.escape(keyOf(state.selected))}"]`);
  if (node) updateBlockButton(node, page, block);
}

// 介面文字與範本的已修改標示
function markTreeDirty(selection) {
  state.nodes.tree.querySelector(`[data-key="${CSS.escape(keyOf(selection))}"]`)?.classList.add('is-dirty');
}

function editorHead(titleText, typeLabelId) {
  const head = element('div', 'editor-head');
  const title = element('h2', 'editor-title');
  const id = element('span', 'editor-id');
  id.textContent = titleText;
  title.append(id, label(typeLabelId, 'editor-type'));
  head.append(title);
  return head;
}

// ---------- 介面文字 ----------

function renderUiEditor(selection) {
  const { main } = state.nodes;
  const strings = state.docs.get(UI_PATH).data.strings;
  const text = strings[selection.id];
  const checkBox = element('section', 'editor-check');
  checkBox.append(label('AD-53', 'editor-section-title', 'h3'), element('div', 'check-list'));
  const refresh = () => showIssues(checkBox.querySelector('.check-list'), checkUi({ strings: { [selection.id]: text } }, UI_PATH));

  const ctx = {
    label,
    attr,
    onChange: () => {
      markDirty(UI_PATH, selection.id);
      markTreeDirty(selection);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, REFRESH_MS);
    },
    rerender,
  };
  // 與區塊共用中日並排的欄位
  const form = buildBlockForm({ type: 'subheading', text }, ctx);
  main.append(editorHead(selection.id, 'AD-114'), label('AD-115', 'editor-hint', 'p'), form, checkBox);
  refresh();
}

// ---------- 範本 ----------

async function renderTemplateEditor(selection) {
  const { main } = state.nodes;
  const { path } = selection;
  main.append(editorHead(path.slice(TEMPLATE_DIR.length), 'AD-72'));

  // 範本選到時才讀取，讀過就留在記憶體中
  if (!state.docs.has(path)) {
    const loading = label('AD-117', 'editor-hint', 'p');
    main.append(loading);
    try {
      state.docs.set(path, await state.client.readText(path));
    } catch (error) {
      loading.remove();
      main.append(appendBilingual(element('p', 'editor-error'), state.describe(error)));
      return;
    }
    // 讀取期間使用者可能已選了別的項目
    if (state.selected !== selection) return;
    loading.remove();
  }

  const doc = state.docs.get(path);
  main.append(label('AD-116', 'editor-hint', 'p'));
  if (ZIP_SKILLS.some((prefix) => path.startsWith(prefix))) main.append(label('AD-118', 'editor-notice', 'p'));

  const field = element('label', 'field');
  field.append(label('AD-119', 'field-label'));
  const input = element('textarea', 'template-input');
  input.value = doc.text;
  input.rows = 24;
  input.spellcheck = false;
  // 範本多為日文，用日文字形顯示
  input.lang = 'ja';
  field.append(input);

  // 範本不做文字規則檢查，只做儲存前的安全檢查，先在這裡提示
  const warning = element('div', 'check-list');
  const refresh = () => {
    warning.replaceChildren();
    const unsafe = findUnsafe(doc.text);
    if (unsafe) {
      const id = { email: 'AD-33', token: 'AD-34', key: 'AD-35' }[unsafe];
      warning.append(label(id, 'editor-error', 'p'));
    }
  };
  input.addEventListener('input', () => {
    doc.text = input.value;
    markDirty(path, path);
    markTreeDirty(selection);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, REFRESH_MS);
  });
  main.append(field, warning);
  refresh();
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
    // 尚未儲存的截圖，改用記憶體中的圖片預覽
    for (const image of node.querySelectorAll('img')) {
      const pending = state.assets.get(image.getAttribute('src'));
      if (pending) image.src = pending.url;
    }
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

// ---------- 截圖（規格書 11.4、D-37、D-40） ----------

function clearAssets() {
  for (const asset of state.assets.values()) URL.revokeObjectURL(asset.url);
  state.assets.clear();
}

const shotGroups = () => groupShots([...state.shotFiles.keys()]);

// 使用某個截圖檔的區塊
function blocksUsing(path) {
  const found = [];
  for (const page of PAGES) {
    for (const section of sectionsOf(page)) {
      for (const block of section.blocks) {
        if (block.type === 'figure' && (block.src === path || block.src_ja === path)) found.push({ page, block });
      }
    }
  }
  return found;
}

function shotGroup() {
  const group = element('details', 'tree-page tree-group');
  group.dataset.group = 'shots';
  const summary = element('summary', 'tree-page-title');
  summary.append(label('AD-87'));
  const list = element('div', 'tree-blocks');
  const add = button('tree-settings', label('AD-138'), () => select({ kind: 'shot-new' }));
  add.dataset.key = keyOf({ kind: 'shot-new' });
  list.append(add);
  for (const shot of shotGroups()) {
    const node = treeItem({ kind: 'shot', id: shot.id }, shot.id, shot.jaPath ? attr('AD-133') : '');
    const pending = [shot.path, shot.jaPath].some((path) => path && state.assets.has(path));
    node.classList.toggle('is-dirty', pending);
    list.append(node);
  }
  group.append(summary, list);
  return group;
}

// 圖片的顯示：尚未儲存的用記憶體中的圖片，其他用網站上的檔案
function shotFigure(path, captionId) {
  const figure = element('figure', 'shot-preview');
  const image = element('img');
  image.alt = '';
  image.src = state.assets.get(path)?.url ?? path;
  const caption = element('figcaption');
  const name = element('code');
  name.textContent = shotName(path);
  caption.append(name);
  if (captionId) caption.append(label(captionId));
  if (state.assets.has(path)) caption.append(label('AD-135', 'badge'));
  figure.append(image, caption);
  return figure;
}

function renderShot({ id }) {
  const { main } = state.nodes;
  const shot = shotGroups().find((item) => item.id === id);
  main.append(editorHead(id, 'AD-87'));
  if (!shot) return;

  // 使用這張截圖的區塊，點選可以跳過去
  // 同一個區塊可能同時使用中文版與日語版，只列一次
  const users = [...new Map([shot.path, shot.jaPath].filter(Boolean).flatMap(blocksUsing)
    .map((item) => [item.block, item])).values()];
  const usage = element('div', 'shot-usage');
  if (users.length === 0) {
    usage.append(label('AD-132', 'editor-hint', 'p'));
  } else {
    usage.append(appendBilingual(element('p', 'editor-hint'), fill(lookup('AD-131'), { ids: users.map((item) => item.block.id).join('、') })));
    const date = element('p', 'editor-hint');
    date.append(label('UI-24'));
    date.append(` ${users[0].block.date ?? ''}`);
    usage.append(date);
    const jumps = element('div', 'shot-jumps');
    for (const { page, block } of users) {
      jumps.append(button('admin-button admin-button-quiet', block.id, () => select({ kind: 'block', page, block })));
    }
    usage.append(jumps);
  }
  main.append(usage);

  const message = element('div', 'save-message');
  message.setAttribute('role', 'status');
  const variants = element('div', 'shot-variants');
  if (shot.path) variants.append(shotVariant(shot.path, null, 'AD-136', message));
  variants.append(shot.jaPath
    ? shotVariant(shot.jaPath, 'AD-133', 'AD-136', message)
    : shotUpload(shotPath(id, true), 'AD-137', message));
  main.append(variants, message);
}

function shotVariant(path, captionId, buttonId, message) {
  const box = element('div', 'shot-variant');
  box.append(shotFigure(path, captionId), shotUpload(path, buttonId, message));
  return box;
}

// 選擇圖片檔的按鈕。選好後開啟加框編輯器，確定後加入未儲存的修改
function shotUpload(path, buttonId, message, onQueued) {
  const wrap = element('div', 'shot-upload');
  const input = element('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.hidden = true;
  const trigger = button('admin-button admin-button-quiet', label(buttonId), () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // 同一個檔案再選一次也會觸發
    if (!file) return;
    message.replaceChildren();
    const invalid = validateFile(file);
    if (invalid) {
      message.append(label(invalid, 'editor-error', 'p'));
      return;
    }
    let bytes;
    try {
      bytes = await editImage(file, { label, attr });
    } catch (error) {
      message.append(label(error.message, 'editor-error', 'p'));
      return;
    }
    if (!bytes) return; // 取消
    queueAsset(path, bytes);
    onQueued?.();
    refreshTree();
    rerender();
    state.nodes.main.querySelector('.save-message')?.append(label('AD-154', 'editor-notice', 'p'));
  });
  wrap.append(trigger, input);
  return wrap;
}

// 加入未儲存的圖片，並把使用它的區塊的日期改成本月（規格書 11.4 第六項）
function queueAsset(path, bytes) {
  const old = state.assets.get(path);
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
  state.assets.set(path, { bytes, url });
  if (!state.shotFiles.has(path)) state.shotFiles.set(path, null);
  markDirty(path, shotName(path));
  for (const { page, block } of blocksUsing(path)) {
    block.date = thisMonth();
    markDirty(page.path, block.id);
  }
}

function renderNewShot() {
  const { main } = state.nodes;
  const id = nextShotId([...state.shotFiles.keys()]);
  main.append(editorHead(id, 'AD-138'));
  main.append(appendBilingual(element('p', 'editor-hint'), fill(lookup('AD-155'), { id })));
  const message = element('div', 'save-message');
  message.setAttribute('role', 'status');
  // 加入後跳到新截圖的畫面
  main.append(shotUpload(shotPath(id), 'AD-139', message, () => { state.selected = { kind: 'shot', id }; }), message);
}

// ---------- 下載用 ZIP ----------

// ZIP 用的範本有未儲存的修改時不能產生，否則 ZIP 會是舊的內容
const zipTemplatesDirty = () => [...state.dirty.keys()].some((path) => ZIP_SKILLS.some((prefix) => path.startsWith(prefix)));

function renderZip() {
  const { main } = state.nodes;
  main.append(editorHead('ZIP', 'AD-156'), label('AD-157', 'editor-hint', 'p'));
  const result = element('div', 'zip-result');
  result.setAttribute('role', 'status');
  const run = button('admin-button', label('AD-158'), () => regenerateZips(run, result));
  if (zipTemplatesDirty()) {
    run.disabled = true;
    main.append(label('AD-161', 'editor-error', 'p'));
  }
  main.append(run, result);
}

// 兩個 ZIP 各一筆提交。覆蓋時附上 GitHub 上的 sha
async function regenerateZips(trigger, result) {
  if (zipTemplatesDirty()) {
    result.replaceChildren(label('AD-161', 'editor-error', 'p'));
    return;
  }
  trigger.disabled = true;
  result.replaceChildren(label('AD-159', 'editor-hint', 'p'));
  try {
    const current = new Map((await state.client.listEntries('downloads/')).map((item) => [item.path, item.sha]));
    const lists = [];
    for (const skill of ZIP_NAMES) {
      const { bytes, names } = await buildZip(state.client, skill);
      await state.client.writeFile(zipPath(skill), { bytes }, { sha: current.get(zipPath(skill)), message: 'download: 重新產生 ZIP' });
      lists.push([skill, names]);
    }
    result.replaceChildren(appendBilingual(element('p', 'check-ok'), fill(lookup('AD-160'), { count: String(lists.length) })));
    // 列出 ZIP 的內容，確認沒有多餘的檔案
    const detail = element('div', 'zip-list');
    detail.append(label('AD-162', 'field-label'));
    for (const [skill, names] of lists) {
      const list = element('ul');
      for (const name of names) {
        const item = element('li');
        const code = element('code');
        code.textContent = name;
        item.append(code);
        list.append(item);
      }
      const title = element('p');
      title.textContent = zipPath(skill);
      detail.append(title, list);
    }
    result.append(detail);
  } catch (error) {
    result.replaceChildren(appendBilingual(element('p', 'editor-error'), state.describe(error)));
  } finally {
    trigger.disabled = false;
  }
}

// ---------- 儲存（D-37 第 9 項、D-39） ----------

export const hasUnsaved = () => state.dirty.size > 0;

function buildSaveBar() {
  const bar = element('div', 'save-bar');
  const count = element('p', 'save-count');
  const saveButton = button('admin-button', label('AD-121'), save);
  const message = element('div', 'save-message');
  message.setAttribute('role', 'status');
  bar.append(count, saveButton, message);
  return bar;
}

function updateSaveBar() {
  if (!state.nodes) return;
  const bar = state.nodes.saveBar;
  const count = bar.querySelector('.save-count');
  count.replaceChildren();
  if (state.dirty.size > 0) appendBilingual(count, fill(lookup('AD-120'), { count: String(state.dirty.size) }));
  else appendBilingual(count, lookup('AD-130'));
  bar.classList.toggle('has-changes', state.dirty.size > 0);
  bar.querySelector('.admin-button').disabled = state.dirty.size === 0 || state.saving;
}

function saveMessage(...parts) {
  const message = state.nodes.saveBar.querySelector('.save-message');
  message.replaceChildren(...parts);
  return message;
}

// 提交訊息依規格書 11.2 的格式，列出這次修改的編號
function commitMessage(path) {
  if (state.assets.has(path)) return `asset: ${state.shotFiles.get(path) ? '更新' : '新增'} ${shotName(path)}`;
  if (path.startsWith(TEMPLATE_DIR)) return `template: 更新 ${path.slice(TEMPLATE_DIR.length)}`;
  return `content: 更新 ${[...state.dirty.get(path)].join('、')}`;
}

// 某個檔案要寫入的文字。JSON 先把 updated 改成今天（D-37 第 7 項）
function contentOf(path) {
  const doc = state.docs.get(path);
  if (doc.text !== undefined) return doc.text;
  doc.data.updated = today();
  return formatJson(doc.data);
}

// 儲存前檢查整個檔案。回傳錯誤（只有提醒時可以儲存）
function checkBeforeSave(path) {
  if (state.assets.has(path)) return []; // 圖片在加框時已確認過
  const doc = state.docs.get(path);
  if (path === UI_PATH) return checkUi(doc.data, path).filter((issue) => issue.level === ERROR);
  const page = PAGES.find((item) => item.path === path);
  if (page) return checkPage(doc.data, path).filter((issue) => issue.level === ERROR);
  return []; // 範本不做文字規則檢查
}

async function save() {
  if (state.saving || state.dirty.size === 0) return;
  // 先寫圖片，再寫更新了日期的 JSON（D-40 第 2 項）
  const paths = [...state.dirty.keys()].sort((a, b) => Number(!state.assets.has(a)) - Number(!state.assets.has(b)));

  // 一、先檢查所有檔案。只要有一個錯誤就全部不儲存，避免只存了一半
  const errors = paths.flatMap(checkBeforeSave);
  const unsafe = paths.filter((path) => !state.assets.has(path)).map((path) => [path, findUnsafe(contentOfPreview(path))]).find(([, kind]) => kind);
  if (errors.length > 0) {
    const list = element('div');
    showIssues(list, errors.map((issue) => ({ ...issue, field: `${issue.id} ${issue.field}` })));
    saveMessage(label('AD-124', 'editor-error', 'p'), list);
    return;
  }
  if (unsafe) {
    const id = { email: 'AD-33', token: 'AD-34', key: 'AD-35' }[unsafe[1]];
    saveMessage(appendBilingual(element('p', 'editor-error'), fill(lookup('AD-129'), { path: unsafe[0] })), label(id, 'editor-error', 'p'));
    return;
  }

  // 二、逐一寫入。每個檔案一筆提交（D-39 第 2 項）
  state.saving = true;
  updateSaveBar();
  saveMessage(label('AD-122', 'editor-hint', 'p'));
  let saved = 0;
  for (const path of paths) {
    try {
      if (state.assets.has(path)) {
        // 圖片：覆蓋時附上 GitHub 上的 sha，新增時不附
        const asset = state.assets.get(path);
        const result = await state.client.writeFile(path, { bytes: asset.bytes }, { sha: state.shotFiles.get(path) ?? undefined, message: commitMessage(path) });
        state.shotFiles.set(path, result.sha);
        URL.revokeObjectURL(asset.url);
        state.assets.delete(path);
        state.dirty.delete(path);
        saved += 1;
        continue;
      }
      const doc = state.docs.get(path);
      const result = await state.client.writeFile(path, { text: contentOf(path) }, { sha: doc.sha, message: commitMessage(path) });
      doc.sha = result.sha; // 下次儲存要用新的版本
      state.dirty.delete(path);
      saved += 1;
    } catch (error) {
      state.saving = false;
      showSaveError(path, error);
      refreshTree();
      updateSaveBar();
      return;
    }
  }
  state.saving = false;
  refreshTree();
  updateSaveBar();
  const notes = [appendBilingual(element('p', 'check-ok'), fill(lookup('AD-123'), { count: String(saved) }))];
  if (paths.some((path) => ZIP_SKILLS.some((prefix) => path.startsWith(prefix)))) {
    // 範本儲存後提示是否重新產生 ZIP（規格書 11.5 第三項）
    const result = element('div');
    notes.push(label('AD-118', 'editor-notice', 'p'), button('admin-button', label('AD-158'), (event) => regenerateZips(event.currentTarget, result)), result);
  }
  saveMessage(...notes);
}

// 檢查安全用的文字，不改動 updated
function contentOfPreview(path) {
  const doc = state.docs.get(path);
  return doc.text ?? formatJson(doc.data);
}

// 儲存失敗。衝突時列出這個檔案中未儲存的項目，並提供重新載入（D-39 第 3 項）
function showSaveError(path, error) {
  const parts = [
    appendBilingual(element('p', 'editor-error'), fill(lookup('AD-129'), { path })),
    appendBilingual(element('p', 'editor-error'), state.describe(error)),
  ];
  if (error.kind === 'conflict') {
    const ids = [...(state.dirty.get(path) ?? [])].join('、');
    parts.push(appendBilingual(element('p', 'save-ids'), fill(lookup('AD-125'), { ids })));
    parts.push(button('admin-button admin-button-quiet', label('AD-126'), () => reloadFile(path)));
  }
  saveMessage(...parts);
}

// 重新讀取一個檔案，放棄其中未儲存的修改
async function reloadFile(path) {
  if (!window.confirm(attr('AD-127'))) return;
  // 圖片沒有內容可以重新讀取，直接放棄尚未儲存的圖片
  if (state.assets.has(path)) {
    URL.revokeObjectURL(state.assets.get(path).url);
    state.assets.delete(path);
    if (state.shotFiles.get(path) === null) state.shotFiles.delete(path);
    state.dirty.delete(path);
    state.selected = null;
    refreshTree();
    renderEditor();
    updateSaveBar();
    saveMessage();
    return;
  }
  try {
    const fresh = path.startsWith(TEMPLATE_DIR) ? await state.client.readText(path) : await state.client.readJson(path);
    state.docs.set(path, fresh);
  } catch (error) {
    saveMessage(appendBilingual(element('p', 'editor-error'), state.describe(error)));
    return;
  }
  state.dirty.delete(path);
  // 正在編輯的區塊可能已不存在，回到未選擇的狀態
  state.selected = null;
  refreshTree();
  renderEditor();
  updateSaveBar();
  saveMessage();
}

// ---------- 進入點 ----------

// container 是放編輯器的元素。text(id) 回傳後台文字，errorText(error) 回傳錯誤的雙語說明
export function mountEditor(container, { text, errorText }) {
  state.text = text;
  state.describe = errorText;
  const nav = element('nav', 'editor-nav');
  const tree = buildTree();
  // 儲存列放在左欄最上方，左欄固定不捲動，隨時看得到
  const saveBar = buildSaveBar();
  nav.append(saveBar, buildSearch(), tree);
  const main = element('div', 'editor-main');
  state.nodes = { nav, tree, main, saveBar };
  state.selected = null;
  state.saving = false;
  container.replaceChildren(nav, main);
  renderEditor();
  updateSaveBar();
}

// 切換語言時，屬性中的文字（按鈕說明、選項）要重新產生
document.addEventListener('htsg:langchange', () => {
  if (state.nodes && state.selected) renderEditor();
});

export function unmountEditor(container) {
  state.docs.clear();
  state.dirty.clear();
  clearAssets();
  state.selected = null;
  state.nodes = null;
  container.replaceChildren();
}
