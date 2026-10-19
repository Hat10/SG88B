export function WeatherIcon({ category, size = 56, cloud = 'var(--wx-cloud)', cloudLine = 'var(--wx-cloud-line)' }: { category: string; size?: number; cloud?: string; cloudLine?: string }) {
  const s = size;
  if (category === 'clear') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <circle cx="28" cy="28" r="10" fill="var(--warn)" opacity="0.85" />
      {[0,45,90,135,180,225,270,315].map(a => (
        <line key={a} x1={28+15*Math.cos(a*Math.PI/180)} y1={28+15*Math.sin(a*Math.PI/180)}
          x2={28+20*Math.cos(a*Math.PI/180)} y2={28+20*Math.sin(a*Math.PI/180)}
          stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      ))}
    </svg>
  );
  if (category === 'fair') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <circle cx="22" cy="20" r="7" fill="var(--warn)" opacity="0.75" />
      {[0,60,120,180,240,300].map(a => (
        <line key={a} x1={22+10*Math.cos(a*Math.PI/180)} y1={20+10*Math.sin(a*Math.PI/180)}
          x2={22+14*Math.cos(a*Math.PI/180)} y2={20+14*Math.sin(a*Math.PI/180)}
          stroke="var(--warn)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      ))}
      <path d="M 16 42 Q 12 42 12 36 Q 12 30 20 30 Q 22 22 32 22 Q 42 22 44 32 Q 52 32 52 39 Q 52 44 46 44 L 20 44 Q 16 44 16 42 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
    </svg>
  );
  if (category === 'rain') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {[[16,44],[24,40],[32,44],[20,50],[28,48]].map(([x,y],i) => (
        <line key={i} x1={x} y1={y-5} x2={x-2} y2={y} stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
      ))}
    </svg>
  );
  if (category === 'snow') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {[[16,44],[24,40],[32,44],[20,50],[28,48]].map(([x,y],i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="var(--accent)" opacity="0.6" />
      ))}
    </svg>
  );
  if (category === 'thunder') return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 12 34 Q 8 34 8 27 Q 8 20 17 20 Q 19 12 29 12 Q 39 12 41 22 Q 50 22 50 30 Q 50 36 44 36 L 16 36 Q 12 36 12 34 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      <polyline points="30,38 24,47 29,47 23,56" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  // cloudy / fog / default
  return (
    <svg width={s} height={s} viewBox="0 0 56 56">
      <path d="M 8 38 Q 4 38 4 31 Q 4 24 13 24 Q 15 16 25 16 Q 35 16 37 26 Q 46 26 46 34 Q 46 40 40 40 L 12 40 Q 8 40 8 38 Z"
        fill={cloud} stroke={cloudLine} strokeWidth="1" />
      {category === 'fog' && [28,34,40].map(y => (
        <line key={y} x1="8" y1={y+6} x2="46" y2={y+6} stroke={cloudLine} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      ))}
    </svg>
  );
}
