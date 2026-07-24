import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark';
export type Language = 'en' | 'es';

interface Settings {
  theme: Theme;
  language: Language;
}

const STORAGE_KEY = 'zenith_settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch { /* ignore */ }
  return { theme: 'light', language: 'en' };
}

function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    applyTheme(settings.theme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Apply on mount
  useEffect(() => {
    applyTheme(settings.theme);
  }, []);

  function setTheme(theme: Theme) {
    setSettings((s) => ({ ...s, theme }));
  }

  function setLanguage(language: Language) {
    setSettings((s) => ({ ...s, language }));
  }

  return { settings, setTheme, setLanguage };
}

export const TRANSLATIONS = {
  en: {
    home: 'Home',
    assistant: 'Assistant',
    community: 'Community',
    settings: 'Settings',
    connected: 'Connected',
    welcomeTitle: (name: string) => `Welcome, ${name}`,
    welcomeDesc: 'Your Roblox Studio AI companion is ready. Install the plugin in Studio and connect it to this URL to get started.',
    serverUrl: 'Server URL for plugin',
    endpoints: 'Endpoints: /api/connect · /api/heartbeat · /api/command_result',
    aiReady: 'Zenith AI Ready',
    aiDesc: 'Ask about Lua, Roblox APIs, GUIs, debugging, or system design.',
    placeholder: 'Type a message… (Enter to send, Shift+Enter for new line)',
    zenithAssistant: 'Zenith Assistant',
    online: 'Online',
    offline: 'Key not set',
    checking: 'Checking…',
    fallbackChain: 'Fallback chain',
    aiStatus: 'AI Status',
    themeLabel: 'Theme',
    langLabel: 'Language',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    langEn: 'English',
    langEs: 'Spanish',
    copy: 'Copy',
    again: 'Again',
    like: 'Like',
    more: 'More',
    time: 'Time',
    model: 'Model',
    responseTime: 'Response time',
    thinking: 'Thinking',
    searchInternet: 'Search the Internet',
    textPasted: 'lines',
    luaPasted: 'lines',
    stopLabel: 'Stop',
    stoppedWriting: 'Zenith stopped writing.',
    afkTitle: (name: string) => `${name}, are you AFK?`,
    afkButton: 'Click To Continue',
    joinCommunity: 'Join The Community',
    communityDesc: 'Connect with Roblox developers, get early access to upcoming features, share your projects, and help shape the future of Roblox Studio AI.',
    communityButton: 'Join Community',
    enterButton: 'Click To Enter',
    menuSubtitle: 'Zenith is waiting to work with you.\nDon\'t keep them waiting.',
    menuTitle: 'ZENITH IA READY TO WORK',
  },
  es: {
    home: 'Inicio',
    assistant: 'Asistente',
    community: 'Comunidad',
    settings: 'Ajustes',
    connected: 'Conectado',
    welcomeTitle: (name: string) => `Bienvenido, ${name}`,
    welcomeDesc: 'Tu compañero de IA para Roblox Studio está listo. Instala el plugin en Studio y conéctalo a esta URL para comenzar.',
    serverUrl: 'URL del servidor para el plugin',
    endpoints: 'Endpoints: /api/connect · /api/heartbeat · /api/command_result',
    aiReady: 'Zenith IA listo',
    aiDesc: 'Pregunta sobre Lua, APIs de Roblox, GUIs, depuración o diseño de sistemas.',
    placeholder: 'Escribe un mensaje… (Enter para enviar, Shift+Enter nueva línea)',
    zenithAssistant: 'Asistente Zenith',
    online: 'Online',
    offline: 'Clave no configurada',
    checking: 'Verificando…',
    fallbackChain: 'Cadena de respaldo',
    aiStatus: 'Estado IA',
    themeLabel: 'Tema',
    langLabel: 'Idioma',
    lightTheme: 'Claro',
    darkTheme: 'Oscuro',
    langEn: 'Inglés',
    langEs: 'Español',
    copy: 'Copiar',
    again: 'Repetir',
    like: 'Me gusta',
    more: 'Más',
    time: 'Hora',
    model: 'Modelo',
    responseTime: 'Tiempo de respuesta',
    thinking: 'Pensar',
    searchInternet: 'Buscar en Internet',
    textPasted: 'líneas',
    luaPasted: 'líneas',
    stopLabel: 'Detener',
    stoppedWriting: 'Zenith dejó de escribir.',
    afkTitle: (name: string) => `${name}, ¿estás ausente?`,
    afkButton: 'Hacer clic para continuar',
    joinCommunity: 'Únete a la Comunidad',
    communityDesc: 'Conéctate con desarrolladores de Roblox, obtén acceso anticipado a próximas funciones, comparte tus proyectos y ayuda a dar forma al futuro de la IA de Roblox Studio.',
    communityButton: 'Unirse',
    enterButton: 'Hacer clic para entrar',
    menuSubtitle: 'Zenith está listo para trabajar contigo.\nNo los hagas esperar.',
    menuTitle: 'ZENITH IA LISTO PARA TRABAJAR',
  },
} as const;
