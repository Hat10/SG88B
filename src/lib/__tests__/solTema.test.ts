import { describe, it, expect } from 'vitest';
import { byttetider, erMorkAuto, solTider, LYS_TIDLIGST, LYS_SENEST, MORK_TIDLIGST, MORK_SENEST } from '../solTema';

// Oslo-tid → Date. offset: 1 = vintertid (CET), 2 = sommertid (CEST).
const oslo = (iso: string, offset: 1 | 2) => new Date(`${iso}+0${offset}:00`);
const hm = (h: number, m = 0) => h * 60 + m;

describe('byttetider – vår/høst følger sola', () => {
  it('24. okt: soloppgang ~08:36, solnedgang ~16:55 klemmes til 17:00', () => {
    const t = byttetider(oslo('2026-10-24T12:00:00', 2));
    expect(Math.abs(t.lysFra - hm(8, 36))).toBeLessThanOrEqual(3);
    expect(t.morkFra).toBe(MORK_TIDLIGST);
  });
  it('20. mar: soloppgang ~06:03, solnedgang ~18:18', () => {
    const t = byttetider(oslo('2026-03-20T12:00:00', 1));
    expect(Math.abs(t.lysFra - hm(6, 3))).toBeLessThanOrEqual(3);
    expect(Math.abs(t.morkFra - hm(18, 18))).toBeLessThanOrEqual(3);
  });
  it('15. apr: tidlig soloppgang klemmes til 06:00, solnedgang ~20:50 klemmes til 20:00', () => {
    const t = byttetider(oslo('2026-04-15T12:00:00', 2));
    expect(t.lysFra).toBe(LYS_TIDLIGST);
    expect(t.morkFra).toBe(MORK_SENEST);
  });
});

describe('byttetider – ekstremene i Bodø', () => {
  it('midnattssol (21. jun): 06:00 → 20:00', () => {
    expect(solTider(oslo('2026-06-21T12:00:00', 2).getTime()).kind).toBe('midnattssol');
    expect(byttetider(oslo('2026-06-21T12:00:00', 2))).toEqual({ lysFra: LYS_TIDLIGST, morkFra: MORK_SENEST });
  });
  it('solnedgang etter midnatt (slutten av mai) gir 20:00, ikke 17:00', () => {
    expect(byttetider(oslo('2026-05-28T12:00:00', 2)).morkFra).toBe(MORK_SENEST);
  });
  it('mørketid/vintersolverv: 09:00 → 17:00', () => {
    expect(byttetider(oslo('2026-12-21T12:00:00', 1))).toEqual({ lysFra: LYS_SENEST, morkFra: MORK_TIDLIGST });
    expect(byttetider(oslo('2026-01-15T12:00:00', 1))).toEqual({ lysFra: LYS_SENEST, morkFra: MORK_TIDLIGST });
  });
  it('byttetidene er alltid innenfor grensene gjennom hele året', () => {
    for (let d = 0; d < 365; d++) {
      const t = byttetider(new Date(Date.UTC(2026, 0, 1 + d, 11)));
      expect(t.lysFra).toBeGreaterThanOrEqual(LYS_TIDLIGST);
      expect(t.lysFra).toBeLessThanOrEqual(LYS_SENEST);
      expect(t.morkFra).toBeGreaterThanOrEqual(MORK_TIDLIGST);
      expect(t.morkFra).toBeLessThanOrEqual(MORK_SENEST);
    }
  });
});

describe('erMorkAuto', () => {
  it('desember: mørk før 09:00 og fra 17:00', () => {
    expect(erMorkAuto(oslo('2026-12-10T08:59:00', 1))).toBe(true);
    expect(erMorkAuto(oslo('2026-12-10T09:00:00', 1))).toBe(false);
    expect(erMorkAuto(oslo('2026-12-10T16:59:00', 1))).toBe(false);
    expect(erMorkAuto(oslo('2026-12-10T17:00:00', 1))).toBe(true);
  });
  it('juni: lys til 20:00, mørk etter', () => {
    expect(erMorkAuto(oslo('2026-06-21T19:59:00', 2))).toBe(false);
    expect(erMorkAuto(oslo('2026-06-21T20:00:00', 2))).toBe(true);
    expect(erMorkAuto(oslo('2026-06-21T05:59:00', 2))).toBe(true);
  });
  it('bruker Oslo-tid rundt sommertid-overgangen (25. okt)', () => {
    expect(erMorkAuto(oslo('2026-10-25T12:00:00', 1))).toBe(false);
    expect(erMorkAuto(oslo('2026-10-25T17:00:00', 1))).toBe(true);
  });
});
