/**
 * Popup 入口 — 显示总开关状态 + 跳转到 Options。
 */

import { getSettings } from '../shared/storage/keys.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const statusEl = $('status');
const optionsLink = $<HTMLAnchorElement>('options');

async function refresh(): Promise<void> {
  const s = await getSettings();
  const ok = s.apiKey.length > 0;
  statusEl.className = ok ? 'status' : 'status err';
  statusEl.innerHTML = ok
    ? '<span><span class="dot"></span>已配置 Key</span>'
    : '<span><span class="dot"></span>未配置 API Key</span>';
}

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void refresh();