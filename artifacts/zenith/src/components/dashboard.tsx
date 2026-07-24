import { Cpu, Home, Zap, Settings, User, Send, Loader2, Activity } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface DashboardProps {
  userName: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface AIStatusData {
  provider: string;
  model: string;
  fallbackChain: string[];
  configured: boolean;
  status: 'online' | 'missing_key';
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

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

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, 60_000);
    return () => clearInterval(t);
  }, []);

  return { data, loading, refetch: fetch_ };
}

// ── Chat hook ─────────────────────────────────
function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<string | null>(null);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);
    setActiveModel(null);

    const aiMsg: Message = { role: 'ai', content: '' };
    setMessages([...next, aiMsg]);

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
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
            if (parsed.model) setActiveModel(parsed.model);
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      setActiveModel(null);
    }
  }

  return { messages, input, setInput, loading, error, activeModel, send };
}

// ── AI Status Component ───────────────────────
function AIStatusCard({ compact = false }: { compact?: boolean }) {
  const { data, loading } = useAIStatus();

  const online = data?.configured === true;
  const dotColor = loading ? '#f59e0b' : online ? '#22c55e' : '#ef4444';
  const statusText = loading ? 'Checking…' : online ? 'Online' : 'Key not set';

  const modelShort = (m: string) => {
    const part = m.split('/')[1]?.split(':')[0] || m;
    return part.length > 18 ? part.slice(0, 16) + '…' : part;
  };

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block',
          boxShadow: online ? `0 0 6px ${dotColor}88` : 'none' }} />
        <span style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 600 }}>{statusText}</span>
      </div>
    );
  }

  return (
    <div style={{
      background: '#f9fafb',
      borderRadius: '16px',
      padding: '1.25rem',
      border: '1px solid #f0f0f0',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.875rem',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={16} color="#6b7280" strokeWidth={2} />
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#374151', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            AI Status
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: dotColor, flexShrink: 0, display: 'inline-block',
            boxShadow: online && !loading ? `0 0 7px ${dotColor}88` : 'none',
            transition: 'background 0.3s, box-shadow 0.3s',
          }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: online ? '#16a34a' : '#6b7280' }}>
            {statusText}
          </span>
        </div>
      </div>

      {/* Provider row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', padding: '2px 8px',
          background: '#111', color: '#fff', borderRadius: '20px', flexShrink: 0,
        }}>
          {data?.provider ?? 'OpenRouter'}
        </span>
        {data?.model && (
          <span style={{ fontSize: '0.75rem', color: '#6b7280', fontFamily: 'monospace' }}
                title={data.model}>
            {modelShort(data.model)}
          </span>
        )}
      </div>

      {/* Fallback chain */}
      {data?.fallbackChain && (
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#9ca3af',
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' }}>
            Fallback chain
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {data.fallbackChain.map((m, i) => (
              <span key={m} title={m} style={{
                fontSize: '0.7rem', fontWeight: 600,
                padding: '2px 8px', borderRadius: '20px',
                background: i === 0 ? '#dcfce7' : '#f3f4f6',
                color: i === 0 ? '#16a34a' : '#9ca3af',
              }}>
                {modelShort(m)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assistant panel ───────────────────────────
function AssistantPanel() {
  const { messages, input, setInput, loading, error, activeModel, send } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  const modelShort = (m: string) => m.split('/')[1]?.split(':')[0] || m;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #f3f4f6', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111' }}>Asistente Zenith</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeModel && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px',
              fontSize: '0.72rem', fontWeight: 600, padding: '3px 9px',
              background: '#f0fdf4', color: '#16a34a',
              border: '1px solid #bbf7d0', borderRadius: '20px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
                display: 'inline-block', animation: 'zenithPulse 1.2s ease-in-out infinite' }} />
              {modelShort(activeModel)}
            </span>
          )}
          <AIStatusCard compact />
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        gap: '1rem', paddingBottom: '0.75rem' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: '1rem', color: '#6b7280', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, background: '#111', borderRadius: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={32} color="#fff" strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#111', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                Zenith AI listo
              </div>
              <div style={{ fontSize: '0.875rem', maxWidth: 320, lineHeight: 1.6 }}>
                Pregunta sobre Lua, APIs de Roblox, GUIs, depuración o diseño de sistemas.
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%',
              padding: '0.875rem 1.125rem',
              borderRadius: msg.role === 'user' ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
              background: msg.role === 'user' ? '#111' : '#f3f4f6',
              color: msg.role === 'user' ? '#fff' : '#111',
              fontSize: '0.9rem', lineHeight: 1.65,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {msg.content || (loading && i === messages.length - 1
                ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                : '')}
            </div>
          </div>
        ))}

        {error && (
          <div style={{ padding: '0.75rem 1rem', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 12,
            color: '#dc2626', fontSize: '0.85rem' }}>
            Error: {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem',
        display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter nueva línea)"
          rows={1}
          disabled={loading}
          style={{ flex: 1, resize: 'none', border: '2px solid #e5e7eb', borderRadius: 16,
            padding: '0.75rem 1rem', fontSize: '0.9rem', fontFamily: 'inherit',
            outline: 'none', background: '#f9fafb', color: '#111',
            lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', transition: 'border-color 0.2s' }}
          onFocus={(e) => (e.currentTarget.style.borderColor = '#111')}
          onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()}
          style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: loading || !input.trim() ? '#e5e7eb' : '#111',
            border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
          {loading
            ? <Loader2 size={18} color="#9ca3af" strokeWidth={2} />
            : <Send size={18} color={input.trim() ? '#fff' : '#9ca3af'} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}

// ── Home panel ────────────────────────────────
function HomePanel({ userName }: { userName: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: '2rem', textAlign: 'center' }}>
      <div style={{ width: 80, height: 80, background: '#111', borderRadius: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Cpu size={40} color="#fff" strokeWidth={2} />
      </div>
      <div>
        <h1 style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', fontWeight: 700,
          color: '#111', marginBottom: '0.75rem' }}>
          Bienvenido, {userName}
        </h1>
        <p style={{ color: '#4b5563', lineHeight: 1.85, fontSize: '1rem', maxWidth: 480 }}>
          Tu compañero de IA para Roblox Studio está listo. Instala el plugin en Studio
          y conéctalo a esta URL para comenzar.
        </p>
      </div>

      {/* AI Status card */}
      <div style={{ width: '100%', maxWidth: 420 }}>
        <AIStatusCard />
      </div>

      {/* Server URL */}
      <div style={{ background: '#f9fafb', borderRadius: 16, padding: '1.25rem 1.5rem',
        border: '1px solid #e5e7eb', textAlign: 'left', maxWidth: 460, width: '100%' }}>
        <div style={{ fontWeight: 700, color: '#111', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          URL del servidor para el plugin
        </div>
        <code style={{ fontSize: '0.8rem', color: '#6b7280', wordBreak: 'break-all',
          background: '#fff', padding: '0.5rem 0.75rem', borderRadius: 8,
          display: 'block', border: '1px solid #e5e7eb' }}>
          {window.location.origin}
        </code>
        <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.5rem' }}>
          Endpoints: /api/connect · /api/heartbeat · /api/command_result
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────
export default function Dashboard({ userName }: DashboardProps) {
  const [activeNav, setActiveNav] = useState('home');

  const navItems = [
    { id: 'home',      label: 'Home',      icon: Home },
    { id: 'assistant', label: 'Asistente', icon: Zap },
    { id: 'settings',  label: 'Settings',  icon: Settings },
  ];

  const statusItems = [
    { label: 'Scripts', value: '24' },
    { label: 'Active',  value: '3'  },
    { label: 'Models',  value: '12' },
    { label: 'Saved',   value: '8'  },
  ];

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg,#fff 0%,#e8e8e8 40%,#111 100%)', position: 'relative' }}>

      <style>{`
        @keyframes spin       { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes zenithPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.8); } }
      `}</style>

      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 50% 0%,rgba(255,255,255,.1),transparent 60%)',
        pointerEvents: 'none' }} />

      <div className="relative z-10 w-full flex gap-6"
        style={{ maxWidth: 1200, height: 'calc(100vh - 3rem)', minHeight: 600 }}>

        {/* Sidebar */}
        <aside style={{
          width: 260, flexShrink: 0,
          background: 'rgba(255,255,255,.88)',
          borderRadius: 28,
          boxShadow: '0 30px 70px rgba(0,0,0,.08)',
          backdropFilter: 'blur(18px)',
          padding: '2rem',
          display: 'flex', flexDirection: 'column', gap: '1.5rem',
        }}>
          {/* Brand */}
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="Zenith"
              style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex';
              }} />
            <div style={{ width: 48, height: 48, background: '#111', borderRadius: 12,
              display: 'none', alignItems: 'center', justifyContent: 'center' }}>
              <Cpu size={24} color="#fff" strokeWidth={2} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111' }}>Zenith</h2>
          </div>

          {/* Nav */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {navItems.map(({ id, label, icon: Icon }) => {
              const active = activeNav === id;
              return (
                <button key={id} onClick={() => setActiveNav(id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.875rem 1.25rem', borderRadius: 20,
                    background: active ? '#111' : 'transparent',
                    color: active ? '#fff' : '#6b7280',
                    border: 'none', cursor: 'pointer', fontSize: '1rem',
                    fontWeight: 600, transition: 'all .2s', textAlign: 'left' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f9fafb'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                  <Icon size={20} strokeWidth={2} />
                  {label}
                </button>
              );
            })}
          </nav>

          {/* AI Status (compact) */}
          <div style={{ background: '#f9fafb', borderRadius: 16, padding: '0.875rem 1rem' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#9ca3af', marginBottom: '0.5rem' }}>
              AI Status
            </div>
            <AIStatusCard compact={false} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {statusItems.map(({ label, value }) => (
              <div key={label} style={{ background: '#f9fafb', borderRadius: 18,
                padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111', marginBottom: '0.2rem' }}>
                  {value}
                </div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* User footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem',
            padding: '1rem', background: '#f9fafb', borderRadius: 18 }}>
            <div style={{ width: 40, height: 40, background: '#111', borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={20} color="#fff" strokeWidth={2} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111' }}
                data-testid="text-username">{userName}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Conectado</div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main style={{
          flex: 1, background: 'rgba(255,255,255,.94)', borderRadius: 36,
          boxShadow: '0 42px 120px rgba(0,0,0,.12)', backdropFilter: 'blur(18px)',
          padding: 'clamp(1.5rem,3vw,2.5rem)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {activeNav === 'home'      && <HomePanel userName={userName} />}
          {activeNav === 'assistant' && <AssistantPanel />}
          {activeNav === 'settings'  && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', color: '#6b7280' }}>
              <Settings size={40} strokeWidth={1.5} style={{ marginBottom: '1rem', opacity: .4 }} />
              <p style={{ fontWeight: 600 }}>Configuración próximamente</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
