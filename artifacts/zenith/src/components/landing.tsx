import { Cpu } from 'lucide-react';

const CLIENT_ID = '5954617612200319484';

export default function Landing() {
  const handleLogin = () => {
    const state = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('roblox_oauth_state', state);

    const redirectUri = window.location.origin + '/roblox-callback';
    const scope = 'openid profile';

    const authUrl = new URL('https://apis.roblox.com/oauth/v1/authorize');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    window.location.href = authUrl.toString();
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-6"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 40%, #111111 100%)',
        position: 'relative',
      }}
    >
      {/* Radial overlay for depth */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.1), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      {/* Landing card */}
      <div
        className="relative z-10 w-full"
        style={{
          maxWidth: '900px',
          background: 'rgba(255,255,255,0.92)',
          borderRadius: '36px',
          boxShadow: '0 36px 90px rgba(0,0,0,0.12)',
          backdropFilter: 'blur(18px)',
          padding: 'clamp(2.5rem, 5vw, 5rem)',
        }}
      >
        {/* Logo block */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex items-center justify-center mb-3"
            style={{
              width: '64px',
              height: '64px',
              background: '#111111',
              borderRadius: '16px',
            }}
          >
            <Cpu size={32} color="#ffffff" strokeWidth={2} />
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#6b7280',
            }}
          >
            ZENITH
          </div>
        </div>

        {/* Big heading */}
        <h1
          style={{
            fontSize: 'clamp(3rem, 4vw, 4.8rem)',
            lineHeight: '0.95',
            letterSpacing: '-0.05em',
            fontWeight: '700',
            color: '#111111',
            textAlign: 'center',
            marginBottom: '1.5rem',
          }}
        >
          Studio AI
          <br />
          Companion
        </h1>

        {/* Body text */}
        <p
          style={{
            color: '#4b5563',
            lineHeight: '1.85',
            fontSize: '1.125rem',
            textAlign: 'center',
            marginBottom: '3rem',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          Your intelligent assistant for Roblox Studio development. Connect your Roblox account to
          get started with AI-powered scripting, debugging, and workflow automation.
        </p>

        {/* Primary button */}
        <div className="flex justify-center">
          <button
            onClick={handleLogin}
            style={{
              background: '#111111',
              color: '#ffffff',
              padding: '1rem 3rem',
              borderRadius: '18px',
              fontSize: '1rem',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
            data-testid="button-connect-roblox"
          >
            Connect with Roblox
          </button>
        </div>
      </div>
    </div>
  );
}
