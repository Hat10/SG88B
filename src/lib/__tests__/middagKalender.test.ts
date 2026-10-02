import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocker googleapis + supabase slik at selve api/middag-kalender.ts-handleren
// kan kjøres uten nettverk.
const cal = {
  events: { list: vi.fn(), patch: vi.fn(), insert: vi.fn(), delete: vi.fn() },
};
let mealRow: { recipes: { name: string } } | null = null;

vi.mock('googleapis', () => ({
  google: { auth: { JWT: vi.fn() }, calendar: () => cal },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mealRow, error: null }) }) }),
    }),
  }),
}));

import handler from '../../../api/middag-kalender';

const err = (code: number) => Object.assign(new Error(`HTTP ${code}`), { code });

async function call(date = '2026-10-05') {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res), send: vi.fn(() => res) };
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { date } }, res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_EMAIL = 'x@y';
  process.env.GOOGLE_PRIVATE_KEY = 'k';
  process.env.GOOGLE_CALENDAR_ID_FELLES = 'cal';
  process.env.SUPABASE_URL = 'u';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 's';
  mealRow = { recipes: { name: 'Taco' } };
  cal.events.list.mockResolvedValue({ data: { items: [] } });
  cal.events.patch.mockResolvedValue({});
  cal.events.insert.mockResolvedValue({});
  cal.events.delete.mockResolvedValue({});
});

describe('api/middag-kalender', () => {
  it('patcher alltid med status confirmed og standardtid 19:00', async () => {
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = cal.events.patch.mock.calls[0][0].requestBody;
    expect(body.status).toBe('confirmed');
    expect(body.summary).toBe('🍽️ Taco');
    expect(body.start).toEqual({ dateTime: '2026-10-05T19:00:00', timeZone: 'Europe/Oslo' });
    expect(body.end).toEqual({ dateTime: '2026-10-05T20:00:00', timeZone: 'Europe/Oslo' });
    expect(cal.events.insert).not.toHaveBeenCalled();
  });

  it('starter middagen når Trening slutter (Oslo-tid, ikke UTC)', async () => {
    cal.events.list.mockResolvedValue({ data: { items: [{
      summary: 'Trening',
      start: { dateTime: '2026-10-05T17:00:00+02:00' },
      end: { dateTime: '2026-10-05T18:30:00+02:00' },
    }] } });
    await call();
    expect(cal.events.patch.mock.calls[0][0].requestBody.start.dateTime).toBe('2026-10-05T18:30:00');
  });

  it('oppretter ved 404 og 410', async () => {
    for (const code of [404, 410]) {
      vi.clearAllMocks();
      cal.events.list.mockResolvedValue({ data: { items: [] } });
      cal.events.patch.mockRejectedValueOnce(err(code));
      cal.events.insert.mockResolvedValue({});
      const res = await call();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(cal.events.insert.mock.calls[0][0].requestBody.id).toBe('middag20261005');
    }
  });

  it('patcher på nytt når insert gir 409', async () => {
    cal.events.patch.mockRejectedValueOnce(err(404)).mockResolvedValueOnce({});
    cal.events.insert.mockRejectedValueOnce(err(409));
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(cal.events.patch).toHaveBeenCalledTimes(2);
    expect(cal.events.patch.mock.calls[1][0].requestBody.status).toBe('confirmed');
  });

  it('sletter når meal_plan-raden ikke finnes, og tåler 404/410', async () => {
    mealRow = null;
    cal.events.delete.mockRejectedValueOnce(err(410));
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, deleted: true });
    expect(cal.events.patch).not.toHaveBeenCalled();
  });

  it('svarer 502 ved andre Google-feil', async () => {
    cal.events.patch.mockRejectedValueOnce(err(500));
    const res = await call();
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
