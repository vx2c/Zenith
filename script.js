const landingPage = document.getElementById('landingPage');
const dashboardPage = document.getElementById('dashboardPage');
const enterDashboard = document.getElementById('enterDashboard');

enterDashboard.addEventListener('click', (event) => {
  event.preventDefault();
  landingPage.classList.add('hidden');
  dashboardPage.classList.remove('hidden');
});
