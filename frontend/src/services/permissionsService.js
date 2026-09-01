/**
 * Back-office permissions — the seam over `/admin/permission-catalogue` and `/users/{id}/permissions`.
 *
 * Http-only. There is no mock provider and no `createProvider` indirection here, because there is
 * nothing to fall back to: the model these three routes expose did not exist before the server
 * grew it. The console's old answer — `lib/permissions.js` composing a client-side union — was not
 * a mock of this, it was a *different and contradictory* rule (it could only widen; the server's
 * document can only narrow), and offering it as the offline branch would mean the Team & Access
 * page shows one access model on mocks and another live.
 *
 * That makes this the first domain in `services/` that is deliberately not switchable, so the
 * import is direct rather than going through `config.js`. Every export is still async, which is
 * the seam's actual invariant.
 */
export {
  getPermissionCatalogue,
  getMemberPermissions,
  saveMemberPermissions,
} from './providers/http/permissionsProvider.js';
