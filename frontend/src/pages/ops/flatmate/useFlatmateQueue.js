import { useCallback, useEffect, useState } from 'react';
import {
  listFlatmateModeration,
  listFlatmateReviews,
  listGroupApplications,
} from '../../../services/flatmateService.js';

const KINDS = ['post', 'room', 'group'];
const PUBLISHED = ['approved', 'live'];
const HIDDEN = ['flagged', 'removed', 'rejected'];
// The API's page ceiling. Past it the desk is told the list is partial rather than shown a short one.
const SOURCE_SIZE = 100;

export const QUEUE_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'published', label: 'Published' },
  { id: 'hidden', label: 'Hidden & removed' },
];

function sourcesFor(tab) {
  const size = SOURCE_SIZE;
  if (tab === 'pending') {
    return [
      { type: 'moderation', load: () => listFlatmateModeration({ kind: KINDS, modStatus: ['pending', 'recheck'], size }) },
      { type: 'badge', load: () => listFlatmateReviews({ status: 'pending', size }) },
      { type: 'application', load: () => listGroupApplications({ modStatus: 'pending', sort: 'createdAt,asc', size }) },
    ];
  }
  const modStatus = tab === 'published' ? PUBLISHED : HIDDEN;
  return [
    { type: 'post', load: () => listFlatmateModeration({ kind: KINDS, modStatus, sort: 'createdAt,desc', size }) },
    { type: 'application', load: () => listGroupApplications({ modStatus, size }) },
  ];
}

const fromPost = (row) => ({
  id: row.id,
  kind: row.kind,
  headline: row.headline,
  locality: row.locality,
  author: row.authorName,
  createdAt: row.createdAt,
  modStatus: row.modStatus,
  photoCount: row.photos.length,
  snippet: row.freeText,
});

// 'new post' must match FlatmatePublication.UNREVIEWED: a flatless post that published itself.
const recheckLabel = (reason) => ((reason || '').split(', ').includes('new post')
  ? 'Live · not yet reviewed' : 'Edited since review');

const badgeReasons = (review) => [
  `Badge claim · ${review.tier}`,
  ...(review.flagForReview ? ['Contested address'] : []),
  ...(review.tier === 'tenant' && !review.ownerConsent ? ['Owner consent missing'] : []),
];

function entryPatch(type, row) {
  switch (type) {
    case 'moderation':
      return row.recheckRequestedAt
        ? { post: fromPost(row), reasons: [recheckLabel(row.recheckReason)], since: row.recheckRequestedAt }
        : { post: fromPost(row), reasons: ['Awaiting publish'], since: row.createdAt };
    case 'badge':
      return { review: row, reasons: badgeReasons(row), since: row.createdAt };
    case 'application':
      return { application: row, reasons: ['Group application'], since: row.at };
    default:
      return { post: fromPost(row), reasons: [], since: row.createdAt };
  }
}

const keyOf = (type, row) => {
  if (type === 'application') return `application:${row.id}`;
  if (type === 'badge') return row.roomId || row.groupId || `review:${row.id}`;
  return row.id;
};

const earliest = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));

/* A room can be awaiting publish and claiming a badge at once. It gets one card with both
   reasons, not two cards that each hide half of what the reviewer must decide. */
export function mergeQueue(tab, results) {
  const byKey = new Map();
  results.forEach(({ type, page }) => page.items.forEach((row) => {
    const key = keyOf(type, row);
    const prev = byKey.get(key) || { key, reasons: [] };
    const patch = entryPatch(type, row);
    byKey.set(key, {
      ...prev,
      ...patch,
      reasons: [...new Set([...prev.reasons, ...patch.reasons])],
      since: earliest(prev.since, patch.since),
    });
  }));
  const oldestFirst = tab === 'pending';
  const items = [...byKey.values()].sort((a, b) => (
    oldestFirst ? (a.since || 0) - (b.since || 0) : (b.since || 0) - (a.since || 0)
  ));
  const truncated = results.some(({ page }) => page.total > page.items.length);
  return { items, truncated };
}

/* One failed source fails the whole tab: a queue missing a third of its rows would read as
   "nothing to do" when the truth is "the read did not work". */
export default function useFlatmateQueue(tab) {
  const [state, setState] = useState({ status: 'loading', items: [], truncated: false, error: '' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    const sources = sourcesFor(tab);
    Promise.all(sources.map((s) => s.load().then((page) => ({ type: s.type, page }))))
      .then((results) => {
        if (alive) setState({ status: 'ready', ...mergeQueue(tab, results), error: '' });
      })
      .catch((e) => {
        if (alive) setState({ status: 'error', items: [], truncated: false, error: e.message || 'Could not read this queue.' });
      });
    return () => { alive = false; };
  }, [tab, nonce]);

  return { ...state, reload };
}
