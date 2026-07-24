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

// ── Boot ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const { displayName } = getUser();
  if (displayName) {
    show('app'); initApp();
  } else {
    show('landing');
  }
  wire();
});

function show(id) {
  document.getElementById('landing').classList.toggle('hidden', id !== 'landing');
  document.getElementById('app').classList.toggle('hidden', id !== 'app');
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

  // Use avatar URL stored at login (from OAuth userinfo) if available
  if (avatarUrl) {
    setImg(avatarUrl);
    return;
  }

  // Fallback: fetch via our server-side proxy (avoids CORS)
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
}

function loadChat(id) {
  const cs   = getChats();
  const chat = cs.find(c => c.id === id);
  if (!chat) { newChat(); return; }
  state.chatId = id;
  localStorage.setItem('z_active', id);
  renderSidebar();
  renderMessages(chat.messages);
}

function renderMessages(msgs) {
  const box = el('messages');
  const emp = el('empty-state');
  Array.from(box.children).forEach(ch => { if (ch !== emp) ch.remove(); });
  if (!msgs.length) { emp.classList.remove('hidden'); return; }
  emp.classList.add('hidden');
  msgs.forEach(m => box.appendChild(m.role === 'user' ? userBubble(m.content) : aiMsgDone(m.content)));
  box.scrollTop = box.scrollHeight;
}

function userBubble(text) {
  const w = document.createElement('div');
  w.className = 'msg msg-user';
  const b = document.createElement('div');
  b.className = 'msg-bubble';
  b.textContent = text;
  w.appendChild(b);
  return w;
}

// Finished AI message (markdown rendered)
function aiMsgDone(text) {
  const { wrap, textEl } = aiMsg(text, false);
  textEl.innerHTML = md(text);
  return wrap;
}

function aiMsg(text, live) {
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
  w.appendChild(av);
  w.appendChild(cd);
  return { wrap: w, textEl: tx };
}

// ── Send with real Gemini ─────────────────────
async function sendMsg(content) {
  content = content.trim();
  if (!content || state.responding) return;
  state.responding = true;

  const cs   = getChats();
  const chat = cs.find(c => c.id === state.chatId);
  if (!chat) { state.responding = false; return; }

  // Capture history BEFORE adding new user message
  const history = chat.messages.map(m => ({ role: m.role, content: m.content }));

  // Push user message to history
  chat.messages.push({ role: 'user', content, ts: Date.now() });
  if (chat.title === 'New Chat')
    chat.title = content.slice(0, 40) + (content.length > 40 ? '…' : '');
  saveChats(cs);

  // DOM: user bubble
  const box = el('messages');
  el('empty-state').classList.add('hidden');
  box.appendChild(userBubble(content));
  box.scrollTop = box.scrollHeight;
  renderSidebar();

  // Show activity
  startActivity([
    { phase: 'Thinking', items: ['Analyzing your request…'] },
    { phase: 'Working',  items: ['Generating response…'] },
  ]);

  // Live AI bubble
  const { wrap, textEl } = aiMsg('', true);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;

  let fullText = '';

  try {
    const allMsgs = [...history, { role: 'user', content }];
    const response = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: allMsgs }),
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
          // Provider/model announcement at start of stream
          if (parsed.model) setRespondingModel(parsed.model);
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
    fullText = 'Could not reach the AI service. Please try again.';
    textEl.innerHTML = md(fullText);
  }
  clearRespondingModel();

  // Save AI reply
  const cs2   = getChats();
  const chat2 = cs2.find(c => c.id === state.chatId);
  if (chat2 && fullText) {
    chat2.messages.push({ role: 'ai', content: fullText, ts: Date.now() });
    saveChats(cs2);
  }

  stopActivity();
  state.responding = false;
  box.scrollTop = box.scrollHeight;
}

// ── Activity ──────────────────────────────────
function startActivity(acts) {
  const panel = el('activity-panel');
  panel.classList.remove('hidden');
  state.activities = acts;
  state.actOpen    = false;
  el('activity-summary').textContent = 'Zenith is working…';
  el('activity-body').innerHTML      = '';
  el('activity-body').classList.remove('open');
  el('activity-arrow').classList.remove('flipped');

  let delay = 0;
  acts.forEach((g, i) => {
    setTimeout(() => {
      if (state.actOpen) renderActBody(acts.slice(0, i + 1));
      if (i === acts.length - 1)
        el('activity-summary').textContent = 'Zenith is responding…';
    }, delay);
    delay += 600 + Math.random() * 300;
  });
}
function stopActivity() { el('activity-panel').classList.add('hidden'); }

function renderActBody(groups) {
  el('activity-body').innerHTML = groups.map(g => `
    <div class="act-group">
      <div class="act-phase ${g.phase.toLowerCase()}">${g.phase}</div>
      ${g.items.map(item => `
        <div class="act-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          <span>${item}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
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
        <span>${esc(chat.title)}</span>
      </button>
      <div class="chat-acts">
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
  el('sidebar').classList.toggle('collapsed', state.collapsed);
  el('main').classList.toggle('wide', state.collapsed);
  el('btn-collapse').querySelector('svg').innerHTML = state.collapsed
    ? '<polyline points="9 18 15 12 9 6"/>'
    : '<polyline points="15 18 9 12 15 6"/>';
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

    // Model display (truncate long names)
    const m = data.model || '—';
    model.textContent = m.length > 20 ? m.slice(0, 18) + '…' : m;
    model.title       = m;

    // Fallback chain badges
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

  // Refresh every 60 s
  setTimeout(loadAIStatus, 60_000);
}

/** Show which model is actively responding (during stream) */
function setRespondingModel(modelId) {
  const label = el('ai-status-label');
  if (!label) return;
  const short = (modelId || '').split('/')[1]?.split(':')[0] || modelId;
  label.textContent = `${short}…`;
}
function clearRespondingModel() {
  // Re-fetch status to restore correct values
  loadAIStatus();
}

// ── Copy server URL ───────────────────────────
function copyServerUrl() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url).then(() => {
    const btn = el('btn-copy-url');
    if (!btn) return;
    btn.querySelector('span').textContent = 'Copied!';
    setTimeout(() => { btn.querySelector('span').textContent = 'Copy server URL'; }, 2000);
  }).catch(() => {});
}

// ── Wire events ───────────────────────────────
function wire() {
  el('btn-login').addEventListener('click', openLogin);
  el('btn-logout')?.addEventListener('click', logout);
  el('btn-new-chat').addEventListener('click', () => { if (!state.responding) newChat(); });
  el('btn-collapse').addEventListener('click', toggleSidebar);

  el('btn-send').addEventListener('click', doSend);
  el('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });
  el('chat-input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
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
function wait(n) { return new Promise(r => setTimeout(r, n)); }
function esc(s)  { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function md(text) {
  if (!text) return '';
  // Fenced code blocks
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang || 'lua'}">${esc(code.trim())}</code></pre>`
  );
  // Inline code
  text = text.replace(/`([^`\n]+)`/g, (_, c) => `<code>${esc(c)}</code>`);
  // Paragraphs
  return text.split(/\n\n+/).map(para => {
    para = para
      .replace(/&(?!amp;|lt;|gt;|quot;)/g, '&amp;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
    return `<p>${para}</p>`;
  }).join('');
}

function mdInline(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
