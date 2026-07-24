import {
  Cpu, Home, Zap, Settings, User, Send, Loader2, Activity,
  Users, ChevronLeft, ChevronRight, Copy, RefreshCw, ThumbsUp,
  MoreHorizontal, Square, Plus, Check, Clock, Brain, Globe, Plug,
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useSettings, TRANSLATIONS } from '@/hooks/use-settings';

interface DashboardProps {
  userName: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
  stoppedByUser?: boolean;
  timestamp?: number;
  model?: string;
  responseMs?: number;
  liked?: boolean;
  // For chips
  chipKind?: 'text' | 'lua';
  chipLines?: number;
  chipRaw?: string;
}

interface AIStatusData {
  provider: string;
  model: string;
  fallbackChain: string[];
  configured: boolean;
  status: 'online' | 'missing_key';
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

// ── Theme helper ──────────────────────────────
function mkTheme(isDark: boolean) {
  return isDark
    ? {
        bg: 'linear-gradient(180deg,#0a0a0a 0%,#111 40%,#000 100%)',
        sidebar: 'rgba(14,14,14,0.96)',
        sidebarShadow: '0 30px 70px rgba(0,0,0,.5)',
        sidebarBorder: '1px solid rgba(255,255,255,0.07)',
        card: '#181818',
        cardBorder: 'rgba(255,255,255,0.07)',
        text: '#f0f0f0',
        textSub: '#888',
        main: 'rgba(15,15,15,0.97)',
        mainShadow: '0 42px 120px rgba(0,0,0,.5)',
        navActive: '#f0f0f0',
        navActiveText: '#111',
        navHover: 'rgba(255,255,255,0.06)',
        inputBg: '#1c1c1c',
        inputBorder: '#333',
        inputFocus: '#666',
        userMsg: '#e8e8e8',
        userMsgText: '#111',
        aiMsg: '#1e1e1e',
        aiMsgText: '#e8e8e8',
        divider: 'rgba(255,255,255,0.07)',
        statBg: '#181818',
        tagBg: '#252525',
        tagText: '#aaa',
        errorBg: '#2d0e0e',
        errorBorder: '#5c1a1a',
        errorText: '#f87171',
        modalBg: 'rgba(0,0,0,0.8)',
        modalCard: '#161616',
      }
    : {
        bg: 'linear-gradient(180deg,#fff 0%,#e8e8e8 40%,#111 100%)',
        sidebar: 'rgba(255,255,255,0.88)',
        sidebarShadow: '0 30px 70px rgba(0,0,0,.08)',
        sidebarBorder: 'none',
        card: '#f9fafb',
        cardBorder: '#f0f0f0',
        text: '#111',
        textSub: '#6b7280',
        main: 'rgba(255,255,255,0.94)',
        mainShadow: '0 42px 120px rgba(0,0,0,.12)',
        navActive: '#111',
        navActiveText: '#fff',
        navHover: '#f9fafb',
        inputBg: '#f9fafb',
        inputBorder: '#e5e7eb',
        inputFocus: '#111',
        userMsg: '#111',
        userMsgText: '#fff',
        aiMsg: '#f3f4f6',
        aiMsgText: '#111',
        divider: '#f3f4f6',
        statBg: '#f9fafb',
        tagBg: '#f3f4f6',
        tagText: '#9ca3af',
        errorBg: '#fef2f2',
        errorBorder: '#fecaca',
        errorText: '#dc2626',
        modalBg: 'rgba(0,0,0,0.6)',
        modalCard: '#fff',
      };
}

// ── Plugin Status hook ────────────────────────
interface PluginSession {
  sessionId:   string;
  placeId:     string | null;
  username:    string | null;
  placeName:   string | null;
  connectedAt: number;
  lastSeen:    number;
}

interface PluginStatusData {
  connected: boolean;
  sessions:  PluginSession[];
}

function usePluginStatus() {
  const [data, setData] = useState<PluginStatusData | null>(null);
  async function fetch_() {
    try {
      const r = await fetch(`${BASE}/api/plugin-status`);
      if (r.ok) setData(await r.json());
    } catch { /* non-fatal */ }
  }
  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, 4_000);
    return () => clearInterval(t);
  }, []);
  return data;
}

// ── AI Status hook ────────────────────────────
function useAIStatus() {
  const [data, setData] = useState<AIStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  async function fetch_() {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) setData(await r.json());
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }
  useEffect(() => { fetch_(); const t = setInterval(fetch_, 60_000); return () => clearInterval(t); }, []);
  return { data, loading, refetch: fetch_ };
}

// ── Chat hook ─────────────────────────────────
function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startTimeRef = useRef<number>(0);

  const THINKING_STATES = ['Thinking...', 'Checking...', 'Working...', 'Responding...'];
  const [thinkingState, setThinkingState] = useState(0);

  useEffect(() => {
    if (!loading) { setThinkingState(0); return; }
    const interval = setInterval(() => {
      setThinkingState(s => (s + 1) % THINKING_STATES.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [loading]);

  async function send(text: string, rawContent?: string) {
    if (!text.trim() || loading) return;
    abortRef.current = new AbortController();
    startTimeRef.current = Date.now();

    const userMsg: Message = { role: 'user', content: text.trim(), timestamp: Date.now() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    setActiveModel(null);

    const aiMsg: Message = { role: 'ai', content: '', timestamp: Date.now() };
    setMessages([...next, aiMsg]);

    // Build system prefix for modes
    const prefix = [
      thinkingMode ? '[DEEP THINK]' : '',
      searchMode ? '[SEARCH]' : '',
    ].filter(Boolean).join(' ');

    const messagesForApi = next.map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: (m.chipRaw || m.content),
    }));
    if (prefix) {
      messagesForApi[messagesForApi.length - 1].content = prefix + ' ' + messagesForApi[messagesForApi.length - 1].content;
    }

    let finalModel: string | null = null;
    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesForApi }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.model) { setActiveModel(parsed.model); finalModel = parsed.model; }
            if (parsed.done) continue;
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.content) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: updated[updated.length - 1].content + parsed.content,
                };
                return updated;
              });
            }
          } catch (e: unknown) {
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
          }
        }
      }

      const elapsed = Date.now() - startTimeRef.current;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          model: finalModel ?? undefined,
          responseMs: elapsed,
          timestamp: Date.now(),
        };
        return updated;
      });

    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        // User stopped generation
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            stoppedByUser: true,
            model: finalModel ?? undefined,
            responseMs: Date.now() - startTimeRef.current,
          };
          return updated;
        });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setMessages(prev => prev.slice(0, -1));
      }
    } finally {
      setLoading(false);
      setActiveModel(null);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function retry(index: number) {
    const userMsgIndex = index - 1;
    if (userMsgIndex < 0) return;
    const userMsg = messages[userMsgIndex];
    const trimmedMessages = messages.slice(0, userMsgIndex);
    setMessages(trimmedMessages);
    send(userMsg.chipRaw || userMsg.content);
  }

  function toggleLike(index: number) {
    setMessages(prev => prev.map((m, i) => i === index ? { ...m, liked: !m.liked } : m));
  }

  return {
    messages, input, setInput, loading, error, activeModel,
    thinkingMode, setThinkingMode, searchMode, setSearchMode,
    send, stop, retry, toggleLike, thinkingState, THINKING_STATES,
  };
}

// ── AFK hook ──────────────────────────────────
function useAFK(timeoutMs = 25 * 60 * 1000) {
  const [isAFK, setIsAFK] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setIsAFK(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsAFK(true), timeoutMs);
  }, [timeoutMs]);

  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach(e => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reset]);

  return { isAFK, dismiss: reset };
}

// ── AI Status Card ────────────────────────────
function AIStatusCard({ compact = false, isDark }: { compact?: boolean; isDark: boolean }) {
  const { data, loading } = useAIStatus();
  const online = data?.configured === true;
  const dotColor = loading ? '#f59e0b' : online ? '#22c55e' : '#ef4444';
  const statusText = loading ? 'Checking…' : online ? 'Online' : 'Key not set';
  const T = TRANSLATIONS['en'];
  const th = mkTheme(isDark);

  const modelShort = (m: string) => {
    const part = m.split('/')[1]?.split(':')[0] || m;
    return part.length > 18 ? part.slice(0, 16) + '…' : part;
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block',
          boxShadow: online ? `0 0 6px ${dotColor}88` : 'none' }} />
        <span style={{ fontSize: '0.75rem', color: th.textSub, fontWeight: 600 }}>{statusText}</span>
      </div>
    );
  }

  return (
    <div style={{ background: th.card, borderRadius: '16px', padding: '1.25rem', border: `1px solid ${th.cardBorder}`, display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={16} color={th.textSub} strokeWidth={2} />
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: th.text, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{T.aiStatus}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block',
            boxShadow: online && !loading ? `0 0 7px ${dotColor}88` : 'none', transition: 'background 0.3s, box-shadow 0.3s' }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: online ? '#16a34a' : th.textSub }}>{statusText}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          padding: '2px 8px', background: th.text, color: isDark ? '#111' : '#fff', borderRadius: '20px', flexShrink: 0 }}>
          {data?.provider ?? 'OpenRouter'}
        </span>
        {data?.model && (
          <span style={{ fontSize: '0.75rem', color: th.textSub, fontFamily: 'monospace' }} title={data.model}>
            {modelShort(data.model)}
          </span>
        )}
      </div>
      {data?.fallbackChain && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: th.textSub, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>
            {T.fallbackChain}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {data.fallbackChain.map((m, i) => (
              <span key={m} title={m} style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
                background: i === 0 ? '#dcfce7' : th.tagBg, color: i === 0 ? '#16a34a' : th.tagText }}>
                {modelShort(m)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Community Modal ───────────────────────────
function CommunityModal({ onClose, isDark, lang }: { onClose: () => void; isDark: boolean; lang: keyof typeof TRANSLATIONS }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: th.modalBg, backdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div style={{ background: th.modalCard, borderRadius: '28px', padding: '2.5rem', maxWidth: 480, width: '90%',
        boxShadow: '0 40px 100px rgba(0,0,0,0.3)', border: `1px solid ${th.cardBorder}` }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ width: 64, height: 64, background: '#5865F2', borderRadius: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <svg width="34" height="26" viewBox="0 0 34 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M28.757 2.175A27.83 27.83 0 0 0 21.627 0c-.342.605-.742 1.42-.988 2.067a25.832 25.832 0 0 0-7.677 0C12.716 1.42 12.3.605 11.964 0A27.746 27.746 0 0 0 4.83 2.18C.695 8.342-.426 14.338.135 20.25c3.3 2.415 6.494 3.88 9.63 4.832A21.086 21.086 0 0 0 11.58 22.1a18.15 18.15 0 0 1-2.876-1.384c.241-.175.476-.357.703-.546C14.93 22.884 21.017 22.884 26.527 20.17c.23.19.465.371.703.546a18.112 18.112 0 0 1-2.88 1.387c.525 1.032 1.01 2.1 1.818 3.015 3.14-.952 6.337-2.417 9.636-4.835.684-7.144-1.14-13.08-4.047-17.108ZM11.337 16.63c-1.658 0-3.02-1.52-3.02-3.38 0-1.86 1.332-3.382 3.02-3.382 1.687 0 3.048 1.52 3.02 3.38 0 1.862-1.333 3.382-3.02 3.382Zm11.256 0c-1.658 0-3.02-1.52-3.02-3.38 0-1.86 1.332-3.382 3.02-3.382 1.687 0 3.048 1.52 3.02 3.38 0 1.862-1.333 3.382-3.02 3.382Z" fill="white"/>
            </svg>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: th.text, marginBottom: '0.5rem' }}>{T.joinCommunity}</h2>
          <p style={{ fontSize: '0.9rem', color: th.textSub, lineHeight: 1.7, maxWidth: 340, margin: '0 auto' }}>
            {T.communityDesc}
          </p>
        </div>

        <a href="https://discord.gg/ZRUameCvE9" target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem',
            background: '#5865F2', color: '#fff', padding: '1rem 2rem', borderRadius: '18px',
            fontWeight: 700, fontSize: '1rem', textDecoration: 'none', transition: 'all 0.2s',
            width: '100%', boxSizing: 'border-box' }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.9'; (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)'; }}>
          <svg width="22" height="17" viewBox="0 0 34 26" fill="none">
            <path d="M28.757 2.175A27.83 27.83 0 0 0 21.627 0c-.342.605-.742 1.42-.988 2.067a25.832 25.832 0 0 0-7.677 0C12.716 1.42 12.3.605 11.964 0A27.746 27.746 0 0 0 4.83 2.18C.695 8.342-.426 14.338.135 20.25c3.3 2.415 6.494 3.88 9.63 4.832A21.086 21.086 0 0 0 11.58 22.1a18.15 18.15 0 0 1-2.876-1.384c.241-.175.476-.357.703-.546C14.93 22.884 21.017 22.884 26.527 20.17c.23.19.465.371.703.546a18.112 18.112 0 0 1-2.88 1.387c.525 1.032 1.01 2.1 1.818 3.015 3.14-.952 6.337-2.417 9.636-4.835.684-7.144-1.14-13.08-4.047-17.108ZM11.337 16.63c-1.658 0-3.02-1.52-3.02-3.38 0-1.86 1.332-3.382 3.02-3.382 1.687 0 3.048 1.52 3.02 3.38 0 1.862-1.333 3.382-3.02 3.382Zm11.256 0c-1.658 0-3.02-1.52-3.02-3.38 0-1.86 1.332-3.382 3.02-3.382 1.687 0 3.048 1.52 3.02 3.38 0 1.862-1.333 3.382-3.02 3.382Z" fill="white"/>
          </svg>
          Zenith IA — Discord
        </a>

        <button onClick={onClose}
          style={{ marginTop: '1rem', width: '100%', background: 'transparent', border: `1px solid ${th.divider}`,
            borderRadius: '18px', padding: '0.75rem', color: th.textSub, fontWeight: 600, cursor: 'pointer',
            fontSize: '0.9rem', transition: 'all 0.2s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : '#f9fafb'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
          Close
        </button>
      </div>
    </div>
  );
}

// ── AFK Screen ────────────────────────────────
function AFKScreen({ userName, onDismiss, isDark, lang }: { userName: string; onDismiss: () => void; isDark: boolean; lang: keyof typeof TRANSLATIONS }) {
  const T = TRANSLATIONS[lang];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(20px)' }}>
      <div style={{ textAlign: 'center', padding: '3rem', maxWidth: 420, width: '90%' }}>
        <div style={{ width: 80, height: 80, background: isDark ? '#222' : '#fff', borderRadius: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
          <Clock size={40} color={isDark ? '#888' : '#9ca3af'} strokeWidth={1.5} />
        </div>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, color: '#fff', marginBottom: '0.75rem', textShadow: '0 2px 20px rgba(0,0,0,0.5)' }}>
          {T.afkTitle(userName)}
        </h2>
        <button onClick={onDismiss}
          style={{ marginTop: '2rem', background: '#fff', color: '#111', padding: '1rem 3rem', borderRadius: '18px',
            fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
            boxShadow: '0 10px 30px rgba(255,255,255,0.2)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px) scale(1.02)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0) scale(1)'; }}>
          {T.afkButton}
        </button>
      </div>
    </div>
  );
}

// ── Message chip display ──────────────────────
function MessageChip({ kind, lines, isDark }: { kind: 'text' | 'lua'; lines: number; isDark: boolean }) {
  const th = mkTheme(isDark);
  const label = kind === 'lua' ? 'Lua-Pasted' : 'Text-Pasted';
  const icon = kind === 'lua' ? '📄' : '📋';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '0.5rem 1rem',
      background: isDark ? '#1a2a1a' : '#f0fdf4', border: `1px solid ${isDark ? '#2a4a2a' : '#bbf7d0'}`,
      borderRadius: '12px', fontSize: '0.85rem', color: isDark ? '#86efac' : '#16a34a', fontWeight: 600 }}>
      <span>{icon}</span>
      <span>{label}</span>
      <span style={{ fontWeight: 400, color: th.textSub, fontSize: '0.78rem' }}>{lines} lines</span>
    </div>
  );
}

// ── Message actions ───────────────────────────
function MessageActions({ msg, index, isDark, lang, onRetry, onToggleLike }:
  { msg: Message; index: number; isDark: boolean; lang: keyof typeof TRANSLATIONS; onRetry: (i: number) => void; onToggleLike: (i: number) => void }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);
  const [copied, setCopied] = useState(false);
  const [showMore, setShowMore] = useState(false);

  function copy() {
    navigator.clipboard.writeText(msg.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  const btnStyle = (active = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '4px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    background: active ? (isDark ? 'rgba(255,255,255,0.1)' : '#f0f0f0') : 'transparent',
    color: th.textSub, fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.15s',
  });

  const fmtMs = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const modelShort = (m: string) => m.split('/')[1]?.split(':')[0] || m;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', position: 'relative' }}>
      <button style={btnStyle(copied)} onClick={copy}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {T.copy}
      </button>
      <button style={btnStyle()} onClick={() => onRetry(index)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
        <RefreshCw size={12} /> {T.again}
      </button>
      <button style={btnStyle(msg.liked)} onClick={() => onToggleLike(index)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
        <ThumbsUp size={12} color={msg.liked ? '#22c55e' : undefined} /> {T.like}
      </button>
      <button style={btnStyle(showMore)} onClick={() => setShowMore(v => !v)}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
        <MoreHorizontal size={12} /> {T.more}
      </button>

      {showMore && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
          background: isDark ? '#222' : '#fff', border: `1px solid ${th.divider}`, borderRadius: '12px',
          padding: '0.75rem', fontSize: '0.75rem', color: th.textSub, zIndex: 50,
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)', minWidth: 200 }}>
          {msg.timestamp && <div style={{ marginBottom: '6px' }}><strong style={{ color: th.text }}>{T.time}:</strong> {fmtTime(msg.timestamp)}</div>}
          {msg.model && <div style={{ marginBottom: '6px' }}><strong style={{ color: th.text }}>{T.model}:</strong> {modelShort(msg.model)}</div>}
          {msg.responseMs && <div><strong style={{ color: th.text }}>{T.responseTime}:</strong> {fmtMs(msg.responseMs)}</div>}
        </div>
      )}
    </div>
  );
}

// ── Plus menu ─────────────────────────────────
function PlusMenu({ thinkingMode, searchMode, onToggleThinking, onToggleSearch, onClose, isDark, lang }:
  { thinkingMode: boolean; searchMode: boolean; onToggleThinking: () => void; onToggleSearch: () => void; onClose: () => void; isDark: boolean; lang: keyof typeof TRANSLATIONS }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  return (
    <div ref={ref} style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: '8px',
      background: isDark ? '#1e1e1e' : '#fff', border: `1px solid ${th.divider}`, borderRadius: '16px',
      padding: '0.5rem', boxShadow: '0 10px 30px rgba(0,0,0,0.2)', zIndex: 50, minWidth: 200 }}>
      {[
        { key: 'thinking', label: T.thinking, active: thinkingMode, icon: Brain, toggle: onToggleThinking },
        { key: 'search', label: T.searchInternet, active: searchMode, icon: Globe, toggle: onToggleSearch },
      ].map(({ key, label, active, icon: Icon, toggle }) => (
        <button key={key} onClick={toggle}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '0.625rem 0.875rem',
            borderRadius: '10px', border: 'none', cursor: 'pointer', textAlign: 'left',
            background: active ? (isDark ? 'rgba(255,255,255,0.08)' : '#f0f0f0') : 'transparent',
            color: active ? (isDark ? '#f0f0f0' : '#111') : th.textSub, fontWeight: 600, fontSize: '0.875rem', transition: 'all 0.15s' }}
          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.04)' : '#f9f9f9'; }}
          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
          <Icon size={16} strokeWidth={2} />
          {label}
          {active && <Check size={14} style={{ marginLeft: 'auto' }} color="#22c55e" />}
        </button>
      ))}
    </div>
  );
}

// ── Settings Panel ────────────────────────────
function SettingsPanel({ isDark, lang, onSetTheme, onSetLang }:
  { isDark: boolean; lang: keyof typeof TRANSLATIONS; onSetTheme: (t: 'light' | 'dark') => void; onSetLang: (l: 'en' | 'es') => void }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);

  const sectionStyle: React.CSSProperties = {
    background: th.card, borderRadius: '20px', padding: '1.5rem',
    border: `1px solid ${th.cardBorder}`, display: 'flex', flexDirection: 'column', gap: '1rem',
  };

  const labelStyle: React.CSSProperties = {
    fontWeight: 700, fontSize: '0.78rem', color: th.textSub,
    letterSpacing: '0.08em', textTransform: 'uppercase',
  };

  const optRow: React.CSSProperties = {
    display: 'flex', gap: '0.75rem',
  };

  function OptionBtn({ value, current, label, onClick }: { value: string; current: string; label: string; onClick: () => void }) {
    const active = value === current;
    return (
      <button onClick={onClick}
        style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: '14px', border: `2px solid ${active ? th.text : th.cardBorder}`,
          background: active ? th.text : 'transparent', color: active ? (isDark ? '#111' : '#fff') : th.textSub,
          fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', transition: 'all 0.2s' }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.04)' : '#f9fafb'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
        {label}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: 520, width: '100%', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: th.text }}>{T.settings}</h2>

      {/* Theme */}
      <div style={sectionStyle}>
        <div style={labelStyle}>{T.themeLabel}</div>
        <div style={optRow}>
          <OptionBtn value="light" current={isDark ? 'dark' : 'light'} label={T.lightTheme} onClick={() => onSetTheme('light')} />
          <OptionBtn value="dark" current={isDark ? 'dark' : 'light'} label={T.darkTheme} onClick={() => onSetTheme('dark')} />
        </div>
      </div>

      {/* Language */}
      <div style={sectionStyle}>
        <div style={labelStyle}>{T.langLabel}</div>
        <div style={optRow}>
          <OptionBtn value="en" current={lang} label={T.langEn} onClick={() => onSetLang('en')} />
          <OptionBtn value="es" current={lang} label={T.langEs} onClick={() => onSetLang('es')} />
        </div>
      </div>
    </div>
  );
}

// ── Assistant Panel ───────────────────────────
function AssistantPanel({ isDark, lang }: { isDark: boolean; lang: keyof typeof TRANSLATIONS }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);
  const {
    messages, input, setInput, loading, error, activeModel,
    thinkingMode, setThinkingMode, searchMode, setSearchMode,
    send, stop, retry, toggleLike, thinkingState, THINKING_STATES,
  } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showPlus, setShowPlus] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function detectChip(text: string): { kind: 'text' | 'lua'; lines: number } | null {
    const lines = text.split('\n').length;
    const isLua = /^(local|function|if|for|while|repeat|return|--|\s*(game|workspace|script)\b)/m.test(text);
    if (isLua && lines >= 35) return { kind: 'lua', lines };
    if (!isLua && lines > 250) return { kind: 'text', lines };
    return null;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    if (!input.trim() || loading) return;
    const chip = detectChip(input);
    if (chip) {
      const label = chip.kind === 'lua' ? `Lua-Pasted (${chip.lines} lines)` : `Text-Pasted (${chip.lines} lines)`;
      send(label, input);
    } else {
      send(input);
    }
  }

  // Auto-resize textarea
  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  const modelShort = (m: string) => m.split('/')[1]?.split(':')[0] || m;
  const hasActiveModes = thinkingMode || searchMode;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${th.divider}`, paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: th.text }}>{T.zenithAssistant}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeModel && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', fontWeight: 600,
              padding: '3px 9px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: '20px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block',
                animation: 'zenithPulse 1.2s ease-in-out infinite' }} />
              {modelShort(activeModel)}
            </span>
          )}
          <AIStatusCard compact isDark={isDark} />
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '0.75rem' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: '1rem', color: th.textSub, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, background: th.text, borderRadius: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={32} color={isDark ? '#111' : '#fff'} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: 700, color: th.text, fontSize: '1.1rem', marginBottom: '0.5rem' }}>{T.aiReady}</div>
              <div style={{ fontSize: '0.875rem', maxWidth: 320, lineHeight: 1.6 }}>{T.aiDesc}</div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ maxWidth: '80%', padding: '0.875rem 1.125rem',
                  borderRadius: '20px 20px 6px 20px', background: th.userMsg, color: th.userMsgText,
                  fontSize: '1rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: "'Inter', sans-serif" }}>
                  {msg.chipKind ? (
                    <MessageChip kind={msg.chipKind} lines={msg.chipLines ?? 0} isDark={isDark} />
                  ) : msg.content}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                {/* AI Avatar */}
                <div style={{ width: 36, height: 36, background: th.text, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${isDark ? '#333' : '#1a1a1a'}`,
                  boxShadow: `0 0 0 3px ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'}` }}>
                  <Zap size={16} color={isDark ? '#111' : '#fff'} strokeWidth={2} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ maxWidth: '90%', padding: '0.875rem 1.125rem',
                    borderRadius: '20px 20px 20px 6px', background: th.aiMsg, color: th.aiMsgText,
                    fontSize: '1rem', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    fontFamily: "'Inter', sans-serif" }}>
                    {msg.content
                      ? msg.content
                      : loading && i === messages.length - 1
                        ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: th.textSub, fontSize: '0.9rem' }}>
                            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                            {THINKING_STATES[thinkingState]}
                          </span>
                        )
                        : null}
                    {msg.stoppedByUser && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: th.textSub, fontStyle: 'italic' }}>
                        {T.stoppedWriting}
                      </div>
                    )}
                  </div>
                  {msg.content && !loading && (
                    <MessageActions msg={msg} index={i} isDark={isDark} lang={lang} onRetry={retry} onToggleLike={toggleLike} />
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: th.errorBg,
            border: `1px solid ${th.errorBorder}`, borderRadius: 12, color: th.errorText, fontSize: '0.85rem' }}>
            Error: {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Active modes indicator */}
      {hasActiveModes && (
        <div style={{ display: 'flex', gap: '6px', paddingBottom: '0.5rem' }}>
          {thinkingMode && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px',
              background: isDark ? '#1e1a2e' : '#ede9fe', color: isDark ? '#c4b5fd' : '#7c3aed',
              borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
              <Brain size={11} /> {T.thinking}
            </span>
          )}
          {searchMode && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px',
              background: isDark ? '#1a2a1e' : '#ecfdf5', color: isDark ? '#86efac' : '#059669',
              borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600 }}>
              <Globe size={11} /> Search
            </span>
          )}
        </div>
      )}

      {/* Input */}
      <div style={{ borderTop: `1px solid ${th.divider}`, paddingTop: '1rem', display: 'flex', gap: '0.625rem', alignItems: 'flex-end', position: 'relative' }}>
        {/* Plus button */}
        <div style={{ position: 'relative' }}>
          {showPlus && (
            <PlusMenu
              thinkingMode={thinkingMode} searchMode={searchMode}
              onToggleThinking={() => setThinkingMode(v => !v)}
              onToggleSearch={() => setSearchMode(v => !v)}
              onClose={() => setShowPlus(false)}
              isDark={isDark} lang={lang}
            />
          )}
          <button onClick={() => setShowPlus(v => !v)}
            style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: showPlus || hasActiveModes ? th.text : (isDark ? '#2a2a2a' : '#f3f4f6'),
              border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
            <Plus size={18} color={showPlus || hasActiveModes ? (isDark ? '#111' : '#fff') : th.textSub} strokeWidth={2} />
          </button>
        </div>

        <textarea ref={textareaRef} value={input} onChange={onInputChange} onKeyDown={onKeyDown}
          placeholder={T.placeholder} rows={1} disabled={loading}
          style={{ flex: 1, resize: 'none', border: `2px solid ${th.inputBorder}`, borderRadius: 16,
            padding: '0.75rem 1rem', fontSize: '1rem', fontFamily: "'Inter', sans-serif",
            outline: 'none', background: th.inputBg, color: th.text, lineHeight: 1.5,
            maxHeight: 120, overflowY: 'auto', transition: 'border-color 0.2s',
            boxSizing: 'border-box' }}
          onFocus={e => (e.currentTarget.style.borderColor = th.inputFocus)}
          onBlur={e => (e.currentTarget.style.borderColor = th.inputBorder)}
        />

        {/* Send / Stop */}
        {loading ? (
          <button onClick={stop}
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: '#ef4444', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(239,68,68,0.4)' }}>
            <Square size={16} color="#fff" strokeWidth={2} fill="#fff" />
          </button>
        ) : (
          <button onClick={handleSend} disabled={!input.trim()}
            style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: !input.trim() ? (isDark ? '#2a2a2a' : '#e5e7eb') : th.text,
              border: 'none', cursor: !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
            <Send size={18} color={input.trim() ? (isDark ? '#111' : '#fff') : th.textSub} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Home Panel ────────────────────────────────
function HomePanel({ userName, isDark, lang }: { userName: string; isDark: boolean; lang: keyof typeof TRANSLATIONS }) {
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '2rem', textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, background: th.text, borderRadius: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Cpu size={40} color={isDark ? '#111' : '#fff'} strokeWidth={2} />
      </div>
      <div>
        <h1 style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', fontWeight: 700, color: th.text, marginBottom: '0.75rem' }}>
          {T.welcomeTitle(userName)}
        </h1>
        <p style={{ color: th.textSub, lineHeight: 1.85, fontSize: '1rem', maxWidth: 480 }}>{T.welcomeDesc}</p>
      </div>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <AIStatusCard isDark={isDark} />
      </div>
      <div style={{ background: th.card, borderRadius: 16, padding: '1.25rem 1.5rem',
        border: `1px solid ${th.cardBorder}`, textAlign: 'left', maxWidth: 460, width: '100%' }}>
        <div style={{ fontWeight: 700, color: th.text, marginBottom: '0.75rem', fontSize: '0.9rem' }}>{T.serverUrl}</div>
        <code style={{ fontSize: '0.8rem', color: th.textSub, wordBreak: 'break-all',
          background: isDark ? '#111' : '#fff', padding: '0.5rem 0.75rem', borderRadius: 8,
          display: 'block', border: `1px solid ${th.divider}` }}>
          {window.location.origin}
        </code>
        <div style={{ fontSize: '0.78rem', color: th.textSub, marginTop: '0.5rem' }}>{T.endpoints}</div>
      </div>
    </div>
  );
}

// ── Studio Connection Badge ───────────────────
function StudioBadge({ pluginStatus, isDark, compact }: { pluginStatus: PluginStatusData | null; isDark: boolean; compact?: boolean }) {
  const th = mkTheme(isDark);
  const connected = pluginStatus?.connected ?? false;
  const session   = pluginStatus?.sessions?.[0] ?? null;

  if (compact) {
    return (
      <div title={connected ? `Place ${session?.placeId ?? '?'} — ID ${session?.username ?? '?'}` : 'No Studio plugin connected'}
        style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#22c55e' : '#6b7280',
          boxShadow: connected ? '0 0 6px #22c55e88' : 'none', flexShrink: 0, display: 'inline-block', transition: 'all 0.3s' }} />
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: connected ? '#22c55e' : th.textSub }}>
          {connected ? 'Studio' : 'No Studio'}
        </span>
      </div>
    );
  }

  return (
    <div style={{ background: connected ? (isDark ? '#0d2618' : '#f0fdf4') : th.card,
      border: `1px solid ${connected ? (isDark ? '#1a4530' : '#bbf7d0') : th.cardBorder}`,
      borderRadius: 14, padding: '0.75rem 0.875rem', transition: 'all 0.3s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: session ? '0.5rem' : 0 }}>
        <Plug size={13} color={connected ? '#22c55e' : th.textSub} strokeWidth={2} />
        <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: connected ? '#22c55e' : th.textSub }}>
          {connected ? 'Studio conectado' : 'Studio desconectado'}
        </span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#22c55e' : '#6b7280',
          boxShadow: connected ? '0 0 5px #22c55e88' : 'none', marginLeft: 'auto', flexShrink: 0,
          transition: 'all 0.3s', display: 'inline-block' }} />
      </div>
      {connected && session && (
        <div style={{ fontSize: '0.7rem', color: th.textSub, lineHeight: 1.5, paddingLeft: '1px' }}>
          {session.placeId && <div>Place: <span style={{ fontFamily: 'monospace', color: th.text }}>{session.placeId}</span></div>}
          {session.username && <div>Dev ID: <span style={{ fontFamily: 'monospace', color: th.text }}>{session.username}</span></div>}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────
export default function Dashboard({ userName }: DashboardProps) {
  const { settings, setTheme, setLanguage } = useSettings();
  const isDark = settings.theme === 'dark';
  const lang = settings.language;
  const T = TRANSLATIONS[lang];
  const th = mkTheme(isDark);
  const pluginStatus = usePluginStatus();

  const [activeNav, setActiveNav] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCommunity, setShowCommunity] = useState(false);
  const { isAFK, dismiss: dismissAFK } = useAFK();

  const navItems = [
    { id: 'home',      label: T.home,      icon: Home },
    { id: 'assistant', label: T.assistant, icon: Zap },
    { id: 'community', label: T.community, icon: Users },
    { id: 'settings',  label: T.settings,  icon: Settings },
  ];

  function handleNav(id: string) {
    if (id === 'community') { setShowCommunity(true); return; }
    setActiveNav(id);
  }

  const SIDEBAR_W = sidebarOpen ? 260 : 72;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ background: th.bg, position: 'relative' }}>

      <style>{`
        @keyframes spin       { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes zenithPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.8); } }
        * { font-family: 'Inter', sans-serif; }
      `}</style>

      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 50% 0%,rgba(255,255,255,.1),transparent 60%)',
        pointerEvents: 'none' }} />

      {/* AFK overlay */}
      {isAFK && <AFKScreen userName={userName} onDismiss={dismissAFK} isDark={isDark} lang={lang} />}

      {/* Community modal */}
      {showCommunity && <CommunityModal onClose={() => setShowCommunity(false)} isDark={isDark} lang={lang} />}

      <div className="relative z-10 w-full flex gap-6"
        style={{ maxWidth: 1200, height: 'calc(100vh - 3rem)', minHeight: 600 }}>

        {/* Sidebar */}
        <aside style={{
          width: SIDEBAR_W, flexShrink: 0, transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
          background: th.sidebar, borderRadius: 28,
          boxShadow: th.sidebarShadow, border: th.sidebarBorder,
          backdropFilter: 'blur(18px)', padding: '1.75rem 1.25rem',
          display: 'flex', flexDirection: 'column', gap: '1.5rem', overflow: 'hidden',
        }}>
          {/* Brand + Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'space-between' : 'center' }}>
            {sidebarOpen && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
                <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="Zenith"
                  style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display='none'; }} />
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: th.text, whiteSpace: 'nowrap' }}>Zenith</h2>
              </div>
            )}
            <button onClick={() => setSidebarOpen(v => !v)}
              style={{ width: 32, height: 32, borderRadius: 10, border: `1px solid ${th.divider}`,
                background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.2s', color: th.textSub }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
              {sidebarOpen ? <ChevronLeft size={16} color={th.textSub} /> : <ChevronRight size={16} color={th.textSub} />}
            </button>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activeNav === id && id !== 'community';
              return (
                <button key={id} onClick={() => handleNav(id)}
                  title={!sidebarOpen ? label : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: sidebarOpen ? '0.75rem 1rem' : '0.75rem', borderRadius: 16,
                    justifyContent: sidebarOpen ? 'flex-start' : 'center',
                    background: active ? th.navActive : 'transparent',
                    color: active ? th.navActiveText : th.textSub,
                    border: 'none', cursor: 'pointer', fontSize: '0.95rem',
                    fontWeight: 600, transition: 'all 0.2s', textAlign: 'left',
                    whiteSpace: 'nowrap', overflow: 'hidden' }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = th.navHover; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  <Icon size={20} strokeWidth={2} style={{ flexShrink: 0 }} />
                  {sidebarOpen && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>}
                </button>
              );
            })}
          </nav>

          {/* Studio Connection badge */}
          {sidebarOpen
            ? <StudioBadge pluginStatus={pluginStatus} isDark={isDark} />
            : <StudioBadge pluginStatus={pluginStatus} isDark={isDark} compact />
          }

          {/* AI Status — compact when collapsed */}
          {sidebarOpen && (
            <div style={{ background: th.card, borderRadius: 14, padding: '0.75rem 0.875rem', border: `1px solid ${th.cardBorder}` }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: th.textSub, marginBottom: '0.5rem' }}>{T.aiStatus}</div>
              <AIStatusCard compact={false} isDark={isDark} />
            </div>
          )}

          <div style={{ flex: 1 }} />

          {/* User footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: sidebarOpen ? '0.875rem 1rem' : '0.625rem',
            background: th.card, borderRadius: 16, justifyContent: sidebarOpen ? 'flex-start' : 'center',
            border: `1px solid ${th.cardBorder}` }}>
            <div style={{ width: 36, height: 36, background: th.text, borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={18} color={isDark ? '#111' : '#fff'} strokeWidth={2} />
            </div>
            {sidebarOpen && (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: th.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  data-testid="text-username">{userName}</div>
                <div style={{ fontSize: '0.72rem', color: th.textSub }}>{T.connected}</div>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main style={{
          flex: 1, background: th.main, borderRadius: 36,
          boxShadow: th.mainShadow, backdropFilter: 'blur(18px)',
          padding: 'clamp(1.5rem,3vw,2.5rem)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}>
          {activeNav === 'home'      && <HomePanel userName={userName} isDark={isDark} lang={lang} />}
          {activeNav === 'assistant' && <AssistantPanel isDark={isDark} lang={lang} />}
          {activeNav === 'settings'  && (
            <SettingsPanel isDark={isDark} lang={lang} onSetTheme={setTheme} onSetLang={setLanguage} />
          )}
        </main>
      </div>
    </div>
  );
}
