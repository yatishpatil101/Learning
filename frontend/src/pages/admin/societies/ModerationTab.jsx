import { useState } from 'react';
import { MessageCircle, MapPin } from 'lucide-react';
import { classNames, fmtNum } from '../../../lib/format.js';
import {
  CHIP, CHIP_TONE, Chips, FactRow, PageNav, QueuePanel, RowCard, RowList, useClientPaging,
} from '../../../components/admin/WorkQueue.jsx';
import { titleCase, fmtDate, actBtn, TEAL, RED } from './helpers.jsx';

// No endpoint answers "is this a real WhatsApp invite"; same regex as lib/store/societyMod.js.
const isSafeWhatsappUrl = (u) => /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{6,32}$/.test(String(u || ''));

/** Group links and pin corrections are `kind` filters on `/admin/society-proposals`, so rows share a shape. */
export default function ModerationTab({ waPending, locFixes, decideWa, decideLoc, deciding, note }) {
  const [kind, setKind] = useState('');
  // A decision is a round trip; without this the buttons stay live and look ignored.
  const busy = (id) => Boolean(deciding && deciding.has(id));

  const all = [
    ...waPending.map((w) => ({ ...w, kind: 'wa' })),
    ...locFixes.map((l) => ({ ...l, kind: 'loc' })),
  ];
  const rows = kind ? all.filter((r) => r.kind === kind) : all;
  const page = useClientPaging(rows, 10, kind);
  const chips = [
    { value: '', label: `All ${fmtNum(all.length)}` },
    { value: 'wa', label: `WhatsApp links ${fmtNum(waPending.length)}` },
    { value: 'loc', label: `Location fixes ${fmtNum(locFixes.length)}` },
  ];

  const societyLink = (r) => (
    <a href={`/society/${r.societySlug}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-teal hover:underline">{titleCase(r.societySlug)}</a>
  );

  const card = (r) => {
    const wa = r.kind === 'wa';
    const decide = wa ? decideWa : decideLoc;
    return (
      <RowCard
        key={r.id}
        id={r.id}
        title={societyLink(r)}
        badges={wa
          ? <span className={classNames(CHIP, CHIP_TONE.green, 'gap-0.5')}><MessageCircle className="h-2.5 w-2.5" aria-hidden="true" />WhatsApp link</span>
          : <span className={classNames(CHIP, CHIP_TONE.teal, 'gap-0.5')}><MapPin className="h-2.5 w-2.5" aria-hidden="true" />Location fix</span>}
        meta={<><span>Proposed by {r.authorName || 'Resident'}</span><span className="text-gray-600" aria-hidden="true">·</span><span>{fmtDate(r.createdAt)}</span></>}
        facts={wa ? (
          <FactRow label="Link">
            <span className="col-span-2 truncate md:col-span-4">
              {isSafeWhatsappUrl(r.inviteUrl)
                ? <a href={r.inviteUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:underline">{r.inviteUrl}</a>
                : <span className="text-red-300">⚠ Invalid link — reject: {r.inviteUrl}</span>}
            </span>
          </FactRow>
        ) : (
          <FactRow label="Pin">
            <a href={`https://www.google.com/maps/search/?api=1&query=${Number(r.lat)},${Number(r.lng)}`} target="_blank" rel="noopener noreferrer" className="tabular-nums text-brand-teal hover:underline">{Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}</a>
            {r.label ? <span className="truncate md:col-span-3">{r.label}</span> : null}
          </FactRow>
        )}
        primary={(
          <>
            {actBtn('Approve', TEAL, () => decide(r, 'approve'), busy(r.id))}
            {actBtn('Reject', RED, () => decide(r, 'reject'), busy(r.id))}
          </>
        )}
      />
    );
  };

  return (
    <QueuePanel
      active="moderation"
      note={note}
      toolbar={(
        <>
          <Chips label="Type" options={chips} value={kind} onChange={setKind} />
          <div className="ml-auto"><PageNav {...page.paging} /></div>
        </>
      )}
      footer={page.paging.pageCount > 1 ? <PageNav {...page.paging} /> : null}
    >
      <RowList isEmpty={!rows.length} empty="Nothing awaiting review. Residents propose group links and pin corrections from the society hub.">
        {page.items.map(card)}
      </RowList>
    </QueuePanel>
  );
}
