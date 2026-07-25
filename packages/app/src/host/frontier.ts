import type { CommunityGoal } from '../shared/ipc-types.js';

/*
 * Community goals come from FRONTIER's API, not Spansh (Spansh's own page calls
 * this endpoint): GET {base}/2.0/website/initiatives/list?lang=en ->
 * { activeInitiatives: [{ title, bulletin (HTML-ish), expiry (UTC),
 *   activityType ('tradelist' = trade CG), target_commodity_list (comma-sep),
 *   starsystem_name, market_name }] }. No auth. Contract extracted from
 * Spansh's objects/goal normalizer (bundle 7c4a80cd..., 2026-07-24); the live
 * list was empty at probe time (CGs are intermittent), so the populated shape
 * is pinned by fixture tests rather than a recorded response.
 */
const DEFAULT_BASE = 'https://api.orerve.net';
const USER_AGENT = 'EDHelper/0.1';

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export async function fetchCommunityGoals(fetchFn: typeof fetch = fetch): Promise<CommunityGoal[]> {
  const base = (process.env.FRONTIER_API_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const res = await fetchFn(`${base}/2.0/website/initiatives/list?lang=en`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Frontier API HTTP ${res.status}`);
  const body: any = await res.json();
  return (body.activeInitiatives ?? []).map((g: any): CommunityGoal => {
    const isTrade = g.activityType === 'tradelist';
    return {
      title: String(g.title ?? ''),
      system: String(g.starsystem_name ?? ''),
      station: String(g.market_name ?? ''),
      activityType: String(g.activityType ?? ''),
      isTrade,
      commodities: isTrade
        ? String(g.target_commodity_list ?? '')
            .split(',')
            .map((c: string) => c.trim())
            .filter(Boolean)
        : [],
      expiry: String(g.expiry ?? ''),
      bulletin: stripHtml(String(g.bulletin ?? '')),
    };
  });
}
