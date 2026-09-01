/**
 * HTTP staff-activity provider — the live counterpart to `providers/mock/staffActivityProvider.js`.
 *
 * ## What changed shape, and why
 *
 * The mock kept a `staffActivity` array of its own with a `category` ('listing' | 'service'), an
 * `action` drawn from a fixed list of service types ('packers', 'interior', 'legal'…) and a
 * human-written `detail` sentence. None of those exist on the server, because none of them were ever
 * recorded by anything but the browser.
 *
 * What the server has is the audit row, and it maps cleanly:
 *
 * - **`entity`** is the category. `user`, `property`, `locality`, `ticket`, `societyLead` — the kind
 *   of record acted on. It is a better category than the mock's two-value one and it is not a guess.
 * - **`action`** is the dotted verb, `user.suspend`. The mock's action list contained `packers` and
 *   `interior`, which are service *categories* and were never audit actions, so two of its six
 *   filter options could only ever return nothing.
 * - **`detail`** has no equivalent and is not invented here. The row carries `entity` + `entityId`,
 *   which is what actually identifies the record; a prose sentence assembled in the browser would be
 *   a caption written by the reader.
 *
 * ## The filter options come from the server
 *
 * `getStaffActivitySummary` returns `byEntity` and `actions` for the window. The pickers are built
 * from those rather than from constants in the frontend, so they can only offer values that exist.
 */
import { get, unwrapPage } from '../../http.js';

/**
 * Only send parameters that are actually set. An empty string is a filter on the server —
 * `entity=''` would be asking for rows whose entity is the empty string, not for all rows.
 */
const query = ({ actor, entity, action, from, to, q } = {}) => {
  const params = {};
  if (actor) params.actor = actor;
  if (entity) params.entity = entity;
  if (action) params.action = action;
  if (from) params.from = from;
  if (to) params.to = to;
  if (q && q.trim()) params.q = q.trim();
  return params;
};

export async function listStaffActivity({ page = 0, size = 50, ...filter } = {}) {
  const res = await get('/admin/staff-activity', { ...query(filter), page, size });
  return unwrapPage(res, { page, size });
}

export async function getStaffActivitySummary(filter = {}) {
  const res = await get('/admin/staff-activity/summary', query(filter));
  return {
    total: res?.total ?? 0,
    staffCount: res?.staffCount ?? 0,
    byEntity: Array.isArray(res?.byEntity) ? res.byEntity : [],
    actions: Array.isArray(res?.actions) ? res.actions : [],
    leaderboard: Array.isArray(res?.leaderboard) ? res.leaderboard : [],
  };
}
