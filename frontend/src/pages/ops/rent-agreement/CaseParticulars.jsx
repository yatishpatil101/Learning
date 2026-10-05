import { useId, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { openDocUrl } from '../../../lib/openDoc.js';
import { classNames } from '../../../lib/format.js';
import { Fields, deedGroups } from '../service-queue/DeedParticulars.jsx';
import { PaperRow, PapersNotice, papersCount, usePaperReview } from '../service-queue/DocumentChecklist.jsx';
import ServiceDocuments from '../service-queue/ServiceDocuments.jsx';

const card = 'rounded-xl border border-white/10 bg-black/10 p-4';
const label = 'text-[11px] uppercase tracking-wide text-gray-500';
const KEY_TERMS = new Set(['Rent', 'Refundable deposit', 'Term', 'Start date']);
// Checklist ids are `licensor-0-pan`, `tenant-1-photo`, `ownership-proof`; anything not a person's belongs to the property.
const ownerKey = (id) => /^(licensor|tenant)-\d+/.exec(id)?.[0] || 'property';
const shortName = (name) => name.split(' — ').slice(1).join(' — ') || name;
const indexOf = (key) => Number(key.split('-')[1]);

/** Deed cards of one kind, plus a bare card for a party the checklist names but the form left blank. */
function partyCards(groups, items, kind, prefix, title) {
  const cards = groups.filter((g) => g.kind === kind);
  const extra = [...new Set(items.map((i) => ownerKey(i.id)))]
    .filter((key) => key.startsWith(prefix) && !cards.some((g) => g.key === key))
    .map((key) => ({ key, kind, title: `${title} ${indexOf(key) + 1}`, name: '', rows: [] }));
  return [...cards, ...extra].sort((a, b) => indexOf(a.key) - indexOf(b.key));
}

/** The case file as tabs: one per party kind, each card holding that party's own papers, then the flat and the terms. */
export default function CaseParticulars({ request, checklist, status, onChecklist, onError, onUnavailable, children }) {
  const base = useId();
  const [tab, setTab] = useState('licensor');
  const review = usePaperReview(request, onChecklist, onError);
  const groups = deedGroups(request.details);
  const items = status === 'ready' ? checklist.items : [];
  const docs = request.docs || [];
  const claimed = new Set(items.map((i) => i.documentId).filter(Boolean));
  const others = docs.filter((d) => !claimed.has(d.id));
  const open = (doc) => { if (!openDocUrl(doc.url)) onUnavailable(); };
  const find = (key) => groups.find((g) => g.key === key);

  const detailCard = (group) => (
    <DetailCard
      key={group.key}
      group={group}
      papers={items.filter((i) => ownerKey(i.id) === group.key)}
      paperRow={(item) => (
        <PaperRow key={item.id} item={item} label={shortName(item.name)} review={review}
          file={docs.find((d) => d.id === item.documentId)} onOpen={open} />
      )}
    />
  );
  const licensees = partyCards(groups, items, 'licensee', 'tenant-', 'Licensee');
  const witnesses = groups.filter((g) => g.kind === 'witness');

  const sections = [
    { id: 'licensor', title: 'Licensor', prefix: 'licensor-', body: partyCards(groups, items, 'licensor', 'licensor-', 'Licensor').map(detailCard) },
    { id: 'licensee', title: 'Licensee', prefix: 'tenant-', body: licensees.length ? licensees.map(detailCard) : <p className="text-sm text-gray-500">No licensee on the form.</p> },
    witnesses.length ? { id: 'witnesses', title: 'Witnesses', body: <div className="grid gap-3 md:grid-cols-2">{witnesses.map(detailCard)}</div> } : null,
    children ? { id: 'ids', title: 'ID numbers', body: children } : null,
    { id: 'property', title: 'Property', prefix: 'property', body: detailCard(find('property') || { key: 'property', title: 'Property', name: '', rows: [] }) },
    { id: 'terms', title: 'Terms', body: <TermsCard terms={find('terms')} visit={find('visit')} /> },
    others.length ? {
      id: 'files', title: items.length ? 'Other files' : 'Files',
      body: (
        <div className={card}>
          <ServiceDocuments
            documents={others}
            onUnavailable={onUnavailable}
            title=""
            labels={Object.fromEntries(items.map((i) => [i.id, `${i.name} · earlier copy`]))}
            className=""
          />
        </div>
      ),
    } : null,
  ].filter(Boolean);
  const current = sections.find((s) => s.id === tab) || sections[0];
  const tally = (prefix) => {
    const mine = items.filter((i) => ownerKey(i.id).startsWith(prefix));
    return mine.length ? `${mine.filter((i) => i.review === 'verified').length}/${mine.length}` : '';
  };

  return (
    <div className="space-y-4">
      <section aria-labelledby={`${base}-papers`} className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <FolderOpen className="h-4 w-4 text-brand-teal" aria-hidden="true" />
          <h4 id={`${base}-papers`} className="text-sm font-semibold">Papers</h4>
          {status === 'ready' ? <span className="ml-auto text-sm text-gray-400">{papersCount(checklist, review.gated)}</span> : null}
        </div>
        <PapersNotice checklist={checklist} status={status} review={review} />
      </section>

      <div role="tablist" aria-label="Case sections" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-white/10">
        {sections.map((s) => {
          const count = s.prefix ? tally(s.prefix) : '';
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`${base}-tab-${s.id}`}
              aria-controls={`${base}-panel`}
              aria-selected={current.id === s.id}
              onClick={() => setTab(s.id)}
              className={classNames('relative -mb-px inline-flex min-h-[40px] flex-shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors', current.id === s.id
                ? 'border-brand-teal text-white'
                : 'border-transparent text-gray-400 hover:text-gray-200')}
            >
              {s.title}
              {count ? <span className="text-xs font-normal text-gray-500">{count}<span className="sr-only"> papers verified</span></span> : null}
            </button>
          );
        })}
      </div>

      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${current.id}`} className="space-y-3">
        {current.body}
      </div>
    </div>
  );
}
function DetailCard({ group, papers, paperRow }) {
  const verified = papers.filter((p) => p.review === 'verified').length;
  return (
    <article aria-label={group.title} className={card}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {group.name ? <span className="font-semibold text-white">{group.name}</span> : null}
        <span className={group.name ? 'text-xs uppercase tracking-wide text-gray-500' : 'text-sm font-semibold'}>{group.title}</span>
        {papers.length ? (
          <span className={classNames('ml-auto rounded-full px-2 py-0.5 text-xs', verified === papers.length ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-gray-400')}>
            {verified}/{papers.length} papers verified
          </span>
        ) : null}
      </header>
      <div className={classNames('mt-3 grid gap-4', papers.length > 0 && 'md:grid-cols-2')}>
        {group.rows.length ? <Fields rows={group.rows} /> : null}
        {!group.rows.length && !group.name ? <p className="text-sm text-gray-500">No details on the form.</p> : null}
        {papers.length ? (
          <div className="min-w-0 md:border-l md:border-white/10 md:pl-4">
            <h5 className={label}>Papers</h5>
            <ul className="mt-1">{papers.map(paperRow)}</ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TermsCard({ terms, visit }) {
  const rows = terms?.rows || [];
  const key = rows.filter(([l]) => KEY_TERMS.has(l));
  const rest = rows.filter(([l]) => !KEY_TERMS.has(l));
  return (
    <div className={card}>
      {key.length ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {key.map(([l, v]) => (
            <div key={l} className="rounded-lg bg-white/5 px-3 py-2">
              <dt className={label}>{l}</dt>
              <dd className="text-base font-semibold text-white">{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {rest.length ? <div className={key.length ? 'mt-4' : ''}><Fields rows={rest} /></div> : null}
      {visit ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <h5 className={label}>Biometric visit</h5>
          <div className="mt-2"><Fields rows={visit.rows} /></div>
        </div>
      ) : null}
      {!rows.length && !visit ? <p className="text-sm text-gray-500">No terms on the form.</p> : null}
    </div>
  );
}
