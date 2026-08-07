const COLORS = ['#4A80C4', '#7AB394', '#C9963A', '#D95F5F', '#8B6EC9', '#C97A8B', '#4A8A6E'];

export function burst(x: number, y: number) {
  const count = 16;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const angle = (i / count) * 360 + (Math.random() - 0.5) * 25;
    const dist = 36 + Math.random() * 44;
    const size = 5 + Math.random() * 4;
    const dx = Math.cos((angle * Math.PI) / 180) * dist;
    const dy = Math.sin((angle * Math.PI) / 180) * dist - 10; // slight upward bias
    const rot = (Math.random() - 0.5) * 540;
    el.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;
      width:${size}px;height:${size}px;
      background:${color};
      border-radius:${Math.random() > 0.4 ? '50%' : '2px'};
      pointer-events:none;z-index:9999;
      --dx:${dx}px;--dy:${dy}px;--rot:${rot}deg;
      animation:confetti-fly 0.55s cubic-bezier(.2,.8,.4,1) forwards;
    `;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}
