/* Unified owner-property surface.

   A single source of truth for the dashboard "My Properties" tab: every property
   the owner has — whether saved privately via the Rent-o-meter or posted to the
   marketplace — plus their flatmate / flat-share posts, in one list.

   - Posted property listings are bridged to a managed record (idempotently) so
     each carries its passport/tools link and posting auto-adds it here.
   - Private managed props (saved, not yet published) appear as `private` items.
   - Flatmate / flat-share posts pass through unchanged.

   Dedup: a published managed prop is represented once, by its posted listing
   (private items exclude anything already published). */

import { digits } from '../contact.js';
import { loadMyListings } from './myListings.js';
import { getManagedProps, ensureManagedForListing } from './managedProperty.js';
import { getDocsForProp } from './documents.js';
import { passportPercent } from '../../pages/consumer/owner-hub/helpers.js';

const isProperty = (l) => !l.flatmate && !l.shareRequest && !l.shareGroup;

export async function loadOwnerProperties(user) {
  const posted = await loadMyListings(user);
  const mobile = user?.mobile || '';
  const mine10 = digits(mobile).slice(-10);

  // Bridge each genuinely-owned property listing to a managed record so it shows
  // its passport/tools. Strict ownership match keeps demo-fallback and other
  // owners' listings out of the user's managed store.
  const withTools = posted.map((l) => {
    if (!isProperty(l)) return l;
    const owner = digits(l.ownerMobile).slice(-10);
    if (!owner || !mine10 || owner !== mine10) return l;
    const mp = ensureManagedForListing(l);
    if (!mp) return l;
    const docCount = getDocsForProp(mobile, mp.id).length;
    return { ...l, managedId: mp.id, passportPct: passportPercent(mp, docCount) };
  });

  // Private managed props (Rent-o-meter saves) that aren't published yet.
  const privateManaged = getManagedProps()
    .filter((m) => !m.publishedListingId)
    .map((m) => {
      const docCount = getDocsForProp(mobile, m.id).length;
      return {
        id: m.id,
        managedId: m.id,
        private: true,
        title: m.title,
        locality: m.locality,
        price: m.price,
        deal: m.deal,
        status: 'private',
        image: m.image || m.img,
        img: m.img || m.image,
        views: 0,
        real: true,
        type: m.type,
        rented: !!m.rented,
        passportPct: passportPercent(m, docCount),
        createdAt: m.createdAt,
      };
    });

  // Private (needs publishing) first, then the rest as loadMyListings ordered them.
  return [...privateManaged, ...withTools];
}
