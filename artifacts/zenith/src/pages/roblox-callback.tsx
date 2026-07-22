import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useRobloxCallback } from '@workspace/api-client-react';

export default function RobloxCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const robloxCallbackMutation = useRobloxCallback();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const storedState = localStorage.getItem('roblox_oauth_state');

    if (!code) {
      setError('Missing authorization code');
      return;
    }

    if (!state || state !== storedState) {
      setError('Invalid state parameter');
      localStorage.removeItem('roblox_oauth_state');
      return;
    }

    // Clear the stored state
    localStorage.removeItem('roblox_oauth_state');

    // Exchange code for tokens
    const redirectUri = window.location.origin + '/roblox-callback';
    
    robloxCallbackMutation.mutate(
      { data: { code, redirect_uri: redirectUri } },
      {
        onSuccess: (tokenData) => {
          if (tokenData.displayName) {
            localStorage.setItem('roblox_user_name', tokenData.displayName);
          }
          setLocation('/');
        },
        onError: (err: any) => {
          setError(err?.message || 'Failed to authenticate with Roblox');
        },
      }
    );
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{
      background: 'linear-gradient(180deg, #ffffff 0%, #e8e8e8 40%, #111111 100%)',
      position: 'relative',
    }}>
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.1), transparent 60%)',
        pointerEvents: 'none',
      }} />
      <div className="relative z-10 text-center" style={{
        background: 'rgba(255,255,255,0.92)',
        borderRadius: '36px',
        boxShadow: '0 36px 90px rgba(0,0,0,0.12)',
        backdropFilter: 'blur(18px)',
        padding: '3rem',
        maxWidth: '500px',
        width: '90%',
      }}>
        {error ? (
          <>
            <h1 className="text-2xl font-semibold mb-2" style={{ color: '#111111' }}>
              Authentication Failed
            </h1>
            <p style={{ color: '#6b7280', lineHeight: '1.85' }}>{error}</p>
            <button
              onClick={() => setLocation('/')}
              style={{
                marginTop: '2rem',
                background: '#111111',
                color: '#ffffff',
                padding: '0.875rem 2rem',
                borderRadius: '18px',
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
              data-testid="button-back-home"
            >
              Back to Home
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold mb-2" style={{ color: '#111111' }}>
              Logging in with Roblox...
            </h1>
            <p style={{ color: '#6b7280', lineHeight: '1.85' }}>
              Please wait while we complete your authentication.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
