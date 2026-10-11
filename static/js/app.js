
'use strict';

// Marked.js Configuration
marked.setOptions({
  breaks: true,
  gfm: true,
  headerIds: false,
  mangle: false,
});

// Custom renderer for code blocks (add copy button)
const renderer = new marked.Renderer();
renderer.code = function (code, lang) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(code, { language }).value;
  return `<pre><button class="code-copy-btn" onclick="copyCode(this)">Copy</button><code class="hljs language-${language}">${highlighted}</code></pre>`;
};
marked.use({ renderer });

function copyCode(btn) {
  const code = btn.nextElementSibling.innerText;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
}
window.copyCode = copyCode;

// State
const state = {
  currentSessionId: null,
  sessions: [],
  isStreaming: false,
};

// DOM References
const sidebar = document.getElementById('sidebar');
const sessionList = document.getElementById('session-list');
const btnNewChat = document.getElementById('btn-new-chat');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnSidebarMobile = document.getElementById('btn-sidebar-toggle-mobile');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const chatArea = document.getElementById('chat-area');
const welcomeScreen = document.getElementById('welcome-screen');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const btnSend = document.getElementById('btn-send');
const btnClearChat = document.getElementById('btn-clear-chat');
const topbarTitle = document.getElementById('topbar-title');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const suggestionGrid = document.getElementById('suggestion-grid');

// API Helpers
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Unknown API error');
  }
  return res.json();
}

async function checkHealth() {
  try {
    const data = await apiFetch('/api/health');
    if (data.gemini && data.supabase) {
      setStatus('ok', `Gemini ✓  Supabase ✓`);
    } else if (data.gemini) {
      setStatus('warn', `Gemini ✓  Supabase ✗ (memory mode)`);
    } else {
      setStatus('err', 'Gemini API key missing');
    }
  } catch {
    setStatus('err', 'Server unreachable');
  }
}

function setStatus(type, text) {
  statusDot.className = `status-dot ${type}`;
  statusText.textContent = text;
}

// Session Management
async function loadSessions() {
  try {
    const data = await apiFetch('/api/sessions');
    state.sessions = data.sessions || [];
    renderSessionList();
  } catch (e) {
    console.error('Failed to load sessions:', e);
  }
}

function renderSessionList() {
  sessionList.innerHTML = '';
  if (state.sessions.length === 0) {
    sessionList.innerHTML = `<div class="session-empty">No chats yet.<br/>Start a new conversation!</div>`;
    return;
  }
  state.sessions.forEach(session => {
    const li = document.createElement('li');
    li.className = `session-item${session.id === state.currentSessionId ? ' active' : ''}`;
    li.setAttribute('role', 'listitem');
    li.dataset.sessionId = session.id;
    li.innerHTML = `
      <div class="session-item-icon">💬</div>
      <span class="session-item-text" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
      <button class="session-item-delete" title="Delete chat" onclick="deleteSession(event, '${session.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>`;
    li.addEventListener('click', (e) => {
      if (!e.target.closest('.session-item-delete')) {
        loadSession(session.id, session.title);
      }
    });
    sessionList.appendChild(li);
  });
}

async function loadSession(sessionId, title) {
  state.currentSessionId = sessionId;
  topbarTitle.textContent = title || 'Chat';
  btnClearChat.style.visibility = 'visible';
  closeSidebar();

  // Highlight active session
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.sessionId === sessionId);
  });

  // Clear and load messages
  messagesContainer.innerHTML = '';
  showWelcome(false);

  try {
    const data = await apiFetch(`/api/sessions/${sessionId}/messages`);
    const messages = data.messages || [];
    if (messages.length === 0) {
      showWelcome(true);
    } else {
      messages.forEach(msg => appendMessage(msg.role, msg.content, false));
      scrollToBottom();
    }
  } catch (e) {
    showError('Failed to load messages: ' + e.message);
  }
}

async function createNewSession() {
  try {
    const data = await apiFetch('/api/sessions', { method: 'POST' });
    const session = data.session;
    state.sessions.unshift(session);
    state.currentSessionId = session.id;
    topbarTitle.textContent = 'New Chat';
    btnClearChat.style.visibility = 'visible';
    messagesContainer.innerHTML = '';
    showWelcome(true);
    renderSessionList();
    closeSidebar();
    messageInput.focus();
    return session.id;
  } catch (e) {
    showError('Failed to create session: ' + e.message);
    return null;
  }
}

async function deleteSession(e, sessionId) {
  e.stopPropagation();
  try {
    await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    if (state.currentSessionId === sessionId) {
      state.currentSessionId = null;
      topbarTitle.textContent = 'aurora';
      btnClearChat.style.visibility = 'hidden';
      messagesContainer.innerHTML = '';
      showWelcome(true);
    }
    renderSessionList();
  } catch (e) {
    showError('Failed to delete session: ' + e.message);
  }
}
window.deleteSession = deleteSession;

// Messaging
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || state.isStreaming) return;

  // Ensure we have a session
  if (!state.currentSessionId) {
    const sessionId = await createNewSession();
    if (!sessionId) return;
  }

  // Clear input
  messageInput.value = '';
  autoResizeTextarea();
  btnSend.disabled = true;

  // Hide welcome
  showWelcome(false);

  // Append user message
  appendMessage('user', text, false);
  scrollToBottom();

  // Show typing indicator
  const typingId = showTypingIndicator();
  state.isStreaming = true;

  // Stream response
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: state.currentSessionId,
        message: text,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Chat request failed');
    }

    removeTypingIndicator(typingId);

    // Create model message row for streaming
    const modelRow = appendMessage('model', '', true);
    const bubble = modelRow.querySelector('.message-bubble');
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    bubble.appendChild(cursor);

    let fullText = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'session_id' && event.session_id) {
            state.currentSessionId = event.session_id;
          } else if (event.type === 'text') {
            fullText += event.text;
            bubble.innerHTML = marked.parse(fullText);
            bubble.appendChild(cursor);
            scrollToBottom();
          } else if (event.type === 'done') {
            cursor.remove();
            bubble.innerHTML = marked.parse(fullText);
            // Update title if first message
            if (event.title) {
              topbarTitle.textContent = event.title;
              const idx = state.sessions.findIndex(s => s.id === state.currentSessionId);
              if (idx !== -1) {
                state.sessions[idx].title = event.title;
                renderSessionList();
              } else {
                await loadSessions();
              }
            }
          } else if (event.type === 'error') {
            cursor.remove();
            bubble.innerHTML = `<span style="color:#ef4444">⚠️ ${escapeHtml(event.message)}</span>`;
          }
        } catch { /* skip malformed SSE */ }
      }
    }

    // Re-apply syntax highlighting to new code blocks
    modelRow.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));

  } catch (err) {
    removeTypingIndicator(typingId);
    showError('Error: ' + err.message);
  } finally {
    state.isStreaming = false;
    btnSend.disabled = messageInput.value.trim() === '';
    scrollToBottom();
  }
}

// UI Helpers
function appendMessage(role, content, isStreaming) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;

  const avatar = role === 'user'
    ? `<div class="message-avatar user-avatar">U</div>`
    : `<div class="message-avatar model-avatar">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="15" stroke="url(#mg1)" stroke-width="1.5"/>
          <path d="M10 16 Q16 9 22 16 Q16 23 10 16Z" fill="url(#mg2)" opacity="0.9"/>
          <defs>
            <linearGradient id="mg1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/>
            </linearGradient>
            <linearGradient id="mg2" x1="10" y1="9" x2="22" y2="23" gradientUnits="userSpaceOnUse">
              <stop stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/>
            </linearGradient>
          </defs>
        </svg>
      </div>`;

  const senderName = role === 'user' ? 'You' : 'aurora';
  const bubbleContent = isStreaming ? '' : (role === 'user' ? escapeHtml(content) : marked.parse(content));

  row.innerHTML = `
    ${avatar}
    <div class="message-bubble-wrap">
      <div class="message-sender">${senderName}</div>
      <div class="message-bubble">${bubbleContent}</div>
    </div>`;

  if (!isStreaming && role === 'model') {
    row.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  }
  if (!isStreaming && role === 'user') {
    row.querySelector('.message-bubble').style.whiteSpace = 'pre-wrap';
  }

  messagesContainer.appendChild(row);
  return row;
}

function showTypingIndicator() {
  const id = 'typing-' + Date.now();
  const row = document.createElement('div');
  row.className = 'message-row model typing-indicator';
  row.id = id;
  row.innerHTML = `
    <div class="message-avatar model-avatar">
      <svg viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="15" stroke="url(#tg1)" stroke-width="1.5"/>
        <path d="M10 16 Q16 9 22 16 Q16 23 10 16Z" fill="url(#tg2)" opacity="0.9"/>
        <defs>
          <linearGradient id="tg1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/>
          </linearGradient>
          <linearGradient id="tg2" x1="10" y1="9" x2="22" y2="23" gradientUnits="userSpaceOnUse">
            <stop stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <div class="message-bubble-wrap">
      <div class="message-sender">aurora</div>
      <div class="message-bubble">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>`;
  messagesContainer.appendChild(row);
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showError(message) {
  const row = document.createElement('div');
  row.className = 'message-row model';
  row.innerHTML = `
    <div class="message-avatar model-avatar" style="background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.2);">⚠️</div>
    <div class="message-bubble-wrap">
      <div class="message-sender" style="color:#ef4444;">Error</div>
      <div class="message-bubble" style="border-color:rgba(239,68,68,0.2);background:rgba(239,68,68,0.06);">
        ${escapeHtml(message)}
      </div>
    </div>`;
  messagesContainer.appendChild(row);
  scrollToBottom();
}

function showWelcome(show) {
  welcomeScreen.classList.toggle('hidden', !show);
  messagesContainer.classList.toggle('hidden', show);
}

function scrollToBottom() {
  chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sidebar  
function isMobile() {
  return window.innerWidth <= 768;
}

function openSidebar() {
  sidebar.classList.remove('collapsed');
  if (isMobile()) {
    sidebar.classList.add('mobile-open');
    sidebarOverlay.classList.add('active');
  }
}

function closeSidebar() {
  sidebarOverlay.classList.remove('active');
  if (isMobile()) {
    sidebar.classList.remove('mobile-open');
  } else {
    sidebar.classList.add('collapsed');
  }
}

function toggleSidebar() {
  if (isMobile()) {
    if (sidebar.classList.contains('mobile-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  } else {
    sidebarOverlay.classList.remove('active');
    sidebar.classList.toggle('collapsed');
  }
}

// Auto-resize Textarea
function autoResizeTextarea() {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  btnSend.disabled = messageInput.value.trim() === '' || state.isStreaming;
}

// Event Listeners
btnNewChat.addEventListener('click', createNewSession);
btnToggleSidebar.addEventListener('click', closeSidebar);
btnSidebarMobile.addEventListener('click', toggleSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

btnClearChat.addEventListener('click', async () => {
  if (!state.currentSessionId) return;
  if (!confirm('Delete this chat?')) return;
  await deleteSession({ stopPropagation: () => { } }, state.currentSessionId);
});

btnSend.addEventListener('click', sendMessage);

messageInput.addEventListener('input', autoResizeTextarea);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Suggestion cards
suggestionGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.suggestion-card');
  if (!card) return;
  const prompt = card.dataset.prompt;
  messageInput.value = prompt;
  autoResizeTextarea();
  messageInput.focus();
  sendMessage();
});

// Init
async function init() {
  await checkHealth();
  await loadSessions();

  // Show welcome on load
  showWelcome(true);
  messageInput.focus();
}

init();
