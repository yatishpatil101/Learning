/* ViewDocuments data helper — loads shared documents from the same localStorage
   keys the HTML uses (puneNestDocs:owner, puneNestDocReq:owner). */

export function loadSharedDocuments(owner, reqId, propId, singleDocId) {
  try {
    const docsStore = JSON.parse(localStorage.getItem('puneNestDocs:' + owner)) || {};
    const shared = [];
    let sub = '';
    let errorState = null;

    if (reqId) {
      const reqs = JSON.parse(localStorage.getItem('puneNestDocReq:' + owner)) || [];
      const req = reqs.find((r) => r.id === reqId);
      if (!req || req.status !== 'granted') {
        errorState = {
          title: 'Access not available',
          text: 'This share link is no longer active or access has been revoked by the owner.',
          sub: 'Access unavailable',
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
          title: 'Documents not uploaded yet',
          text: 'The owner approved your request but hasn’t uploaded these documents yet. Please check back shortly.',
          sub: 'Approved — awaiting upload',
        };
        return { shared, sub, errorState };
      }
      return { shared: sharedDocs, sub: sharedDocs.length + ' document(s) shared for your review.' };
    } else if (propId && singleDocId) {
      const pool = docsStore[propId] || [];
      const doc = pool.find((x) => x.id === singleDocId);
      return { shared: doc ? [doc] : [], sub: 'Owner preview (view-only).' };
    } else {
      errorState = {
        title: 'Invalid link',
        text: 'This document link is missing required information.',
        sub: 'Invalid link',
      };
      return { shared, sub, errorState };
    }
  } catch (e) {
    return {
      shared: [],
      sub: 'Error loading documents',
      errorState: {
        title: 'Error',
        text: 'Unable to load shared documents.',
        sub: 'Error',
      },
    };
  }
}
