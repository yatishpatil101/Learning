import { useCallback, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { Chips, ClearFilters, DATE_CHIPS, QueuePanel, QueueTabs, SearchBox } from '../../components/admin/WorkQueue.jsx';
import { QueueState } from './flatmate/board.jsx';
import useFlatmateQueue, { QUEUE_TABS } from './flatmate/useFlatmateQueue.js';
import FlatmateQueueCard, { entryKind, entrySummary } from './flatmate/FlatmateQueueCard.jsx';
import FlatmateReviewModal from './flatmate/FlatmateReviewModal.jsx';

const EMPTY = {
  pending: 'Nothing waiting — every flatmate post has been reviewed ✅',
  published: 'Nothing published yet.',
  hidden: 'Nothing hidden or removed.',
};

const NOTES = {
  pending: 'Open only: posts awaiting publish, edits since review, badge claims and group applications. An item leaves once you decide it. Oldest first.',
  published: 'Everything the city can see, plus cleared group applications. Open one to hide or remove it. Newest first.',
  hidden: 'Flagged, removed and rejected posts. Open one to read why, or publish it again. Newest first.',
};

const TYPE_CHIPS = [
  { value: 'all', label: 'All' },
  { value: 'room', label: 'Room' },
  { value: 'group', label: 'Group' },
  { value: 'post', label: 'Seeker post' },
];

const SORT_CHIPS = [{ value: 'oldest', label: 'Oldest' }, { value: 'newest', label: 'Newest' }];

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
  const dirty = type !== 'all' || q !== '' || days !== '' || sort !== '';
  const clear = () => { setType('all'); setQ(''); setDays(''); setSort(''); };
  const close = useCallback(() => setOpen(null), []);
  const ready = loaded.status === 'ready';

  return (
    <div className="pb-20">
      <PageHeader
        title="Flatmate Moderation"
        subtitle="Publish, hide and badge flatmate rooms, groups and seeker posts."
        actions={<button type="button" onClick={loaded.reload} className="dz-btn dz-btn-ghost"><RefreshCw className="h-4 w-4" /> Refresh</button>}
      />

      <QueueTabs
        label="Flatmate queues"
        idPrefix="fm"
        countTestId="fm-count"
        active={tab}
        onChange={setTab}
        tabs={QUEUE_TABS.map((t) => ({
          key: t.id,
          label: t.label,
          count: t.id === tab && ready ? `${loaded.items.length}${loaded.truncated ? '+' : ''}` : null,
        }))}
      />

      <QueuePanel
        idPrefix="fm"
        active={tab}
        note={NOTES[tab]}
        toolbar={(
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Title, author or locality" label="Search the queue" />
            <Chips label="Post type" options={TYPE_CHIPS} value={type} onChange={setType} />
            <Chips label="Sort" options={SORT_CHIPS} value={order} onChange={setSort} />
            <Chips label="Posted" options={DATE_CHIPS} value={days} onChange={setDays} />
            {dirty ? <ClearFilters onClick={clear} /> : null}
            {queue.status === 'ready' ? (
              <p role="status" className="ml-auto text-xs tabular-nums text-gray-400">
                {queue.items.length} {queue.items.length === 1 ? 'item' : 'items'}
                {queue.truncated ? ' · first 100 of each kind — decide some to see the rest' : ''}
              </p>
            ) : null}
          </>
        )}
      >
        <QueueState state={queue} onRetry={queue.reload} empty={filtered ? 'Nothing matches these filters.' : EMPTY[tab]} />

        {queue.status === 'ready' && queue.items.length ? (
          <ul className="space-y-3 p-3">
            {queue.items.map((e) => <FlatmateQueueCard key={e.key} entry={e} onReview={setOpen} />)}
          </ul>
        ) : null}
      </QueuePanel>

      {open ? <FlatmateReviewModal entry={open} onClose={close} onChanged={queue.reload} /> : null}
    </div>
  );
}