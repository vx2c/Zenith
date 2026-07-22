import { Cpu, Home, Zap, Settings, User } from 'lucide-react';
import { useState } from 'react';

interface DashboardProps {
  userName: string;
}

export default function Dashboard({ userName }: DashboardProps) {
  const [activeNav, setActiveNav] = useState('home');

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'assistant', label: 'Assistant', icon: Zap },
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
        style={{
          maxWidth: '1200px',
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            width: '320px',
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
            <div
              style={{
                width: '48px',
                height: '48px',
                background: '#111111',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cpu size={24} color="#ffffff" strokeWidth={2} />
            </div>
            <h2
              style={{
                fontSize: '1.5rem',
                fontWeight: '700',
                color: '#111111',
              }}
            >
              Zenith
            </h2>
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
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = '#f9fafb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                  data-testid={`nav-${item.id}`}
                >
                  <Icon size={20} strokeWidth={2} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Status grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.75rem',
            }}
          >
            {statusItems.map((item) => (
              <div
                key={item.label}
                style={{
                  background: '#f9fafb',
                  borderRadius: '18px',
                  padding: '1.25rem 1rem',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: '700',
                    color: '#111111',
                    marginBottom: '0.25rem',
                  }}
                  data-testid={`status-${item.label.toLowerCase()}-value`}
                >
                  {item.value}
                </div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    color: '#6b7280',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {item.label}
                </div>
              </div>
            ))}
          </div>

          {/* Spacer */}
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
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  color: '#111111',
                }}
                data-testid="text-username"
              >
                {userName}
              </div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: '#6b7280',
                }}
              >
                Connected
              </div>
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
            padding: 'clamp(2rem, 4vw, 3.5rem)',
          }}
        >
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              style={{
                width: '80px',
                height: '80px',
                background: '#111111',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <Cpu size={40} color="#ffffff" strokeWidth={2} />
            </div>
            <h1
              style={{
                fontSize: 'clamp(2rem, 3vw, 3rem)',
                fontWeight: '700',
                color: '#111111',
                marginBottom: '1rem',
              }}
            >
              Zenith
            </h1>
            <p
              style={{
                color: '#4b5563',
                lineHeight: '1.85',
                fontSize: '1.125rem',
                maxWidth: '500px',
              }}
            >
              Your Roblox Studio AI companion is connected and ready. Use the assistant panel in
              Roblox Studio to start building with AI-powered tools.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
