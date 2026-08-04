/* ViewDocuments data helper — loads shared documents from the same localStorage
   keys the HTML uses (puneNestDocs:owner, puneNestDocReq:owner).

   Returns i18n keys rather than English copy: this module has no access to the
   translator, and baking sentences in here would quietly create a second,
   untranslated copy deck the locale gates can't see. The caller resolves them.
   `sub` is `{ key, args }` so a count can be interpolated in any word order. */

export function loadSharedDocuments(owner, reqId, propId, singleDocId) {
  try {
    const docsStore = JSON.parse(localStorage.getItem('puneNestDocs:' + owner)) || {};
    const shared = [];
    let sub = null;
    let errorState = null;

    if (reqId) {
      const reqs = JSON.parse(localStorage.getItem('puneNestDocReq:' + owner)) || [];
      const req = reqs.find((r) => r.id === reqId);
      if (!req || req.status !== 'granted') {
        errorState = {
          titleKey: 'viewDocs.errRevokedTitle',
          textKey: 'viewDocs.errRevokedText',
          subKey: 'viewDocs.errRevokedSub',
        };
        return { shared, sub, errorState };
      }
      // One link shows every paper this buyer was approved for on this property:
      // union the sharedDocIds across all of their granted requests (a due-diligence
      // request spans several documents, each stored as its own record).
      const pool = docsStore[req.propId] || [];
      const grantedIds = new Set(
        reqs
          .filter((r) => r.propId === req.propId && r.buyerMobile === req.buyerMobile && r.status === 'granted')
          .flatMap((r) => r.sharedDocIds || []),
      );
      const sharedDocs = [...grantedIds].map((id) => pool.find((x) => x.id === id)).filter(Boolean);
      if (sharedDocs.length === 0) {
        // Access was approved, but the owner hasn't uploaded the actual files yet.
        errorState = {
          titleKey: 'viewDocs.errPendingTitle',
          textKey: 'viewDocs.errPendingText',
          subKey: 'viewDocs.errPendingSub',
        };
        return { shared, sub, errorState };
      }
      return { shared: sharedDocs, sub: { key: 'viewDocs.sharedCount', args: { count: sharedDocs.length } } };
    } else if (propId && singleDocId) {
      const pool = docsStore[propId] || [];
      const doc = pool.find((x) => x.id === singleDocId);
      return { shared: doc ? [doc] : [], sub: { key: 'viewDocs.ownerPreview' } };
    } else {
      errorState = {
        titleKey: 'viewDocs.errInvalidTitle',
        textKey: 'viewDocs.errInvalidText',
        subKey: 'viewDocs.errInvalidSub',
      };
      return { shared, sub, errorState };
    }
  } catch {
    return {
      shared: [],
      sub: null,
      errorState: {
        titleKey: 'viewDocs.errLoadTitle',
        textKey: 'viewDocs.errLoadText',
        subKey: 'viewDocs.errLoadSub',
      },
    };
  }
}
