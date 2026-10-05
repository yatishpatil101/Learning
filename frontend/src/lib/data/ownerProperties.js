import { loadMyListings } from './myListings.js';
import { listManaged } from '../../services/managedService.js';
import { passportPercent } from '../../pages/consumer/owner-hub/helpers.js';

const isProperty = (l) => !l.flatmate && !l.flatmatePost && !l.flatmateGroup;
const listingKeys = (listing) => [listing.uuid, listing.id].filter(Boolean).map(String);

export async function loadOwnerProperties(user) {
  const [posted, managed] = await Promise.all([
    loadMyListings(user),
    listManaged(),
  ]);

  const managedByPublishedId = new Map();
  managed.forEach((record) => {
    if (record.publishedListingId) managedByPublishedId.set(String(record.publishedListingId), record);
  });

  const withTools = posted.map((listing) => {
    if (!isProperty(listing)) return listing;
    const managedRecord = listingKeys(listing)
      .map((key) => managedByPublishedId.get(key))
      .find(Boolean)
      || (listing.fromManaged ? managed.find((record) => record.id === listing.fromManaged) : null);
    if (!managedRecord) return listing;
    return {
      ...listing,
      managedId: managedRecord.id,
      passportPct: passportPercent(managedRecord, 0),
    };
  });

  const privateManaged = managed
    .filter((record) => !record.publishedListingId)
    .map((record) => ({
      id: record.id,
      managedId: record.id,
      private: true,
      title: record.title,
      locality: record.locality,
      price: record.price,
      deal: record.deal,
      status: 'private',
      image: record.image || record.img,
      img: record.img || record.image,
      views: 0,
      real: true,
      type: record.type,
      rented: !!record.rented,
      passportPct: passportPercent(record, 0),
      createdAt: record.createdAt,
    }));

  return [...privateManaged, ...withTools];
}
