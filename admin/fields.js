// 區塊的欄位定義與編輯表單（規格書 7.3、11.3）。
// 每種區塊有哪些欄位、用什麼方式編輯，都寫在 BLOCK_TYPES，表單依定義自動產生。
// 表單直接修改傳入的區塊物件，修改後呼叫 ctx.onChange()。

// 欄位的種類：
// bi：中日並排的文字。biList：中日並排的多個項目。text：單行文字（路徑、網址）。
// choice：從固定選項中選一個。objList：多個項目，每項有自己的欄位。table：表格
const bi = (key, label, extra = {}) => ({ kind: 'bi', key, label, ...extra });
const biList = (key, label) => ({ kind: 'biList', key, label });
const text = (key, label, extra = {}) => ({ kind: 'text', key, label, ...extra });

export const BLOCK_TYPES = {
  paragraph: { name: 'AD-80', fields: [bi('text', 'AD-61', { rows: 4 })] },
  subheading: { name: 'AD-81', fields: [bi('text', 'AD-61')] },
  list: { name: 'AD-82', fields: [biList('items', 'AD-63')] },
  steps: { name: 'AD-83', fields: [bi('label', 'AD-62', { optional: true }), biList('items', 'AD-63')] },
  note: {
    name: 'AD-84',
    fields: [
      { kind: 'choice', key: 'variant', label: 'AD-64', options: [['tip', 'UI-19'], ['warning', 'UI-18']] },
      bi('text', 'AD-61', { rows: 3 }),
    ],
  },
  flow: { name: 'AD-85', fields: [biList('items', 'AD-63')] },
  table: { name: 'AD-86', fields: [{ kind: 'table', key: 'rows', label: 'AD-66' }] },
  figure: {
    name: 'AD-87',
    fields: [
      text('src', 'AD-68'),
      text('src_ja', 'AD-69', { optional: true }),
      bi('alt', 'AD-70', { rows: 2 }),
      { kind: 'choice', key: 'device', label: 'AD-71', options: [['desktop', 'UI-20'], ['mobile', 'UI-21']] },
      text('date', 'UI-24', { placeholder: 'YYYY-MM' }),
    ],
  },
  code: { name: 'AD-88', fields: [text('file', 'AD-72'), bi('caption', 'AD-73')] },
  download: { name: 'AD-89', fields: [{ kind: 'objList', key: 'items', label: 'AD-63', fields: [text('file', 'AD-74'), bi('label', 'AD-75')] }] },
  sources: { name: 'AD-90', fields: [{ kind: 'objList', key: 'items', label: 'AD-63', fields: [text('url', 'AD-76'), bi('label', 'AD-75')] }] },
  faq: { name: 'AD-91', fields: [bi('q', 'AD-77', { rows: 2 }), bi('a', 'AD-78', { rows: 4 })] },
  link: { name: 'AD-92', fields: [text('href', 'AD-79'), bi('label', 'AD-75')] },
};

// 新的空白雙語文字
const emptyBi = () => ({ zh: '', ja: '' });

// ---------- 小工具 ----------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ctx 的格式：{ label(id) 回傳含雙語文字的元素, attr(id) 回傳屬性用的單一語言文字, onChange(), rerender() }

function fieldBox(ctx, labelId) {
  const box = element('div', 'field');
  box.append(ctx.label(labelId, 'field-label'));
  return box;
}

// 中日兩個輸入框並排。lang 屬性讓瀏覽器用正確的字形與輸入法提示
function biPair(ctx, value, onInput, rows = 1) {
  const pair = element('div', 'bi-pair');
  for (const [lang, code, name] of [['zh', 'zh-Hant-TW', '中文'], ['ja', 'ja', '日本語']]) {
    const input = element('textarea', 'bi-input');
    input.lang = code;
    input.rows = rows;
    input.value = value?.[lang] ?? '';
    input.spellcheck = false;
    input.setAttribute('aria-label', name);
    input.addEventListener('input', () => onInput(lang, input.value));
    const column = element('label', 'bi-column');
    const head = element('span', 'bi-head');
    head.textContent = name; // 語言名稱固定，與語言切換的選項相同
    column.append(head, input);
    pair.append(column);
  }
  return pair;
}

// 上移、下移、刪除的按鈕。符號按鈕另加說明文字給螢幕報讀器
function itemControls(ctx, list, index, { deleteLabel = 'AD-60', onMove, onDelete } = {}) {
  const controls = element('div', 'item-controls');
  const buttons = [
    ['↑', 'AD-58', index === 0, () => (onMove ?? move)(list, index, -1)],
    ['↓', 'AD-59', index === list.length - 1, () => (onMove ?? move)(list, index, 1)],
    ['✕', deleteLabel, false, () => (onDelete ?? remove)(list, index)],
  ];
  for (const [symbol, labelId, disabled, action] of buttons) {
    const button = element('button', 'icon-button');
    button.type = 'button';
    button.textContent = symbol;
    button.disabled = disabled;
    button.title = ctx.attr(labelId);
    button.setAttribute('aria-label', ctx.attr(labelId));
    button.addEventListener('click', () => {
      action();
      ctx.onChange();
      ctx.rerender();
    });
    controls.append(button);
  }
  return controls;
}

function move(list, index, step) {
  const [item] = list.splice(index, 1);
  list.splice(index + step, 0, item);
}

function remove(list, index) {
  list.splice(index, 1);
}

function addButton(ctx, labelId, action) {
  const button = element('button', 'admin-button admin-button-quiet add-button');
  button.type = 'button';
  button.append(ctx.label(labelId));
  button.addEventListener('click', () => {
    action();
    ctx.onChange();
    ctx.rerender();
  });
  return button;
}

// ---------- 各種欄位 ----------

const builders = {
  bi(field, target, ctx) {
    const box = fieldBox(ctx, field.label);
    box.append(biPair(ctx, target[field.key], (lang, value) => {
      if (!target[field.key]) target[field.key] = emptyBi();
      target[field.key][lang] = value;
      // 可省略的欄位兩種語言都空白時，直接刪掉，前台會改用預設文字
      if (field.optional && !target[field.key].zh && !target[field.key].ja) delete target[field.key];
      ctx.onChange();
    }, field.rows ?? 1));
    return box;
  },

  biList(field, target, ctx) {
    const box = fieldBox(ctx, field.label);
    if (!Array.isArray(target[field.key])) target[field.key] = [];
    const list = target[field.key];
    const items = element('ol', 'item-list');
    list.forEach((item, index) => {
      const row = element('li', 'item-row');
      row.append(biPair(ctx, item, (lang, value) => {
        item[lang] = value;
        ctx.onChange();
      }, 2), itemControls(ctx, list, index));
      items.append(row);
    });
    box.append(items, addButton(ctx, 'AD-57', () => list.push(emptyBi())));
    return box;
  },

  text(field, target, ctx) {
    const box = fieldBox(ctx, field.label);
    const input = element('input', 'text-input');
    input.type = 'text';
    input.value = target[field.key] ?? '';
    input.spellcheck = false;
    if (field.placeholder) input.placeholder = field.placeholder;
    input.addEventListener('input', () => {
      if (field.optional && input.value === '') delete target[field.key];
      else target[field.key] = input.value;
      ctx.onChange();
    });
    input.setAttribute('aria-label', ctx.attr(field.label));
    box.append(input);
    return box;
  },

  choice(field, target, ctx) {
    const box = fieldBox(ctx, field.label);
    const select = element('select', 'choice-input');
    select.setAttribute('aria-label', ctx.attr(field.label));
    const values = field.options.map(([value]) => value);
    // 資料中的值不在選項裡時，保留它並標示出來，不默默改掉
    if (!values.includes(target[field.key])) {
      const option = element('option');
      option.value = '';
      option.textContent = `${target[field.key] ?? ''} ${ctx.attr('AD-95')}`;
      select.append(option);
    }
    for (const [value, labelId] of field.options) {
      const option = element('option');
      option.value = value;
      option.textContent = `${ctx.attr(labelId)}（${value}）`;
      select.append(option);
    }
    select.value = values.includes(target[field.key]) ? target[field.key] : '';
    select.addEventListener('change', () => {
      if (select.value) target[field.key] = select.value;
      ctx.onChange();
    });
    box.append(select);
    return box;
  },

  objList(field, target, ctx) {
    const box = fieldBox(ctx, field.label);
    if (!Array.isArray(target[field.key])) target[field.key] = [];
    const list = target[field.key];
    const items = element('ol', 'item-list');
    list.forEach((item, index) => {
      const row = element('li', 'item-row item-row-stack');
      const inner = element('div', 'item-fields');
      for (const sub of field.fields) inner.append(builders[sub.kind](sub, item, ctx));
      row.append(inner, itemControls(ctx, list, index));
      items.append(row);
    });
    const blank = () => Object.fromEntries(field.fields.map((sub) => [sub.key, sub.kind === 'bi' ? emptyBi() : '']));
    box.append(items, addButton(ctx, 'AD-57', () => list.push(blank())));
    return box;
  },

  // 表格：欄位名稱與每一列的格子。增減欄位時，每一列的格子跟著增減
  table(field, block, ctx) {
    const wrap = element('div');
    if (!Array.isArray(block.columns)) block.columns = [];
    if (!Array.isArray(block.rows)) block.rows = [];
    const { columns, rows } = block;

    const columnBox = fieldBox(ctx, 'AD-65');
    const columnList = element('ol', 'item-list');
    columns.forEach((column, index) => {
      const row = element('li', 'item-row');
      row.append(biPair(ctx, column, (lang, value) => {
        column[lang] = value;
        ctx.onChange();
      }), itemControls(ctx, columns, index, {
        onMove: (list, at, step) => {
          move(list, at, step);
          rows.forEach((cells) => Array.isArray(cells) && move(cells, at, step));
        },
        onDelete: (list, at) => {
          remove(list, at);
          rows.forEach((cells) => Array.isArray(cells) && remove(cells, at));
        },
      }));
      columnList.append(row);
    });
    columnBox.append(columnList, addButton(ctx, 'AD-57', () => {
      columns.push(emptyBi());
      rows.forEach((cells) => Array.isArray(cells) && cells.push(emptyBi()));
    }));

    const rowBox = fieldBox(ctx, field.label);
    const rowList = element('ol', 'item-list');
    rows.forEach((cells, index) => {
      const row = element('li', 'item-row item-row-stack');
      const inner = element('div', 'item-fields');
      (Array.isArray(cells) ? cells : []).forEach((cell, at) => {
        const cellBox = element('div', 'field');
        const name = element('span', 'field-label field-label-small');
        name.textContent = columns[at]?.zh || String(at + 1);
        cellBox.append(name, biPair(ctx, cell, (lang, value) => {
          cell[lang] = value;
          ctx.onChange();
        }));
        inner.append(cellBox);
      });
      row.append(inner, itemControls(ctx, rows, index, { deleteLabel: 'AD-96' }));
      rowList.append(row);
    });
    rowBox.append(rowList, addButton(ctx, 'AD-67', () => rows.push(columns.map(() => emptyBi()))));

    wrap.append(columnBox, rowBox);
    return wrap;
  },
};

// 建立整個區塊的表單
export function buildBlockForm(block, ctx) {
  const form = element('div', 'block-form');
  const type = BLOCK_TYPES[block.type];
  if (!type) return form;
  for (const field of type.fields) form.append(builders[field.kind](field, block, ctx));
  return form;
}

// 新增區塊時的初始內容。文字都是空白，檢查會提示「缺少翻譯」直到填好為止
export function newBlock(type, id, month) {
  const base = { id, type };
  switch (type) {
    case 'list':
    case 'flow':
    case 'steps': return { ...base, items: [emptyBi()] };
    case 'note': return { ...base, variant: 'tip', text: emptyBi() };
    case 'table': return { ...base, columns: [emptyBi(), emptyBi()], rows: [[emptyBi(), emptyBi()]] };
    case 'figure': return { ...base, src: 'assets/img/screenshots/', alt: emptyBi(), device: 'desktop', date: month };
    case 'code': return { ...base, file: 'templates/', caption: emptyBi() };
    case 'download': return { ...base, items: [{ file: 'downloads/', label: emptyBi() }] };
    case 'sources': return { ...base, items: [{ url: 'https://', label: emptyBi() }] };
    case 'faq': return { ...base, q: emptyBi(), a: emptyBi() };
    case 'link': return { ...base, href: 'index.html', label: emptyBi() };
    default: return { ...base, text: emptyBi() }; // paragraph、subheading
  }
}

// 編號只能有英數與連字號，開頭必須是英數（D-37 第 1 項，例如 S3-62-1）
export const ID_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

// 區塊的第一段文字，清單中顯示開頭幾個字用
export function excerpt(block) {
  const source = block.text ?? block.label ?? block.q ?? block.caption ?? block.alt
    ?? block.items?.[0]?.label ?? block.items?.[0] ?? block.columns?.[0];
  const value = source?.zh ?? '';
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}
