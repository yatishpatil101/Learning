/* ---------- success celebration ----------
   Two party-popper cannons fire from the bottom corners, arcing confetti up and
   toward the centre before gravity pulls it down — a livelier "you did it!" moment
   than a plain top-down drizzle. Mixes round dots and spinning ribbons. */
export const triggerConfetti = () => {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colors = ['#14b8a6', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e'];
  const W = window.innerWidth;
  const H = window.innerHeight;

  const cannon = (originX, baseAngle) => {
    for (let i = 0; i < 55; i++) {
      const ribbon = Math.random() > 0.5;
      const size = 6 + Math.random() * 8;
      const c = document.createElement('div');
      Object.assign(c.style, {
        position: 'fixed', left: originX + 'px', top: H + 'px',
        width: (ribbon ? size * 0.5 : size) + 'px',
        height: (ribbon ? size * 1.5 : size) + 'px',
        backgroundColor: colors[Math.floor(Math.random() * colors.length)],
        borderRadius: ribbon ? '2px' : '50%',
        zIndex: '9999', pointerEvents: 'none', willChange: 'transform, opacity',
      });
      document.body.appendChild(c);

      const angle = baseAngle + (Math.random() - 0.5) * 0.9; // radians, mostly upward
      const speed = 620 + Math.random() * 560;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed; // negative = upward
      const spin = (Math.random() - 0.5) * 720;

      c.animate(
        [
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: `translate(${vx * 0.45}px, ${vy * 0.6}px) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${vx * 0.9}px, ${Math.abs(vy) * 0.55 + 220}px) rotate(${spin}deg)`, opacity: 0 },
        ],
        { duration: 1900 + Math.random() * 900, easing: 'cubic-bezier(0.2,0.6,0.35,1)' }
      ).onfinish = () => c.remove();
    }
  };

  cannon(W * 0.12, -Math.PI * 0.42); // bottom-left → up & right
  cannon(W * 0.88, -Math.PI * 0.58); // bottom-right → up & left
};
