// 左側欄：目錄的建立、收合、手機抽屜與目前位置標示（規格書 4.2 至 4.4）。

import { appendBilingual, attributeText } from './i18n.js';

const STORAGE_KEY = 'htsg.sidebar';
const DESKTOP = window.matchMedia('(min-width: 1024px)');
const MOBILE = window.matchMedia('(max-width: 767.98px)');

const root = document.documentElement;

// ---------- 小工具 ----------

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// 無痕模式或停用儲存時，localStorage 可能直接丟出錯誤
function readState() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed' ? 'collapsed' : 'expanded';
  } catch {
    return 'expanded';
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    // 存不了就不記住，不影響操作
  }
}

// ---------- 建立內容 ----------

function tocLink(id, text, number) {
  const link = element('a', 'toc-link');
  link.href = `#${id}`;
  link.dataset.target = id;
  if (number) {
    const num = element('span', 'toc-num');
    num.textContent = String(number);
    link.append(num);
  }
  link.append(appendBilingual(element('span'), text));
  return link;
}

function buildToc(chapters) {
  const toc = element('ol', 'toc');
  chapters.forEach((chapter, index) => {
    const item = element('li');
    item.append(tocLink(chapter.id, chapter.title, index + 1));
    if (chapter.sections.length > 0) {
      const sub = element('ol', 'toc-sub');
      for (const section of chapter.sections) {
        const subItem = element('li');
        subItem.append(tocLink(section.id, section.title));
        sub.append(subItem);
      }
      item.append(sub);
    }
    toc.append(item);
  });
  return toc;
}

function buildRail(chapters) {
  const rail = element('ol', 'rail-list');
  chapters.forEach((chapter, index) => {
    const item = element('li');
    const link = element('a', 'rail-link');
    link.href = `#${chapter.id}`;
    link.dataset.target = chapter.id;
    link.textContent = String(index + 1);
    item.append(link);
    rail.append(item);
  });
  return rail;
}

function buildSidebar(sidebar, { strings, chapters, page, langSwitch }) {
  const head = element('div', 'sidebar-head');
  const brand = element('div', 'sidebar-panel');
  brand.append(
    appendBilingual(element('div', 'sidebar-name'), strings['UI-01']),
    appendBilingual(element('div', 'sidebar-subtitle'), strings[page === 'teacher' ? 'UI-03' : 'UI-02']),
  );
  head.append(brand);

  const scroll = element('div', 'sidebar-scroll');
  const panel = element('div', 'sidebar-panel');

  const nav = element('nav');
  const navTitle = appendBilingual(element('div', 'toc-title'), strings['UI-06']);
  navTitle.id = 'toc-title';
  nav.setAttribute('aria-labelledby', navTitle.id);
  nav.append(navTitle, buildToc(chapters));
  panel.append(langSwitch, nav);

  if (page === 'teacher') {
    const foot = element('div', 'sidebar-foot');
    const link = element('a', 'toc-link');
    link.href = 'index.html';
    link.append(appendBilingual(element('span'), strings['UI-13']));
    foot.append(link);
    panel.append(foot);
  }

  const railNav = element('nav', 'rail');
  railNav.append(buildRail(chapters));
  scroll.append(panel, railNav);
  sidebar.replaceChildren(head, scroll);
  return { scroll, railNav };
}

// ---------- 進入點 ----------

// chapters 的格式：[{ id, title: { zh, ja }, sections: [{ id, title }] }]
// langSwitch 是 i18n.js 建立的語言切換元件
export function initSidebar({ strings, chapters, page, langSwitch }) {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  const main = document.getElementById('main');
  const skipLink = document.querySelector('.skip-link');
  const { scroll, railNav } = buildSidebar(sidebar, { strings, chapters, page, langSwitch });

  const isExpanded = () => root.dataset.sidebar === 'expanded';
  const isDrawerOpen = () => MOBILE.matches && isExpanded();

  function updateLabels() {
    toggle.setAttribute('aria-label', attributeText(strings[isExpanded() ? 'UI-23' : 'UI-22']));
    railNav.setAttribute('aria-label', attributeText(strings['UI-06']));
    chapters.forEach((chapter) => {
      const link = railNav.querySelector(`[data-target="${CSS.escape(chapter.id)}"]`);
      link.title = attributeText(chapter.title);
      link.setAttribute('aria-label', attributeText(chapter.title));
    });
  }

  function setState(state) {
    root.dataset.sidebar = state;
    toggle.setAttribute('aria-expanded', String(isExpanded()));
    // 抽屜開啟時，背後的內容不能被選到，也不會被螢幕報讀器讀出
    main.inert = isDrawerOpen();
    if (skipLink) skipLink.inert = isDrawerOpen();
    updateLabels();
    revealCurrent();
  }

  function close({ returnFocus = true } = {}) {
    setState('collapsed');
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => {
    const next = isExpanded() ? 'collapsed' : 'expanded';
    setState(next);
    if (DESKTOP.matches) saveState(next); // 只有電腦版記住狀態
    if (isDrawerOpen()) focusableItems()[0]?.focus();
  });

  backdrop.addEventListener('click', () => close());

  // 抽屜內可以用 Tab 選到的項目。radio 群組只有勾選的那一個能被選到
  function focusableItems() {
    return [...sidebar.querySelectorAll('a[href], button, input')].filter(
      (node) => node.getClientRects().length > 0 && !(node.type === 'radio' && !node.checked),
    );
  }

  document.addEventListener('keydown', (event) => {
    // 電腦版的左側欄不會蓋住內容，不需要用 Esc 關閉
    if (event.key === 'Escape' && isExpanded() && !DESKTOP.matches) {
      close();
      return;
    }
    if (event.key === 'Tab' && isDrawerOpen()) {
      // 「☰」在畫面上位於抽屜內，所以一起納入循環
      const items = [toggle, ...focusableItems()];
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  sidebar.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-target]');
    if (!link) return;
    pinnedId = link.dataset.target;
    // 左側欄蓋住內容時（手機與平板），跳轉後自動關閉
    if (isExpanded() && !DESKTOP.matches) {
      close({ returnFocus: false });
      // 瀏覽器跳到錨點時會清掉焦點，所以等跳轉完成後再移回「☰」
      setTimeout(() => toggle.focus({ preventScroll: true }), 0);
    }
    setCurrent(pinnedId);
  });

  // ---------- 目前位置 ----------

  const headings = chapters
    .flatMap((chapter) => [chapter, ...chapter.sections].map((item) => ({ id: item.id, chapterId: chapter.id })))
    .map((item) => ({ ...item, node: document.getElementById(item.id) }))
    .filter((item) => item.node);
  let currentId = null;
  // 點目錄後先固定在點選的項目。頁尾的小節可能捲不到頂端，否則會標示到別的項目
  let pinnedId = null;

  function setCurrent(id) {
    if (id === currentId) return;
    currentId = id;
    const chapterId = headings.find((item) => item.id === id)?.chapterId;
    for (const link of sidebar.querySelectorAll('a[data-target]')) {
      const active = link.dataset.target === (link.classList.contains('rail-link') ? chapterId : id);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    revealCurrent();
  }

  // 只捲動左欄。不用 scrollIntoView，因為它也可能帶動整個頁面
  function revealCurrent() {
    for (const link of scroll.querySelectorAll('[aria-current="location"]')) {
      if (link.getClientRects().length === 0) continue;
      const box = scroll.getBoundingClientRect();
      const item = link.getBoundingClientRect();
      if (item.top < box.top) scroll.scrollTop -= box.top - item.top + 16;
      else if (item.bottom > box.bottom) scroll.scrollTop += item.bottom - box.bottom + 16;
    }
  }

  function detectCurrent() {
    if (pinnedId) {
      setCurrent(pinnedId);
      return;
    }
    const line = window.innerHeight * 0.3;
    const atBottom = window.scrollY > 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 2;
    const passed = atBottom ? headings : headings.filter((item) => item.node.getBoundingClientRect().top <= line);
    setCurrent(passed.length > 0 ? passed[passed.length - 1].id : null);
  }

  // 標題越過畫面上方三成的位置時重新判斷
  const observer = new IntersectionObserver(detectCurrent, { rootMargin: '0px 0px -70% 0px' });
  headings.forEach((item) => observer.observe(item.node));

  // 頁尾進入畫面時也要判斷，最後一節才標示得到
  const sentinel = element('div');
  sentinel.setAttribute('aria-hidden', 'true');
  main.append(sentinel);
  new IntersectionObserver(detectCurrent).observe(sentinel);

  // 讀者自己捲動時，解除點選後的固定
  const unpin = () => { pinnedId = null; };
  window.addEventListener('wheel', unpin, { passive: true });
  window.addEventListener('touchmove', unpin, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) unpin();
  });

  // ---------- 寬度與語言改變 ----------

  function applyLayout() {
    setState(DESKTOP.matches ? readState() : 'collapsed');
  }
  DESKTOP.addEventListener('change', applyLayout);
  MOBILE.addEventListener('change', applyLayout);
  document.addEventListener('htsg:langchange', updateLabels);
  // 按上一頁還原舊畫面時，重新讀一次設定
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) applyLayout();
  });

  toggle.hidden = false;
  applyLayout();
}
