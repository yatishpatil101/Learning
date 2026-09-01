/* Unified owner-property surface.

   A single source of truth for the dashboard "My Properties" tab: every property
   the owner has — whether saved privately via the Rent-o-meter or posted to the
   marketplace — plus their flatmate / flatmate posts, in one list.

   - Posted property listings are bridged to a managed record (idempotently) so
     each carries its passport/tools link and posting auto-adds it here.
   - Private managed props (saved, not yet published) appear as `private` items.
   - Flatmate / flatmate posts pass through unchanged.

   Dedup: a published managed prop is represented once, by its posted listing
   (private items exclude anything already published). */

import { digits } from '../contact.js';
import { loadMyListings } from './myListings.js';
import { listManaged, ensureManagedForListing } from '../../services/managedService.js';
import { getDocsForProp } from './documents.js';
import { passportPercent } from '../../pages/consumer/owner-hub/helpers.js';

const isProperty = (l) => !l.flatmate && !l.flatmatePost && !l.flatmateGroup;

export async function loadOwnerProperties(user) {
  const posted = await loadMyListings(user);
  const mobile = user?.mobile || '';
  const mine10 = digits(mobile).slice(-10);

  // One read of the managed set, up front. It is both halves of the job: the dedup key for the
  // bridge below (D32 decision C — dedup against the list we already hold rather than asking the
  // server per listing) and the source of the private records appended at the end. Reading it once
  // is the difference between one request and one per listing on every dashboard load.
  let managed = await listManaged();
  const claimed = new Set(managed.map((m) => m.publishedListingId).filter(Boolean));

  // Bridge each genuinely-owned property listing to a managed record so it shows its passport and
  // tools. Strict ownership match keeps demo-fallback and other owners' listings out. Sequential on
  // purpose: each successful bridge changes the dedup set, and a batch of parallel creates for the
  // same listing is exactly what the unique index would have to reject.
  const withTools = [];
  for (const l of posted) {
    if (!isProperty(l)) {
      withTools.push(l);
      continue;
    }
    const owner = digits(l.ownerMobile).slice(-10);
    if (!owner || !mine10 || owner !== mine10) {
      withTools.push(l);
      continue;
    }
    let mp = managed.find((m) => m.publishedListingId === l.id)
      || (l.fromManaged ? managed.find((m) => m.id === l.fromManaged) : null);
    if (!mp && !claimed.has(l.id)) {
      mp = await ensureManagedForListing(l);
      if (mp) {
        managed = [mp, ...managed];
        claimed.add(l.id);
      }
    }
    if (!mp) {
      withTools.push(l);
      continue;
    }
    const docCount = getDocsForProp(mobile, mp.id).length;
    withTools.push({ ...l, managedId: mp.id, passportPct: passportPercent(mp, docCount) });
  }

  // Private managed props (Rent-o-meter saves) that aren't published yet.
  const privateManaged = managed
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
