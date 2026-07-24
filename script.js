// ═══════════════════════════════════════════
//  ZENITH — Dashboard
// ═══════════════════════════════════════════

const OAUTH_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const CLIENT_ID = '8019894370613982106';
const REDIRECT  = window.location.origin + '/roblox-callback';
const SCOPES    = 'openid profile';

const state = {
  chatId:     null,
  collapsed:  false,
  actOpen:    false,
  activities: null,
  delId:      null,
  renId:      null,
  responding: false,
  abortCtrl:  null,
  modeThinking: false,
  modeSearch:   false,
  activePanel:  'home',
};

// ── Storage ──────────────────────────────────
function getChats() {
  try { return JSON.parse(localStorage.getItem('z_chats') || '[]'); } catch { return []; }
}
function saveChats(c) { localStorage.setItem('z_chats', JSON.stringify(c)); }
function getUser() {
  return {
    displayName: localStorage.getItem('roblox_user_name') || '',
    username:    localStorage.getItem('roblox_username')  || '',
    userId:      localStorage.getItem('roblox_user_id')   || '',
    avatarUrl:   localStorage.getItem('roblox_avatar')    || '',
  };
}

// ── Settings ──────────────────────────────────
function getSetting(k, def) { return localStorage.getItem('z_' + k) || def; }
function setSetting(k, v)   { localStorage.setItem('z_' + k, v); }

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  // Update active buttons if settings panel is rendered
  document.querySelectorAll('.settings-opt').forEach(b => b.classList.remove('active'));
  const tEl = el('opt-' + theme);
  if (tEl) tEl.classList.add('active');
  const lang = getSetting('lang', 'en');
  const lEl = el('opt-' + lang);
  if (lEl) lEl.classList.add('active');
}

function setTheme(theme) {
  setSetting('theme', theme);
  applyTheme(theme);
}

function setLang(lang) {
  setSetting('lang', lang);
  applyTheme(getSetting('theme', 'light'));
  // Re-highlight lang button
  document.querySelectorAll('.settings-opt').forEach(b => b.classList.remove('active'));
  const tEl = el('opt-' + getSetting('theme', 'light'));
  if (tEl) tEl.classList.add('active');
  const lEl = el('opt-' + lang);
  if (lEl) lEl.classList.add('active');
}

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(getSetting('theme', 'light'));
  const { displayName } = getUser();
  if (displayName) {
    const hasEntered = sessionStorage.getItem('z_entered');
    if (hasEntered) {
      show('app');
      initApp();
    } else {
      show('main-menu');
      initMainMenu();
    }
  } else {
    show('landing');
  }
  wire();
  startAFK();
});

function show(id) {
  ['landing', 'main-menu', 'app'].forEach(s =>
    document.getElementById(s).classList.toggle('hidden', s !== id)
  );
}

// ── Main Menu ─────────────────────────────────
const MM_PHRASES = [
  'ZENITH IA READY TO WORK',
  'YOUR STUDIO AI COMPANION',
  'SCRIPTING MADE SMARTER',
];

function initMainMenu() {
  const { displayName, avatarUrl } = getUser();
  el('mm-username').textContent = displayName || 'Developer';

  // Avatar
  const img = el('mm-avatar-img');
  const fb  = el('mm-avatar-fallback');
  fb.textContent = (displayName || 'D').charAt(0).toUpperCase();
  if (avatarUrl) {
    img.src = avatarUrl;
    img.onload  = () => { img.style.display = 'block'; fb.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none';  fb.style.display = ''; };
  }

  // Typewriter
  let phraseIdx = 0;
  let charIdx   = 0;
  let deleting  = false;
  const twEl = el('mm-typewriter');
  function typeLoop() {
    const phrase = MM_PHRASES[phraseIdx % MM_PHRASES.length];
    if (!deleting) {
      twEl.textContent = phrase.slice(0, charIdx + 1);
      charIdx++;
      if (charIdx >= phrase.length) {
        deleting = true;
        setTimeout(typeLoop, 2000);
        return;
      }
      setTimeout(typeLoop, 70);
    } else {
      twEl.textContent = phrase.slice(0, charIdx - 1);
      charIdx--;
      if (charIdx <= 0) {
        deleting = false;
        phraseIdx++;
        setTimeout(typeLoop, 400);
        return;
      }
      setTimeout(typeLoop, 35);
    }
  }
  typeLoop();

  // Animated orbs bg
  const bg = el('mm-bg');
  if (bg) {
    bg.innerHTML = `
      <div class="mm-orb mm-orb1"></div>
      <div class="mm-orb mm-orb2"></div>
      <div class="mm-orb mm-orb3"></div>
    `;
  }
}

// ── Auth ──────────────────────────────────────
function openLogin() {
  const s = Math.random().toString(36).slice(2);
  localStorage.setItem('roblox_oauth_state', s);
  location.href = `${OAUTH_URL}?${new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT,
    response_type: 'code', scope: SCOPES, state: s,
  })}`;
}
function logout() {
  ['roblox_user_name','roblox_username','roblox_user_id','roblox_avatar','roblox_oauth_state'].forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem('z_entered');
  show('landing');
}

// ── App Init ──────────────────────────────────
function initApp() {
  renderUser();
  loadAvatar();
  loadAIStatus();
  const chats = getChats();
  if (!chats.length) { newChat(); return; }
  const lastId = localStorage.getItem('z_active');
  const exists = chats.find(c => c.id === lastId);
  loadChat(exists ? lastId : chats[0].id);
  renderSidebar();
  applyTheme(getSetting('theme', 'light'));
}

// ── User ──────────────────────────────────────
function renderUser() {
  const { displayName, username } = getUser();
  el('user-displayname').textContent = displayName;
  el('user-username').textContent    = username
    ? `@${username}`
    : `@${displayName.toLowerCase().replace(/\s+/g, '')}`;
  el('user-avatar-fallback').textContent = displayName.charAt(0).toUpperCase();
}

async function loadAvatar() {
  const img = el('user-avatar');
  const fb  = el('user-avatar-fallback');
  const { userId, avatarUrl } = getUser();

  function setImg(url) {
    if (!url) return;
    img.src    = url;
    img.onload  = () => { img.style.display = 'block'; fb.style.display = 'none'; };
    img.onerror = () => { img.style.display = 'none';  fb.style.display = '';     };
  }

  if (avatarUrl) { setImg(avatarUrl); return; }
  if (!userId) return;
  try {
    const r = await fetch(`/api/avatar?userId=${encodeURIComponent(userId)}`);
    if (r.ok) {
      const data = await r.json();
      if (data.imageUrl) {
        localStorage.setItem('roblox_avatar', data.imageUrl);
        setImg(data.imageUrl);
      }
    }
  } catch { /* non-fatal */ }
}

// ── Panel switching ────────────────────────────
function showPanel(name) {
  state.activePanel = name;
  el('panel-home').classList.toggle('hidden', name !== 'home');
  el('panel-settings').classList.toggle('hidden', name !== 'settings');
  // Update nav active states
  el('nav-home').classList.toggle('active', name === 'home');
  el('nav-settings').classList.toggle('active', name === 'settings');
  if (name === 'settings') applyTheme(getSetting('theme', 'light'));
}

// ── Chat CRUD ─────────────────────────────────
function uid() { return 'c' + Date.now() + Math.random().toString(36).slice(2, 5); }

function newChat() {
  const id = uid();
  const c  = { id, title: 'New Chat', messages: [], at: Date.now() };
  const cs = getChats();
  cs.unshift(c);
  saveChats(cs);
  state.chatId = id;
  localStorage.setItem('z_active', id);
  renderSidebar();
  renderMessages([]);
  showPanel('home');
}

function loadChat(id) {
  const cs   = getChats();
  const chat = cs.find(c => c.id === id);
  if (!chat) { newChat(); return; }
  state.chatId = id;
  localStorage.setItem('z_active', id);
  renderSidebar();
  renderMessages(chat.messages);
  showPanel('home');
}

function renderMessages(msgs) {
  const box = el('messages');
  const emp = el('empty-state');
  Array.from(box.children).forEach(ch => { if (ch !== emp) ch.remove(); });
  if (!msgs.length) { emp.classList.remove('hidden'); return; }
  emp.classList.add('hidden');
  msgs.forEach(m => {
    if (m.role === 'user') box.appendChild(userBubble(m.content, m.chipKind, m.chipLines));
    else box.appendChild(aiMsgDone(m.content, m.timestamp, m.model, m.responseMs, m.liked));
  });
  box.scrollTop = box.scrollHeight;
}

// ── Chip detection ─────────────────────────────
function detectChip(text) {
  const lines = text.split('\n').length;

  // Lua detection: code block with lua or common Lua patterns
  const isLua = /```lua/i.test(text) ||
    (/local\s+\w+|function\s+\w+\s*\(|game\.|workspace\.|script\.|print\s*\(/i.test(text) && lines >= 10);

  if (isLua && lines >= 35) return { kind: 'lua', lines };
  if (lines > 250) return { kind: 'text', lines };
  return null;
}

// ── Bubbles ────────────────────────────────────
function userBubble(text, chipKind, chipLines) {
  const w = document.createElement('div');
  w.className = 'msg msg-user';
  const b = document.createElement('div');
  b.className = 'msg-bubble';
  if (chipKind) {
    const chip = document.createElement('div');
    chip.className = 'paste-chip';
    chip.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${chipKind === 'lua'
          ? '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'
          : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'}
      </svg>
      <span>${chipKind === 'lua' ? 'Lua-Pasted' : 'Text-Pasted'}</span>
      <span class="chip-lines">${chipLines} lines</span>
    `;
    b.appendChild(chip);
  } else {
    b.textContent = text;
  }
  w.appendChild(b);
  return w;
}

function aiMsgDone(text, timestamp, model, responseMs, liked) {
  const { wrap } = aiMsgEl(text, false, timestamp, model, responseMs, liked);
  return wrap;
}

function aiMsgEl(text, live, timestamp, model, responseMs, liked) {
  const w   = document.createElement('div');
  w.className = 'msg msg-ai';
  const av  = document.createElement('div');
  av.className = 'ai-avatar';
  av.innerHTML = '<span>Z</span>';
  const cd  = document.createElement('div');
  cd.className = 'msg-content';
  const nm  = document.createElement('div');
  nm.className = 'ai-name';
  nm.textContent = 'Zenith';
  const tx  = document.createElement('div');
  tx.className = 'ai-text';
  if (!live && text) tx.innerHTML = md(text);
  cd.appendChild(nm);
  cd.appendChild(tx);

  // Actions row (shown after response)
  if (!live) {
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    acts.innerHTML = buildMsgActions(text, timestamp, model, responseMs, liked);
    cd.appendChild(acts);
    wireActions(acts, text, timestamp, model, responseMs);
  }

  w.appendChild(av);
  w.appendChild(cd);
  return { wrap: w, textEl: tx };
}

function buildMsgActions(text, timestamp, model, responseMs, liked) {
  const ts = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <button class="msg-act-btn act-copy" title="Copy">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Copy
    </button>
    <button class="msg-act-btn act-again" title="Retry">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Again
    </button>
    <button class="msg-act-btn act-like${liked ? ' liked' : ''}" title="Like">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
      Like
    </button>
    <div class="msg-act-more-wrap">
      <button class="msg-act-btn act-more" title="More">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        More
      </button>
      <div class="msg-more-popup hidden">
        ${ts ? `<div class="more-row"><span>Time</span><span>${ts}</span></div>` : ''}
        ${model ? `<div class="more-row"><span>Model</span><span>${model.split('/')[1]?.split(':')[0] || model}</span></div>` : ''}
        ${responseMs ? `<div class="more-row"><span>Response</span><span>${(responseMs/1000).toFixed(1)}s</span></div>` : ''}
      </div>
    </div>
  `;
}

function wireActions(acts, text, timestamp, model, responseMs) {
  acts.querySelector('.act-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      const b = acts.querySelector('.act-copy');
      b.textContent = '✓ Copied';
      setTimeout(() => { b.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy'; }, 2000);
    });
  });

  acts.querySelector('.act-again')?.addEventListener('click', () => {
    const cs = getChats();
    const chat = cs.find(c => c.id === state.chatId);
    if (!chat) return;
    const lastUser = [...chat.messages].reverse().find(m => m.role === 'user');
    if (lastUser) sendMsg(lastUser.content);
  });

  acts.querySelector('.act-like')?.addEventListener('click', function() {
    this.classList.toggle('liked');
    const svg = this.querySelector('svg');
    if (svg) svg.setAttribute('fill', this.classList.contains('liked') ? 'currentColor' : 'none');
  });

  const moreBtn  = acts.querySelector('.act-more');
  const morePopup = acts.querySelector('.msg-more-popup');
  moreBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    morePopup?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => morePopup?.classList.add('hidden'));
}

// ── Progressive thinking states ───────────────
const THINKING_STATES = ['Thinking', 'Checking', 'Working', 'Responding'];
let thinkingInterval = null;

function startThinkingStates() {
  let i = 0;
  el('activity-summary').textContent = THINKING_STATES[0] + '…';
  thinkingInterval = setInterval(() => {
    i = (i + 1) % THINKING_STATES.length;
    const sumEl = el('activity-summary');
    if (sumEl) sumEl.textContent = THINKING_STATES[i] + '…';
  }, 1200);
}

function stopThinkingStates() {
  if (thinkingInterval) { clearInterval(thinkingInterval); thinkingInterval = null; }
}

// ── Send with streaming ───────────────────────
async function sendMsg(content) {
  content = content.trim();
  if (!content || state.responding) return;
  state.responding = true;
  state.abortCtrl  = new AbortController();

  // Chip detection
  const chip = detectChip(content);

  // Update send button → stop
  el('send-icon').style.display = 'none';
  el('stop-icon').style.display = '';
  el('btn-send').classList.add('btn-stop');
  el('btn-send').title = 'Stop';

  const cs   = getChats();
  const chat = cs.find(c => c.id === state.chatId);
  if (!chat) { resetSend(); return; }

  const history = chat.messages.map(m => ({ role: m.role, content: m.content }));

  const msgEntry = { role: 'user', content, ts: Date.now() };
  if (chip) { msgEntry.chipKind = chip.kind; msgEntry.chipLines = chip.lines; }
  chat.messages.push(msgEntry);
  if (chat.title === 'New Chat')
    chat.title = content.slice(0, 40) + (content.length > 40 ? '…' : '');
  saveChats(cs);

  const box = el('messages');
  el('empty-state').classList.add('hidden');
  box.appendChild(userBubble(content, chip?.kind, chip?.lines));
  box.scrollTop = box.scrollHeight;
  renderSidebar();

  // Activity
  const panel = el('activity-panel');
  panel.classList.remove('hidden');
  el('activity-body').innerHTML = '';
  el('activity-body').classList.remove('open');
  el('activity-arrow').classList.remove('flipped');
  startThinkingStates();

  // Live AI bubble
  const { wrap, textEl } = aiMsgEl('', true);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;

  let fullText   = '';
  let respModel  = '';
  const t0       = Date.now();
  let stopped    = false;

  try {
    // Build system context from modes
    const systemNote = [];
    if (state.modeThinking) systemNote.push('Use extended step-by-step reasoning before answering.');
    if (state.modeSearch)   systemNote.push('Supplement your answer with web/documentation references if helpful.');

    const allMsgs = [...history, { role: 'user', content }];

    const response = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: allMsgs, systemNote: systemNote.join(' ') }),
      signal:  state.abortCtrl.signal,
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed.model) { respModel = parsed.model; setRespondingModel(parsed.model); }
          if (parsed.content) {
            fullText += parsed.content;
            textEl.innerHTML = md(fullText);
            box.scrollTop = box.scrollHeight;
          }
          if (parsed.error) {
            fullText = parsed.error;
            textEl.innerHTML = md(fullText);
          }
        } catch { /* skip malformed SSE */ }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      stopped = true;
      if (!fullText) fullText = '';
      const stopNote = document.createElement('p');
      stopNote.className = 'stop-note';
      stopNote.textContent = 'Zenith stopped writing.';
      textEl.appendChild(stopNote);
    } else {
      fullText = 'Could not reach the AI service. Please try again.';
      textEl.innerHTML = md(fullText);
    }
  }

  stopThinkingStates();
  clearRespondingModel();
  panel.classList.add('hidden');

  const responseMs = Date.now() - t0;

  // Save AI reply
  if (fullText && !stopped) {
    const cs2   = getChats();
    const chat2 = cs2.find(c => c.id === state.chatId);
    if (chat2) {
      const aiEntry = { role: 'ai', content: fullText, ts: Date.now(), timestamp: Date.now(), model: respModel, responseMs };
      chat2.messages.push(aiEntry);
      saveChats(cs2);
    }
    // Add actions to the live bubble
    const msgContent = wrap.querySelector('.msg-content');
    const acts = document.createElement('div');
    acts.className = 'msg-actions';
    acts.innerHTML = buildMsgActions(fullText, Date.now(), respModel, responseMs, false);
    wireActions(acts, fullText, Date.now(), respModel, responseMs);
    msgContent.appendChild(acts);
  }

  resetSend();
  box.scrollTop = box.scrollHeight;
}

function resetSend() {
  state.responding = false;
  state.abortCtrl  = null;
  el('send-icon').style.display = '';
  el('stop-icon').style.display = 'none';
  el('btn-send').classList.remove('btn-stop');
  el('btn-send').title = 'Send';
}

// ── Sidebar ───────────────────────────────────
function renderSidebar() {
  const list = el('recent-list');
  list.innerHTML = '';
  getChats().forEach(chat => {
    const li = document.createElement('li');
    li.className = `chat-item${chat.id === state.chatId ? ' active' : ''}`;
    li.dataset.id = chat.id;
    li.innerHTML = `
      <button class="chat-sel" data-id="${esc(chat.id)}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="sidebar-text">${esc(chat.title)}</span>
      </button>
      <div class="chat-acts sidebar-text">
        <button class="act-btn chat-ren" data-id="${esc(chat.id)}" title="Rename">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="act-btn chat-del" data-id="${esc(chat.id)}" title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    list.appendChild(li);
  });
}

// ── Modals ────────────────────────────────────
function openDel(id) { state.delId = id; openModal('modal-delete'); }
function closeDel()  { state.delId = null; closeModal('modal-delete'); }
function openRen(id) {
  state.renId = id;
  const chat  = getChats().find(c => c.id === id);
  const inp   = el('rename-input');
  inp.value   = chat ? chat.title : '';
  openModal('modal-rename');
  setTimeout(() => inp.focus(), 80);
}
function closeRen() { state.renId = null; closeModal('modal-rename'); }

function openModal(id) {
  el(id).classList.remove('hidden');
  requestAnimationFrame(() => el(id).querySelector('.modal').classList.add('in'));
}
function closeModal(id) {
  const m = el(id).querySelector('.modal');
  m.classList.remove('in');
  m.classList.add('out');
  setTimeout(() => {
    el(id).classList.add('hidden');
    m.classList.remove('out');
  }, 200);
}

function confirmDel() {
  if (!state.delId) return;
  let cs = getChats().filter(c => c.id !== state.delId);
  saveChats(cs);
  if (state.chatId === state.delId) {
    state.chatId = null;
    if (cs.length) loadChat(cs[0].id); else newChat();
  }
  renderSidebar();
  closeDel();
}
function confirmRen() {
  const val = (el('rename-input').value || '').trim();
  if (!val || !state.renId) return;
  const cs   = getChats();
  const chat = cs.find(c => c.id === state.renId);
  if (chat) { chat.title = val; saveChats(cs); renderSidebar(); }
  closeRen();
}

// ── Sidebar collapse ──────────────────────────
function toggleSidebar() {
  state.collapsed = !state.collapsed;
  const sb = el('sidebar');
  sb.classList.toggle('collapsed', state.collapsed);
  el('main').classList.toggle('wide', state.collapsed);
}

// ── Plus menu ─────────────────────────────────
function togglePlusMenu() {
  el('plus-menu').classList.toggle('hidden');
}

function toggleMode(mode) {
  if (mode === 'thinking') {
    state.modeThinking = !state.modeThinking;
    el('check-thinking').classList.toggle('hidden', !state.modeThinking);
  } else {
    state.modeSearch = !state.modeSearch;
    el('check-search').classList.toggle('hidden', !state.modeSearch);
  }
  renderModeChips();
  el('plus-menu').classList.add('hidden');
}

function renderModeChips() {
  const box = el('mode-chips');
  box.innerHTML = '';
  if (state.modeThinking) {
    const c = document.createElement('div');
    c.className = 'mode-chip';
    c.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> Thinking <button onclick="toggleMode('thinking')">×</button>`;
    box.appendChild(c);
  }
  if (state.modeSearch) {
    const c = document.createElement('div');
    c.className = 'mode-chip';
    c.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Search Internet <button onclick="toggleMode('search')">×</button>`;
    box.appendChild(c);
  }
}

// ── AI Status ─────────────────────────────────
async function loadAIStatus() {
  const dot   = el('ai-status-dot');
  const label = el('ai-status-label');
  const model = el('ai-model-name');
  const fbRow = el('ai-fallback-row');
  if (!dot) return;

  dot.className   = 'ai-status-dot checking';
  label.textContent = 'Checking…';

  try {
    const r = await fetch('/api/status');
    if (!r.ok) throw new Error('status ' + r.status);
    const data = await r.json();

    const online = data.configured === true;
    dot.className     = 'ai-status-dot ' + (online ? 'online' : 'offline');
    label.textContent = online ? 'Online' : 'Key not set';

    const m = data.model || '—';
    model.textContent = m.length > 20 ? m.slice(0, 18) + '…' : m;
    model.title       = m;

    if (Array.isArray(data.fallbackChain) && fbRow) {
      fbRow.innerHTML = data.fallbackChain.map((fm, i) =>
        `<span class="ai-fallback-badge${i === 0 ? ' active' : ''}" title="${esc(fm)}">${
          esc(fm.split('/')[1]?.split(':')[0] || fm)
        }</span>`
      ).join('');
    }
  } catch {
    if (dot) { dot.className = 'ai-status-dot offline'; label.textContent = 'Unavailable'; }
  }

  setTimeout(loadAIStatus, 60_000);
}

function setRespondingModel(modelId) {
  const label = el('ai-status-label');
  if (!label) return;
  const short = (modelId || '').split('/')[1]?.split(':')[0] || modelId;
  label.textContent = `${short}…`;
}
function clearRespondingModel() { loadAIStatus(); }

// ── AFK ───────────────────────────────────────
const AFK_MS = 25 * 60 * 1000; // 25 minutes
let afkTimer = null;

function resetAFK() {
  if (afkTimer) clearTimeout(afkTimer);
  afkTimer = setTimeout(showAFK, AFK_MS);
}

function startAFK() {
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, resetAFK, { passive: true })
  );
  resetAFK();
}

function showAFK() {
  const { displayName } = getUser();
  const title = el('afk-title');
  if (title) title.textContent = `${displayName || 'Hey'}, are you AFK?`;
  el('afk-overlay')?.classList.remove('hidden');
}

function hideAFK() {
  el('afk-overlay')?.classList.add('hidden');
  resetAFK();
}

// ── Wire events ───────────────────────────────
function wire() {
  el('btn-login').addEventListener('click', openLogin);
  el('btn-logout')?.addEventListener('click', logout);
  el('btn-new-chat').addEventListener('click', () => { if (!state.responding) newChat(); });
  el('btn-collapse').addEventListener('click', toggleSidebar);
  el('nav-home').addEventListener('click', () => showPanel('home'));
  el('nav-settings').addEventListener('click', () => showPanel('settings'));
  el('btn-community')?.addEventListener('click', () => openModal('modal-community'));
  el('modal-community-close')?.addEventListener('click', () => closeModal('modal-community'));
  el('modal-community')?.addEventListener('click', e => { if (e.target === el('modal-community')) closeModal('modal-community'); });

  // Main menu enter
  el('btn-enter')?.addEventListener('click', () => {
    sessionStorage.setItem('z_entered', '1');
    show('app');
    initApp();
  });

  // AFK
  el('btn-afk-continue')?.addEventListener('click', hideAFK);

  // Send / stop
  el('btn-send').addEventListener('click', () => {
    if (state.responding && state.abortCtrl) {
      state.abortCtrl.abort();
    } else {
      doSend();
    }
  });
  el('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  el('chat-input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
  });

  // Plus menu
  el('btn-plus').addEventListener('click', e => { e.stopPropagation(); togglePlusMenu(); });
  el('plus-thinking').addEventListener('click', () => toggleMode('thinking'));
  el('plus-search').addEventListener('click', () => toggleMode('search'));
  document.addEventListener('click', e => {
    if (!el('plus-menu').contains(e.target) && e.target !== el('btn-plus')) {
      el('plus-menu').classList.add('hidden');
    }
  });

  // Activity toggle
  el('activity-toggle').addEventListener('click', () => {
    state.actOpen = !state.actOpen;
    el('activity-body').classList.toggle('open', state.actOpen);
    el('activity-arrow').classList.toggle('flipped', state.actOpen);
    if (state.actOpen && state.activities) renderActBody(state.activities);
  });

  // Recent list delegation
  el('recent-list').addEventListener('click', e => {
    const sel = e.target.closest('.chat-sel');
    const ren = e.target.closest('.chat-ren');
    const del = e.target.closest('.chat-del');
    if (sel) loadChat(sel.dataset.id);
    else if (ren) openRen(ren.dataset.id);
    else if (del) openDel(del.dataset.id);
  });

  // Delete modal
  el('modal-delete-confirm').addEventListener('click', confirmDel);
  el('modal-delete-cancel').addEventListener('click', closeDel);
  el('modal-delete').addEventListener('click', e => { if (e.target === el('modal-delete')) closeDel(); });

  // Rename modal
  el('modal-rename-save').addEventListener('click', confirmRen);
  el('modal-rename-cancel').addEventListener('click', closeRen);
  el('modal-rename').addEventListener('click', e => { if (e.target === el('modal-rename')) closeRen(); });
  el('rename-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRen();
    if (e.key === 'Escape') closeRen();
  });
}

function renderActBody(groups) {
  el('activity-body').innerHTML = (groups || []).map(g => `
    <div class="act-group">
      <div class="act-phase ${(g.phase||'').toLowerCase()}">${g.phase}</div>
      ${(g.items||[]).map(item => `
        <div class="act-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>${item}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function doSend() {
  const inp = el('chat-input');
  const v   = inp.value.trim();
  if (!v) return;
  inp.value        = '';
  inp.style.height = 'auto';
  sendMsg(v);
}

// ── Utils ─────────────────────────────────────
function el(id)  { return document.getElementById(id); }
function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function md(text) {
  if (!text) return '';
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang || 'lua'}">${esc(code.trim())}</code></pre>`
  );
  text = text.replace(/`([^`\n]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
  return text.split(/\n\n+/).map(para => {
    para = para
      .replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
    return `<p>${para}</p>`;
  }).join('');
}
