// 複製按鈕，只在教師頁使用。

import { appendBilingual } from './i18n.js';

const DONE_DURATION = 2000;

function setLabel(button, text) {
  button.replaceChildren();
  appendBilingual(button, text);
}

// 瀏覽器不允許寫入剪貼簿時，改為選取文字，讀者可以自己按 Ctrl+C
function selectText(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

export function createCopyButton(codeNode, strings) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.setAttribute('aria-live', 'polite'); // 文字變成「已複製」時，螢幕報讀器會讀出來
  setLabel(button, strings['UI-08']);

  let timer = 0;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(codeNode.textContent);
    } catch (error) {
      console.warn('無法寫入剪貼簿，改為選取文字', error);
      selectText(codeNode);
      return;
    }
    setLabel(button, strings['UI-09']);
    button.classList.add('is-done');
    clearTimeout(timer); // 連按時從最後一次重新計時
    timer = setTimeout(() => {
      setLabel(button, strings['UI-08']);
      button.classList.remove('is-done');
    }, DONE_DURATION);
  });
  return button;
}
