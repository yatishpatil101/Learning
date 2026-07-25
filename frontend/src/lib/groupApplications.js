import { useCallback, useEffect, useState } from 'react';

/* Flat-share group applications addressed to an owner. Mirrors the prototype's
   `puneNestGroupApplications` localStorage store + seed, with accept/decline. */
const KEY = 'puneNestGroupApplications';
const SEED = [
  { id: 'A-seed1', listingTitle: '2 BHK Flat in Baner', locality: 'Baner', rent: 34000, perHead: 17000, groupTitle: '2 girls → 1 more for a 2BHK in Baner', applicantName: 'Riya', members: 2, seatsTotal: 3, status: 'pending', at: '4 hours ago' },
  { id: 'A-seed2', listingTitle: '3 BHK Flat in Hinjawadi', locality: 'Hinjawadi', rent: 42000, perHead: 14000, groupTitle: '3 engineers for a 3BHK near IT park', applicantName: 'Aditya', members: 2, seatsTotal: 3, status: 'pending', at: '1 day ago' },
];

function load() {
  let stored = [];
  try {
    stored = JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    stored = [];
  }
  const ids = new Set(stored.map((a) => a.id));
  return stored.concat(SEED.filter((a) => !ids.has(a.id)));
}

export function useGroupApplications() {
  const [apps, setApps] = useState(load);

  useEffect(() => {
    // Persist only non-seed mutations (decisions get written through setStatus).
  }, []);

  const setStatus = useCallback((id, status) => {
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      stored = [];
    }
    let rec = stored.find((x) => x.id === id);
    if (!rec) {
      const seed = SEED.find((x) => x.id === id);
      if (seed) {
        rec = { ...seed };
        stored.unshift(rec);
      }
    }
    if (rec) {
      rec.status = status;
      localStorage.setItem(KEY, JSON.stringify(stored));
    }
    setApps(load());
  }, []);

  return { apps, setStatus };
}
