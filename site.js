// aperture follows the cursor on the home opening
const lens = document.getElementById('lens');
const open = document.getElementById('open');
if (lens && open) {
  open.addEventListener('mousemove', e => {
    const r = open.getBoundingClientRect();
    lens.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
    lens.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
  });
}

// content surfaces on scroll
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  });
}, { threshold: .12 });
document.querySelectorAll('.work,.bio,.press').forEach(el => io.observe(el));

// address assembled at runtime - never present in the source a crawler reads
(function () {
  const slot = document.getElementById('ml');
  if (!slot) return;
  const u = ['studio', 'sharonazagi', 'com'];
  const at = String.fromCharCode(64);
  const a = document.createElement('a');
  a.href = 'mail' + 'to:' + u[0] + at + u[1] + '.' + u[2];
  a.textContent = u[0] + at + u[1] + '.' + u[2];
  slot.appendChild(a);
})();
