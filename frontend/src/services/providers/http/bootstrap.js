import { get } from '../../http.js';

// Matches the server's public-read cache TTL (`draazy.cache.public-reads.ttl`).
const TTL_MS = 30_000;

// Every public reference read is one section of `GET /bootstrap`, fetched once per TTL.
export async function bootstrapSection(name) {
  const doc = await get('/bootstrap', null, { auth: false, ttl: TTL_MS });
  return doc?.[name];
}
