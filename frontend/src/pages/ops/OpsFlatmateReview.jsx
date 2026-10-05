import { useCallback, useState } from 'react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Select from '../../components/ui/Select.jsx';
import DateRangePills from '../../components/ui/DateRangePills.jsx';
import { QueueState, Tabs } from './flatmate/board.jsx';
import useFlatmateQueue, { QUEUE_TABS } from './flatmate/useFlatmateQueue.js';
import FlatmateQueueCard, { entryKind, entrySummary } from './flatmate/FlatmateQueueCard.jsx';
import FlatmateReviewModal from './flatmate/FlatmateReviewModal.jsx';

const EMPTY = {
  pending: 'Nothing waiting — every flatmate post has been reviewed ✅',
  published: 'Nothing published yet.',
  hidden: 'Nothing hidden or removed.',
};

const TYPE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'room', label: 'Room' },
  { id: 'group', label: 'Group' },
  { id: 'post', label: 'Seeker post' },
];

const SORT_OPTS = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
];

const typeOf = (entry) => (entryKind(entry) === 'application' ? 'group' : entryKind(entry));

const haystack = (entry) => {
  const s = entrySummary(entry);
  return [s.title, s.locality, s.author, entry.post?.snippet, entry.key].join(' ').toLowerCase();
};

function filterQueue(items, { type, q, days, order }) {
  const needle = q.trim().toLowerCase();
  const cutoff = days ? Date.now() - Number(days) * 86400000 : 0;
  const dir = order === 'oldest' ? 1 : -1;
  return items
    .filter((e) => (type === 'all' || typeOf(e) === type)
      && (!needle || haystack(e).includes(needle))
      // An entry with no timestamp survives every cutoff rather than vanishing from the queue.
      && (!cutoff || !e.since || e.since >= cutoff))
    .sort((a, b) => dir * ((a.since || 0) - (b.since || 0)));
}

export default function OpsFlatmateReview() {
  const [tab, setTab] = useState('pending');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [days, setDays] = useState('');
  const [sort, setSort] = useState('');
  const [open, setOpen] = useState(null);
  const loaded = useFlatmateQueue(tab);
  const order = sort || (tab === 'pending' ? 'oldest' : 'newest');
  const queue = { ...loaded, items: filterQueue(loaded.items, { type, q, days, order }) };
  const filtered = loaded.items.length > 0;
  const close = useCallback(() => setOpen(null), []);

  return (
    <div>
      <PageHeader title="Flatmate Moderation" subtitle="Everything waiting on a decision, oldest first by default. Open one to see the full post." />

      <Tabs tabs={QUEUE_TABS} active={tab} onChange={setTab} label="Flatmate queues" />
      <Tabs tabs={TYPE_TABS} active={type} onChange={setType} label="Post type" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, author, locality…" aria-label="Search the queue" className="dz-input sm:w-72" />
        <Select value={order} onChange={setSort} options={SORT_OPTS} className="sm:w-44" ariaLabel="Sort" />
        <DateRangePills value={days} onChange={setDays} />
        {queue.status === 'ready' ? (
          <p role="status" className="ml-auto text-sm text-gray-400">
            {queue.items.length} {queue.items.length === 1 ? 'item' : 'items'}
            {queue.truncated ? ' · showing the first 100 of each kind — decide some to see the rest' : ''}
          </p>
        ) : null}
      </div>

      <QueueState state={queue} onRetry={queue.reload} empty={filtered ? 'Nothing matches these filters.' : EMPTY[tab]} />

      {queue.status === 'ready' && queue.items.length ? (
        <ul className="space-y-3">
          {queue.items.map((e) => <FlatmateQueueCard key={e.key} entry={e} onReview={setOpen} />)}
        </ul>
      ) : null}

      {open ? <FlatmateReviewModal entry={open} onClose={close} onChanged={queue.reload} /> : null}
    </div>
  );
}