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

// Continuous fall from the top edge, spanning the full width — for moments
// that deserve more than a quick burst (e.g. checking off a Gjøremål on
// Gangskjerm, meant to be seen from across the room). Spawns in waves for
// SPAWN_MS so it reads as sustained rain rather than one starburst, then lets
// the last wave finish falling on its own.
const RAIN_SPAWN_MS = 3500;       // how long new waves keep appearing
const RAIN_WAVE_INTERVAL_MS = 130; // gap between waves
const RAIN_PARTICLES_PER_WAVE = 6; // ~46/s while spawning is active

export function rain() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const started = performance.now();

  const spawnWave = () => {
    for (let i = 0; i < RAIN_PARTICLES_PER_WAVE; i++) {
      const el = document.createElement('span');
      const color    = COLORS[Math.floor(Math.random() * COLORS.length)];
      const x        = Math.random() * w;
      const size     = 6 + Math.random() * 6;
      const drift    = (Math.random() - 0.5) * 160;       // sideways sway while falling
      const rot      = (Math.random() - 0.5) * 720;       // tumble, up to 2 full turns
      const fallMs   = 2600 + Math.random() * 1400;        // 2.6s–4s to cross the screen
      const delayMs  = Math.random() * 150;                // stagger within the wave
      el.style.cssText = `
        position:fixed;left:${x}px;top:-20px;
        width:${size}px;height:${size * (0.5 + Math.random() * 0.5)}px;
        background:${color};
        border-radius:${Math.random() > 0.4 ? '50%' : '2px'};
        pointer-events:none;z-index:9999;
        --drift:${drift}px;--fall:${h + 40}px;--rot:${rot}deg;
        animation:confetti-rain ${fallMs}ms ${delayMs}ms ease-in forwards;
      `;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  };

  spawnWave();
  const id = window.setInterval(() => {
    if (performance.now() - started >= RAIN_SPAWN_MS) { window.clearInterval(id); return; }
    spawnWave();
  }, RAIN_WAVE_INTERVAL_MS);
}

// Explosion at (x,y) whose particles, instead of just fading in place like
// burst(), continue on into a rain()-style gravity fall. Two chained CSS
// animations on each particle (see confetti-pop / confetti-fall-from in
// styles.css) — the fall's start offset is set to match the pop's end offset
// so the handoff between them is seamless.
function explodeIntoRain(x: number, y: number) {
  const count = 14 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; i++) {
    const el = document.createElement('span');
    const color  = COLORS[Math.floor(Math.random() * COLORS.length)];
    const angle  = (i / count) * 360 + (Math.random() - 0.5) * 30;
    const popDist = 26 + Math.random() * 38;
    const popDx  = Math.cos((angle * Math.PI) / 180) * popDist;
    const popDy  = Math.sin((angle * Math.PI) / 180) * popDist;
    const size   = 6 + Math.random() * 6;
    const drift  = (Math.random() - 0.5) * 140;
    // However high up the explosion happens, still falls fully off-screen.
    const fall   = Math.max(80, window.innerHeight - (y + popDy) + 60);
    const rot    = (Math.random() - 0.5) * 720;
    const popMs  = 220 + Math.random() * 130;
    const fallMs = 2600 + Math.random() * 1400;
    el.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;
      width:${size}px;height:${size * (0.5 + Math.random() * 0.5)}px;
      background:${color};
      border-radius:${Math.random() > 0.4 ? '50%' : '2px'};
      pointer-events:none;z-index:9999;
      --pop-dx:${popDx}px;--pop-dy:${popDy}px;
      --fall-x:${popDx + drift}px;--fall-y:${popDy + fall}px;--rot:${rot}deg;
      animation:confetti-pop ${popMs}ms ease-out forwards,
                confetti-fall-from ${fallMs}ms ${popMs}ms ease-in forwards;
    `;
    document.body.appendChild(el);
    // Both chained animations fire their own animationend — only remove
    // after the second (the fall), or the particle vanishes mid-pop.
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'confetti-fall-from') el.remove();
    });
  }
}

// Rocket launch (3-5, fanned ±35° from vertical) from an origin point — e.g.
// a checkbox's screen position — each peaking independently and exploding
// into its own explodeIntoRain() burst. Used on Gangskjerm when checking off
// a Gjøremål: more of a moment than a plain rain() or burst().
const ROCKET_COUNT_MIN = 50;
const ROCKET_COUNT_MAX = 80;

export function fireworkRain(originX: number, originY: number) {
  const count = ROCKET_COUNT_MIN + Math.floor(Math.random() * (ROCKET_COUNT_MAX - ROCKET_COUNT_MIN + 1));
  for (let i = 0; i < count; i++) {
    const angleDeg = count > 1 ? -35 + (i / (count - 1)) * 70 : 0;
    const angleRad = (angleDeg * Math.PI) / 180;
    const dist     = 700 + Math.random() * 130;
    const dx       = Math.sin(angleRad) * dist;
    const dy       = -Math.cos(angleRad) * dist; // negative = upward
    const travelMs = 1000 + Math.random() * 500;
    const color    = COLORS[Math.floor(Math.random() * COLORS.length)];

    const el = document.createElement('span');
    el.style.cssText = `
      position:fixed;left:${originX}px;top:${originY}px;
      width:3px;height:16px;
      background:linear-gradient(${color}, transparent);
      border-radius:2px;
      pointer-events:none;z-index:9999;
      --rocket-dx:${dx}px;--rocket-dy:${dy}px;--rocket-rot:${angleDeg}deg;
      animation:confetti-rocket ${travelMs}ms ease-out forwards;
    `;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => {
      el.remove();
      explodeIntoRain(originX + dx, originY + dy);
    }, { once: true });
  }
}
