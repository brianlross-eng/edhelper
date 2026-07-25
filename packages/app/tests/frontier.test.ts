import { describe, expect, it } from 'vitest';
import { fetchCommunityGoals } from '../src/host/frontier';

const INITIATIVE = {
  title: 'Aid the Alliance',
  bulletin: '<p>Deliver <b>medicines</b> to the station.</p>',
  expiry: '2026-08-01T07:00:00Z',
  activityType: 'tradelist',
  target_commodity_list: 'Medicines, Basic Medicines ,Advanced Medicines',
  starsystem_name: 'Alioth',
  market_name: 'Irkutsk',
};

function fetchWith(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchFn = (async (url: any) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('fetchCommunityGoals', () => {
  it('maps initiatives, splits trade commodities, strips bulletin HTML', async () => {
    const { fetchFn, calls } = fetchWith({ activeInitiatives: [INITIATIVE] });
    const goals = await fetchCommunityGoals(fetchFn);
    expect(calls[0]).toContain('/2.0/website/initiatives/list?lang=en');
    expect(goals).toEqual([
      {
        title: 'Aid the Alliance',
        system: 'Alioth',
        station: 'Irkutsk',
        activityType: 'tradelist',
        isTrade: true,
        commodities: ['Medicines', 'Basic Medicines', 'Advanced Medicines'],
        expiry: '2026-08-01T07:00:00Z',
        bulletin: 'Deliver medicines to the station.',
      },
    ]);
  });

  it('returns [] for an empty list and non-trade goals have no commodities', async () => {
    const empty = await fetchCommunityGoals(fetchWith({ activeInitiatives: [] }).fetchFn);
    expect(empty).toEqual([]);
    const goals = await fetchCommunityGoals(
      fetchWith({ activeInitiatives: [{ ...INITIATIVE, activityType: 'bounty', target_commodity_list: '' }] }).fetchFn
    );
    expect(goals[0].isTrade).toBe(false);
    expect(goals[0].commodities).toEqual([]);
  });

  it('throws on HTTP errors', async () => {
    await expect(fetchCommunityGoals(fetchWith({}, 503).fetchFn)).rejects.toThrow('Frontier API HTTP 503');
  });
});
