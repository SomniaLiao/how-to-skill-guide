// 截圖維護：編號整理與加框編輯器（規格書 11.4、D-37、D-40）。
// 加框編輯器在 dialog 中進行，確定後以 canvas 合成並輸出 webp 的位元組。

export const SHOT_DIR = 'assets/img/screenshots/';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_WIDTH = 1200;
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
const SHU = '#EB6101'; // 朱色，與 base.css 的 --color-shu 相同
const OUTLINE = 3; // 朱色框的線寬（輸出後的像素）

// ---------- 編號 ----------

// 檔名 SS-03.webp → SS-03。日語版 SS-03-ja.webp 歸在 SS-03 底下
const NAME_PATTERN = /^(SS-\d+)(-ja)?\.webp$/;

export function shotPath(id, ja = false) {
  return `${SHOT_DIR}${id}${ja ? '-ja' : ''}.webp`;
}

export function shotName(path) {
  return path.slice(SHOT_DIR.length).replace(/\.webp$/, '');
}

// 回傳 [{ id, path, jaPath }]，依編號排序
export function groupShots(paths) {
  const groups = new Map();
  for (const path of paths) {
    const match = path.startsWith(SHOT_DIR) ? path.slice(SHOT_DIR.length).match(NAME_PATTERN) : null;
    if (!match) continue;
    const group = groups.get(match[1]) ?? { id: match[1], path: null, jaPath: null };
    if (match[2]) group.jaPath = path;
    else group.path = path;
    groups.set(match[1], group);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

// 下一個編號：現有最大的編號加一，至少兩位數
export function nextShotId(paths) {
  const numbers = groupShots(paths).map((group) => Number(group.id.slice(3)));
  return `SS-${String(Math.max(0, ...numbers) + 1).padStart(2, '0')}`;
}

// ---------- 檔案檢查 ----------

// 回傳錯誤的文字編號，沒有問題時回傳 null
export function validateFile(file) {
  if (!ACCEPT.includes(file.type)) return 'AD-140';
  if (file.size > MAX_BYTES) return 'AD-141';
  return null;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

// ---------- 加框編輯器 ----------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ctx：{ label(id, className, tag), attr(id) }。
// 確定時回傳 webp 的位元組，取消時回傳 null。無法讀取或輸出時丟出 Error，message 為文字編號
export async function editImage(file, ctx) {
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    throw new Error('AD-142');
  }
  const { image, url } = loaded;
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  // 框的位置與大小以原圖的像素記錄，顯示時換算成百分比，畫面縮放也不會跑掉
  const boxes = [];
  let selected = null;
  let tool = null;

  const dialog = element('dialog', 'shot-dialog');
  const toolbar = element('div', 'shot-toolbar');
  const stage = element('div', 'shot-stage');
  const picture = element('img', 'shot-source');
  picture.src = url;
  picture.alt = '';
  picture.draggable = false;
  stage.append(picture);

  const toolButtons = {};
  for (const [kind, labelId] of [['mask', 'AD-143'], ['mark', 'AD-144']]) {
    const button = element('button', `admin-button admin-button-quiet tool-${kind}`);
    button.type = 'button';
    button.append(ctx.label(labelId));
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => setTool(tool === kind ? null : kind));
    toolButtons[kind] = button;
    toolbar.append(button);
  }
  const removeButton = element('button', 'admin-button admin-button-quiet');
  removeButton.type = 'button';
  removeButton.append(ctx.label('AD-145'));
  removeButton.addEventListener('click', () => removeBox(selected));
  toolbar.append(removeButton);

  function setTool(kind) {
    tool = kind;
    for (const [name, button] of Object.entries(toolButtons)) button.setAttribute('aria-pressed', String(name === kind));
    stage.classList.toggle('is-drawing', Boolean(kind));
  }

  // 畫面上的座標換算成原圖的像素
  function toImage(event) {
    const rect = stage.getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height)),
    };
  }

  function place(box) {
    Object.assign(box.node.style, {
      left: `${(box.x / width) * 100}%`,
      top: `${(box.y / height) * 100}%`,
      width: `${(box.w / width) * 100}%`,
      height: `${(box.h / height) * 100}%`,
    });
  }

  function select(box) {
    selected = box;
    for (const item of boxes) item.node.classList.toggle('is-selected', item === box);
    removeButton.disabled = !box;
    box?.node.focus();
  }

  function removeBox(box) {
    if (!box) return;
    boxes.splice(boxes.indexOf(box), 1);
    box.node.remove();
    select(null);
  }

  function addBox(kind, x, y) {
    const node = element('div', `shot-box shot-box-${kind}`);
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', ctx.attr(kind === 'mask' ? 'AD-143' : 'AD-144'));
    const handle = element('span', 'shot-handle');
    node.append(handle);
    const box = { kind, x, y, w: 0, h: 0, node };
    boxes.push(box);
    stage.append(node);
    place(box);

    // 拖曳框本身是移動，拖曳右下角是調整大小
    node.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      select(box);
      const start = toImage(event);
      const origin = { ...box };
      const resizing = event.target === handle;
      drag(event, (point) => {
        if (resizing) {
          box.w = Math.max(4, Math.min(width - box.x, origin.w + point.x - start.x));
          box.h = Math.max(4, Math.min(height - box.y, origin.h + point.y - start.y));
        } else {
          box.x = Math.min(width - box.w, Math.max(0, origin.x + point.x - start.x));
          box.y = Math.min(height - box.h, Math.max(0, origin.y + point.y - start.y));
        }
        place(box);
      });
    });

    // 方向鍵移動（每次原圖寬度的 1%），Delete 刪除
    node.addEventListener('keydown', (event) => {
      const step = width / 100;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) {
        event.preventDefault();
        const [dx, dy] = moves[event.key];
        box.x = Math.min(width - box.w, Math.max(0, box.x + dx));
        box.y = Math.min(height - box.h, Math.max(0, box.y + dy));
        place(box);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeBox(box);
      }
    });
    return box;
  }

  // 按住滑鼠或手指移動時持續呼叫 onMove，放開後結束
  function drag(event, onMove, onEnd) {
    event.preventDefault();
    const target = event.currentTarget;
    // 拖曳到框外時仍持續收到事件。少數情況（例如觸控被取消）無法擷取，不影響操作
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // 忽略
    }
    const move = (moveEvent) => onMove(toImage(moveEvent));
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      onEnd?.();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  // 選了框的種類時，在圖片上拖曳畫出新框
  stage.addEventListener('pointerdown', (event) => {
    if (!tool) {
      select(null);
      return;
    }
    const start = toImage(event);
    const box = addBox(tool, start.x, start.y);
    drag(event, (point) => {
      box.x = Math.min(start.x, point.x);
      box.y = Math.min(start.y, point.y);
      box.w = Math.abs(point.x - start.x);
      box.h = Math.abs(point.y - start.y);
      place(box);
    }, () => {
      // 太小的框視為誤觸
      if (box.w < 4 || box.h < 4) removeBox(box);
      else select(box);
      setTool(null);
    });
  });

  // 確認清單：三項都勾選才能確定（規格書 11.4 第四項）
  const checklist = element('fieldset', 'shot-checklist');
  checklist.append(ctx.label('AD-150', '', 'legend'));
  const checks = ['AD-147', 'AD-148', 'AD-149'].map((id) => {
    const row = element('label', 'admin-check');
    const input = element('input');
    input.type = 'checkbox';
    row.append(input, ctx.label(id));
    checklist.append(row);
    return input;
  });

  const message = element('div', 'shot-message');
  message.setAttribute('role', 'alert');
  const actions = element('div', 'shot-actions');
  const confirm = element('button', 'admin-button');
  confirm.type = 'button';
  confirm.append(ctx.label('AD-151'));
  confirm.disabled = true;
  const cancel = element('button', 'admin-button admin-button-quiet');
  cancel.type = 'button';
  cancel.append(ctx.label('AD-152'));
  actions.append(confirm, cancel);
  checks.forEach((input) => input.addEventListener('change', () => {
    confirm.disabled = !checks.every((item) => item.checked);
  }));

  dialog.append(toolbar, ctx.label('AD-146', 'editor-hint', 'p'), stage, checklist, message, actions);
  document.body.append(dialog);
  removeButton.disabled = true;

  return new Promise((resolve) => {
    const finish = (result) => {
      dialog.close();
      dialog.remove();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    cancel.addEventListener('click', () => finish(null));
    // Esc 關閉 dialog 時也視為取消
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        finish(await exportWebp(image, boxes));
      } catch (error) {
        message.replaceChildren(ctx.label(error.message, 'editor-error', 'p'));
        confirm.disabled = false;
      }
    });
    dialog.showModal();
  });
}

// 合成圖片與框，輸出 webp。重新繪製後，原圖的拍攝資訊不會留下
async function exportWebp(image, boxes) {
  const scale = Math.min(1, MAX_WIDTH / image.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const box of boxes) {
    const [x, y, w, h] = [box.x, box.y, box.w, box.h].map((value) => value * scale);
    if (box.kind === 'mask') {
      context.fillStyle = '#000';
      context.fillRect(x, y, w, h);
    } else {
      // 線畫在框的內側，框的外緣就是使用者拉出的範圍
      context.strokeStyle = SHU;
      context.lineWidth = OUTLINE;
      context.strokeRect(x + OUTLINE / 2, y + OUTLINE / 2, w - OUTLINE, h - OUTLINE);
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  // 不支援 webp 的瀏覽器會改輸出 png，這時停止（D-40 第 1 項）
  if (!blob || blob.type !== 'image/webp') throw new Error('AD-153');
  return new Uint8Array(await blob.arrayBuffer());
}
