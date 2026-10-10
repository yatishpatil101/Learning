import { get, unwrapPage } from '../../http.js';

const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export async function getProviderHealth() {
  const rows = await get('/admin/integrations');
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    provider: r.provider,
    live: r.live === true,
    ok24h: count(r.ok24h),
    failed24h: count(r.failed24h),
    skipped24h: count(r.skipped24h),
    ok7d: count(r.ok7d),
    failed7d: count(r.failed7d),
    lastOkAt: r.lastOkAt || null,
    lastFailureAt: r.lastFailureAt || null,
    lastFailureDetail: r.lastFailureDetail || null,
  }));
}

// Blank filters are omitted: the server answers 400 to a value outside its enum, and '' is one.
export async function listProviderCalls({ provider, outcome, q, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (provider) query.provider = provider;
  if (outcome) query.outcome = outcome;
  if (q && q.trim()) query.q = q.trim();
  return unwrapPage(await get('/admin/integrations/calls', query), { page, size });
}
