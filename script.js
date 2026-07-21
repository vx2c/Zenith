const landingPage = document.getElementById('landingPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginRoblox = document.getElementById('loginRoblox');
const connectionStatus = document.getElementById('connectionStatus');

const OAUTH_AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const CLIENT_ID = '4229742603179424213';
const REDIRECT_URI = window.location.origin + '/';
const SCOPES = 'openid profile';

function openRobloxLogin() {
  const state = Math.random().toString(36).slice(2);
  localStorage.setItem('roblox_oauth_state', state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  });

  window.location.href = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

async function handleRedirectLogin() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');
  const savedState = localStorage.getItem('roblox_oauth_state');

  if (!code || !state || state !== savedState) {
    return;
  }

  localStorage.removeItem('roblox_oauth_state');

  try {
    const tokenResponse = await fetch('/api/roblox-callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(errorText || 'Login failed');
    }

    const data = await tokenResponse.json();
    connectionStatus.textContent = `Logged in as ${data.displayName || 'Roblox user'}`;
    landingPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
    window.history.replaceState({}, '', '/');
  } catch (error) {
    console.error(error);
    connectionStatus.textContent = 'Roblox login failed. Try again.';
  }
}

loginRoblox.addEventListener('click', (event) => {
  event.preventDefault();
  openRobloxLogin();
});

window.addEventListener('DOMContentLoaded', () => {
  handleRedirectLogin();
});
