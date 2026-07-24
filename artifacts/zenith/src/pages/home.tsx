import { useState, useEffect, useRef } from 'react';
import Landing from '@/components/landing';
import Dashboard from '@/components/dashboard';

// ── Wave animation component ──────────────────
function WaveBackground({ isDark }: { isDark: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
      <style>{`
        @keyframes waveFloat1 {
          0%, 100% { transform: translateX(0) translateY(0) scale(1); }
          33% { transform: translateX(-40px) translateY(-30px) scale(1.05); }
          66% { transform: translateX(30px) translateY(20px) scale(0.97); }
        }
        @keyframes waveFloat2 {
          0%, 100% { transform: translateX(0) translateY(0) scale(1); }
          33% { transform: translateX(50px) translateY(20px) scale(1.03); }
          66% { transform: translateX(-20px) translateY(-40px) scale(1.06); }
        }
        @keyframes waveFloat3 {
          0%, 100% { transform: translateX(0) translateY(0) scale(1); }
          50% { transform: translateX(-30px) translateY(40px) scale(1.04); }
        }
        @keyframes typewriter {
          0%, 15% { opacity: 1; }
          35%, 50% { opacity: 0; }
          65%, 80% { opacity: 1; }
          100% { opacity: 1; }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes menuFadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes avatarPop {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Animated orbs */}
      {isDark ? (
        <>
          <div style={{ position: 'absolute', width: '60vw', height: '60vw', maxWidth: 700, maxHeight: 700,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.04) 0%, transparent 70%)',
            top: '-20%', left: '-10%', animation: 'waveFloat1 12s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', width: '50vw', height: '50vw', maxWidth: 600, maxHeight: 600,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)',
            bottom: '-15%', right: '-10%', animation: 'waveFloat2 15s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', width: '40vw', height: '40vw', maxWidth: 500, maxHeight: 500,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.02) 0%, transparent 70%)',
            top: '30%', right: '20%', animation: 'waveFloat3 10s ease-in-out infinite' }} />
        </>
      ) : (
        <>
          <div style={{ position: 'absolute', width: '60vw', height: '60vw', maxWidth: 700, maxHeight: 700,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,0,0,0.04) 0%, transparent 70%)',
            top: '-20%', left: '-10%', animation: 'waveFloat1 12s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', width: '50vw', height: '50vw', maxWidth: 600, maxHeight: 600,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 70%)',
            bottom: '-15%', right: '-10%', animation: 'waveFloat2 15s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', width: '40vw', height: '40vw', maxWidth: 500, maxHeight: 500,
            borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,0,0,0.02) 0%, transparent 70%)',
            top: '30%', right: '20%', animation: 'waveFloat3 10s ease-in-out infinite' }} />
        </>
      )}
    </div>
  );
}

// ── Typewriter hook ───────────────────────────
function useTypewriter(phrases: string[], speed = 80, pause = 1800) {
  const [displayed, setDisplayed] = useState('');
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const current = phrases[phraseIdx];
    if (!deleting && charIdx < current.length) {
      timeoutRef.current = setTimeout(() => {
        setDisplayed(current.slice(0, charIdx + 1));
        setCharIdx(c => c + 1);
      }, speed);
    } else if (!deleting && charIdx === current.length) {
      timeoutRef.current = setTimeout(() => setDeleting(true), pause);
    } else if (deleting && charIdx > 0) {
      timeoutRef.current = setTimeout(() => {
        setDisplayed(current.slice(0, charIdx - 1));
        setCharIdx(c => c - 1);
      }, speed / 2);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx(i => (i + 1) % phrases.length);
    }
    return () => { if (timeoutRef.current !== null) clearTimeout(timeoutRef.current); };
  }, [charIdx, deleting, phraseIdx, phrases, speed, pause]);

  return displayed;
}

// ── Main Menu ─────────────────────────────────
function MainMenu({ userName, onEnter }: { userName: string; onEnter: () => void }) {
  const isDarkStored = (() => {
    try { const s = localStorage.getItem('zenith_settings'); return s ? JSON.parse(s).theme === 'dark' : false; } catch { return false; }
  })();
  const [isDark] = useState(isDarkStored);

  const phrases = [
    'ZENITH IA READY TO WORK',
    'YOUR AI STUDIO COMPANION',
    'POWERING YOUR BUILDS',
  ];
  const typeText = useTypewriter(phrases);

  const bgStyle = isDark
    ? 'linear-gradient(135deg, #0a0a0a 0%, #111 50%, #0d0d0d 100%)'
    : 'linear-gradient(135deg, #f6f6f6 0%, #ebebeb 50%, #e0e0e0 100%)';

  const textColor = isDark ? '#f0f0f0' : '#111';
  const subColor = isDark ? '#666' : '#9ca3af';

  // Get user initial for avatar
  const initial = userName.charAt(0).toUpperCase();

  return (
    <div style={{ minHeight: '100vh', width: '100%', background: bgStyle, display: 'flex',
      alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>

      <WaveBackground isDark={isDark} />

      {/* Subtle grid overlay */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 1,
        backgroundImage: `linear-gradient(${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} 1px, transparent 1px),
                          linear-gradient(90deg, ${isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'} 1px, transparent 1px)`,
        backgroundSize: '60px 60px' }} />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '2rem',
        animation: 'menuFadeIn 0.8s ease-out forwards' }}>

        {/* Avatar */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2.5rem',
          animation: 'avatarPop 0.6s ease-out 0.2s both' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ width: 100, height: 100, borderRadius: 28,
              background: isDark ? '#1e1e1e' : '#fff',
              border: `3px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
              boxShadow: `0 20px 60px ${isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 800, color: textColor, fontFamily: "'Inter', sans-serif" }}>
                {initial}
              </span>
            </div>
            {/* Online dot */}
            <div style={{ position: 'absolute', bottom: 6, right: 6, width: 16, height: 16,
              borderRadius: '50%', background: '#22c55e',
              border: `2px solid ${isDark ? '#0a0a0a' : '#f6f6f6'}`,
              boxShadow: '0 0 10px rgba(34,197,94,0.6)' }} />
          </div>
        </div>

        {/* Username */}
        <div style={{ fontSize: '1.1rem', fontWeight: 600, color: subColor, marginBottom: '1rem',
          letterSpacing: '0.05em', fontFamily: "'Inter', sans-serif" }}>
          {userName}
        </div>

        {/* Typewriter title */}
        <h1 style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', fontWeight: 800, color: textColor,
          letterSpacing: '-0.03em', marginBottom: '0', lineHeight: 1.1,
          fontFamily: "'Inter', sans-serif", minHeight: '3.5rem' }}>
          {typeText}
          <span style={{ display: 'inline-block', width: '3px', height: '1em', background: textColor,
            marginLeft: '4px', verticalAlign: 'text-bottom', animation: 'cursorBlink 1s step-end infinite' }} />
        </h1>

        {/* Subtitle */}
        <p style={{ marginTop: '1.5rem', fontSize: '1rem', color: subColor, lineHeight: 1.8,
          maxWidth: 380, margin: '1.5rem auto 0', fontFamily: "'Inter', sans-serif", whiteSpace: 'pre-line' }}>
          {'Zenith is waiting to work with you.\nDon\'t keep them waiting.'}
        </p>

        {/* Enter button */}
        <div style={{ marginTop: '3rem' }}>
          <button onClick={onEnter}
            style={{ background: 'transparent', border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'}`,
              color: textColor, padding: '0.875rem 3rem', borderRadius: '100px',
              fontSize: '1rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.3s ease',
              letterSpacing: '0.05em', fontFamily: "'Inter', sans-serif",
              backdropFilter: 'blur(8px)' }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
              el.style.borderColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = `0 10px 30px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'}`;
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.background = 'transparent';
              el.style.borderColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
              el.style.transform = 'translateY(0)';
              el.style.boxShadow = 'none';
            }}>
            Click To Enter
          </button>
        </div>

        {/* Footer */}
        <div style={{ marginTop: '4rem', fontSize: '0.72rem', color: subColor,
          letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Inter', sans-serif" }}>
          ZENITH IA — ROBLOX STUDIO COMPANION
        </div>
      </div>
    </div>
  );
}

// ── Home page ─────────────────────────────────
export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const storedName = localStorage.getItem('roblox_user_name');
    setUserName(storedName);
    // If user was already in the session, skip main menu
    const hasEntered = sessionStorage.getItem('zenith_entered');
    if (hasEntered) setEntered(true);
  }, []);

  function handleEnter() {
    sessionStorage.setItem('zenith_entered', '1');
    setEntered(true);
  }

  if (!userName) return <Landing />;
  if (!entered) return <MainMenu userName={userName} onEnter={handleEnter} />;
  return <Dashboard userName={userName} />;
}
