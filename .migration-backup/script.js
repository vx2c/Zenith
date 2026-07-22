const landingPage = document.getElementById('landingPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginRoblox = document.getElementById('loginRoblox');
const connectionStatus = document.getElementById('connectionStatus');

const OAUTH_AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const CLIENT_ID = '4229742603179424213';
const REDIRECT_URI = `${window.location.origin}/roblox-callback.html`;
const SCOPES = 'openid profile';

function showDashboard(displayName) {
  if (displayName) {
    connectionStatus.textContent = `Logged in as ${displayName}`;
  }
  landingPage.classList.add('hidden');
  dashboardPage.classList.remove('hidden');
}

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

function restoreLogin() {
  const displayName = localStorage.getItem('roblox_user_name');
  if (displayName) {
    showDashboard(displayName);
  }
}

loginRoblox.addEventListener('click', (event) => {
  event.preventDefault();
  openRobloxLogin();
});

window.addEventListener('DOMContentLoaded', () => {
  restoreLogin();
});
