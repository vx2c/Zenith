import { Cpu, Home, Zap, Settings, User, Send, Loader2, Wifi, WifiOff } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface DashboardProps {
  userName: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setError(null);

    const aiMsg: Message = { role: 'ai', content: '' };
    setMessages([...next, aiMsg]);

    try {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        throw new Error(`Server error ${res.status}`);
      }

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
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.done) continue;
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
            if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
              throw e;
            }
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return { messages, input, setInput, loading, error, send };
}

function AssistantPanel() {
  const { messages, input, setInput, loading, error, send } = useChat();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          paddingBottom: '1rem',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '1rem',
              color: '#6b7280',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                background: '#111111',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Zap size={32} color="#ffffff" strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontWeight: '600', color: '#111111', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                Zenith AI listo
              </div>
              <div style={{ fontSize: '0.875rem', maxWidth: '320px', lineHeight: '1.6' }}>
                Pregunta sobre scripts Lua, APIs de Roblox, depuración o diseño de sistemas de juego.
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '0.875rem 1.125rem',
                borderRadius: msg.role === 'user' ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                background: msg.role === 'user' ? '#111111' : '#f3f4f6',
                color: msg.role === 'user' ? '#ffffff' : '#111111',
                fontSize: '0.9rem',
                lineHeight: '1.65',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.content || (loading && i === messages.length - 1 ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : '')}
            </div>
          </div>
        ))}

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '12px',
              color: '#dc2626',
              fontSize: '0.85rem',
            }}
          >
            Error: {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          borderTop: '1px solid #e5e7eb',
          paddingTop: '1rem',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'flex-end',
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe un mensaje... (Enter para enviar, Shift+Enter para nueva línea)"
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: '2px solid #e5e7eb',
            borderRadius: '16px',
            padding: '0.75rem 1rem',
            fontSize: '0.9rem',
            fontFamily: 'inherit',
            outline: 'none',
            background: '#f9fafb',
            color: '#111111',
            lineHeight: '1.5',
            maxHeight: '120px',
            overflowY: 'auto',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = '#111111')}
          onBlur={(e) => (e.currentTarget.style.borderColor = '#e5e7eb')}
          disabled={loading}
        />
        <button
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '12px',
            background: loading || !input.trim() ? '#e5e7eb' : '#111111',
            border: 'none',
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            flexShrink: 0,
          }}
        >
          {loading ? (
            <Loader2 size={18} color="#9ca3af" strokeWidth={2} />
          ) : (
            <Send size={18} color={input.trim() ? '#ffffff' : '#9ca3af'} strokeWidth={2} />
          )}
        </button>
      </div>
    </div>
  );
}

function HomePanel({ userName }: { userName: string }) {
  const [pluginStatus, setPluginStatus] = useState<'waiting' | 'connected'>('waiting');

  useEffect(() => {
    // Check if plugin has connected recently by polling heartbeat ack
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BASE}/api/healthz`);
        if (res.ok) setPluginStatus('connected');
      } catch {
        // keep waiting
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '2rem', textAlign: 'center' }}>
      <div
        style={{
          width: '80px',
          height: '80px',
          background: '#111111',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Cpu size={40} color="#ffffff" strokeWidth={2} />
      </div>
      <div>
        <h1 style={{ fontSize: 'clamp(1.75rem, 3vw, 2.5rem)', fontWeight: '700', color: '#111111', marginBottom: '0.75rem' }}>
          Bienvenido, {userName}
        </h1>
        <p style={{ color: '#4b5563', lineHeight: '1.85', fontSize: '1rem', maxWidth: '480px' }}>
          Tu compañero de IA para Roblox Studio está listo. Instala el plugin en Studio y conéctalo a esta URL para comenzar.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.5rem',
          background: '#f9fafb',
          borderRadius: '16px',
          border: '1px solid #e5e7eb',
        }}
      >
        {pluginStatus === 'connected' ? (
          <Wifi size={20} color="#16a34a" />
        ) : (
          <WifiOff size={20} color="#9ca3af" />
        )}
        <span style={{ fontSize: '0.9rem', color: pluginStatus === 'connected' ? '#16a34a' : '#6b7280', fontWeight: '600' }}>
          {pluginStatus === 'connected' ? 'Servidor activo — Plugin puede conectarse' : 'Esperando conexión del plugin...'}
        </span>
      </div>

      <div
        style={{
          background: '#f9fafb',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          border: '1px solid #e5e7eb',
          textAlign: 'left',
          maxWidth: '460px',
          width: '100%',
        }}
      >
        <div style={{ fontWeight: '700', color: '#111111', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          URL del servidor para el plugin
        </div>
        <code style={{ fontSize: '0.8rem', color: '#6b7280', wordBreak: 'break-all', background: '#ffffff', padding: '0.5rem 0.75rem', borderRadius: '8px', display: 'block', border: '1px solid #e5e7eb' }}>
          {window.location.origin}
        </code>
        <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.5rem' }}>
          Endpoints: /api/connect · /api/heartbeat · /api/command_result
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ userName }: DashboardProps) {
  const [activeNav, setActiveNav] = useState('home');

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'assistant', label: 'Asistente', icon: Zap },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const statusItems = [
    { label: 'Scripts', value: '24' },
    { label: 'Active', value: '3' },
    { label: 'Models', value: '12' },
    { label: 'Saved', value: '8' },
  ];

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 40%, #111111 100%)',
        position: 'relative',
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Radial overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.1), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      {/* Dashboard container */}
      <div
        className="relative z-10 w-full flex gap-6"
        style={{ maxWidth: '1200px', height: 'calc(100vh - 3rem)', minHeight: '600px' }}
      >
        {/* Sidebar */}
        <aside
          style={{
            width: '260px',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.88)',
            borderRadius: '28px',
            boxShadow: '0 30px 70px rgba(0,0,0,0.08)',
            backdropFilter: 'blur(18px)',
            padding: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '2rem',
          }}
        >
          {/* Brand */}
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}favicon.png`}
              alt="Zenith"
              style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover' }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex';
              }}
            />
            <div
              style={{
                width: '48px',
                height: '48px',
                background: '#111111',
                borderRadius: '12px',
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cpu size={24} color="#ffffff" strokeWidth={2} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#111111' }}>Zenith</h2>
          </div>

          {/* Navigation */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveNav(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.875rem 1.25rem',
                    borderRadius: '20px',
                    background: isActive ? '#111111' : 'transparent',
                    color: isActive ? '#ffffff' : '#6b7280',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  data-testid={`nav-${item.id}`}
                >
                  <Icon size={20} strokeWidth={2} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Status grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {statusItems.map((item) => (
              <div
                key={item.label}
                style={{ background: '#f9fafb', borderRadius: '18px', padding: '1.25rem 1rem', textAlign: 'center' }}
              >
                <div
                  style={{ fontSize: '1.75rem', fontWeight: '700', color: '#111111', marginBottom: '0.25rem' }}
                  data-testid={`status-${item.label.toLowerCase()}-value`}
                >
                  {item.value}
                </div>
                <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* User footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.875rem',
              padding: '1rem',
              background: '#f9fafb',
              borderRadius: '18px',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                background: '#111111',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={20} color="#ffffff" strokeWidth={2} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111111' }} data-testid="text-username">
                {userName}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Conectado</div>
            </div>
          </div>
        </aside>

        {/* Main panel */}
        <main
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.94)',
            borderRadius: '36px',
            boxShadow: '0 42px 120px rgba(0,0,0,0.12)',
            backdropFilter: 'blur(18px)',
            padding: 'clamp(1.5rem, 3vw, 2.5rem)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {activeNav === 'home' && <HomePanel userName={userName} />}
          {activeNav === 'assistant' && <AssistantPanel />}
          {activeNav === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>
              <Settings size={40} strokeWidth={1.5} style={{ marginBottom: '1rem', opacity: 0.4 }} />
              <p style={{ fontWeight: '600' }}>Configuración próximamente</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
