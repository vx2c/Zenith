const sidebar = document.querySelector('.sidebar');
const toggleButton = document.getElementById('sidebarToggle');
const dashboardShell = document.getElementById('dashboardShell');
const enterDashboard = document.getElementById('enterDashboard');
const canvas = document.getElementById('particleCanvas');
const ctx = canvas.getContext('2d');

function updateSidebar() {
  sidebar.classList.toggle('visible');
}

toggleButton.addEventListener('click', updateSidebar);

enterDashboard.addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('.landing-page').classList.add('hidden');
  dashboardShell.classList.remove('hidden');
});

const particles = [];
const particleCount = 80;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createParticles() {
  particles.length = 0;
  for (let i = 0; i < particleCount; i += 1) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: 1 + Math.random() * 2,
      alpha: 0.08 + Math.random() * 0.15,
      speed: 0.3 + Math.random() * 0.6,
      drift: -0.3 + Math.random() * 0.6,
    });
  }
}

function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach((particle) => {
    particle.y += particle.speed;
    particle.x += particle.drift;

    if (particle.y > canvas.height + 10) {
      particle.y = -10;
      particle.x = Math.random() * canvas.width;
    }

    if (particle.x > canvas.width + 10) particle.x = -10;
    if (particle.x < -10) particle.x = canvas.width + 10;

    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${particle.alpha})`;
    ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
    ctx.fill();
  });
  requestAnimationFrame(drawFrame);
}

window.addEventListener('resize', () => {
  resizeCanvas();
  createParticles();
});

window.addEventListener('DOMContentLoaded', () => {
  resizeCanvas();
  createParticles();
  drawFrame();
});
