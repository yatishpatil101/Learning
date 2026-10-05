import { FileText, Image as ImageIcon, Info, MapPin, User } from 'lucide-react';
import { classNames, fmtINR, isoToDisplay } from '../../../../lib/format.js';
import { Block, fmtDate } from '../board.jsx';

const human = (v) => {
  const s = String(v ?? '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
};
const list = (xs) => (xs || []).filter(Boolean).map(human).join(', ');
const months = (n) => (n == null ? '' : `${n} month${n === 1 ? '' : 's'}`);
const days = (n) => (n == null ? '' : `${n} day${n === 1 ? '' : 's'}`);
const money = (n) => (n ? fmtINR(n) : '');
const moveIn = (v) => (!v ? 'Flexible' : v === 'now' ? 'Immediately' : isoToDisplay(v) || human(v));

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

function occupancyOf(r) {
  if (r.seatsTotal == null) return r.maxOccupants ? `${people(r.occupants)} of ${r.maxOccupants} max` : human(r.occupancy);
  return r.occupants ? people(r.occupants) : 'Nobody — flat is empty';
}

function flatOf(r) {
  const size = r.flatType || (r.bhk && `${r.bhk === '4' ? '4+' : r.bhk} BHK`);
  return [size, (r.homeTypeLabel || '').toLowerCase()].filter(Boolean).join(' ');
}

function roomKvs(r) {
  const roomFor = r.seatsTotal == null ? r.roomType : r.roomType === 'Shared room' ? 'Double sharing' : 'Single';
  return [
    ['Headline', r.title, true],
    ['Rent', r.budget ? `${fmtINR(r.budget)} / month ${r.priceBasis === 'room' ? 'for the room' : 'per person'}` : ''],
    ['Deposit', money(r.deposit)],
    ['Room', [roomFor, r.attachedBath && `${human(r.attachedBath)} bath`].filter(Boolean).join(' · ')],
    ['Flat size', flatOf(r)],
    ['Society', [r.society, r.flatNumber && `Flat ${r.flatNumber}`].filter(Boolean).join(' · ')],
    ['Furnishing', human(r.furnishing)],
    ['Already living in the flat', occupancyOf(r)],
    ['Gender', human(r.gender)],
    ['Food', human(r.food)],
    ['Available from', r.availableFrom ? isoToDisplay(r.availableFrom) : human(r.moveIn)],
    ['Notice period', days(r.noticePeriodDays)],
    ['Lock-in', months(r.lockInMonths)],
    ['Maintenance', human(r.maintenanceBilling)],
    ['Electricity', human(r.electricityBilling)],
    ['Host is', human(r.hostRole)],
    ['Gated community', r.gatedCommunity ? 'Yes' : 'No'],
    ['Tags', list(r.tags), true],
  ];
}

function groupKvs(g) {
  return [
    ['Rent', money(g.rent)],
    ['Per head', money(g.perHead)],
    ['Deposit', money(g.deposit)],
    ['Seats', `${g.seatsOpen} open of ${g.seatsTotal}`],
    ['Joining', human(g.policy)],
    ['Host is', human(g.hostRole)],
    ['Owner consent', g.ownerConsent ? 'Given' : 'Not given'],
    ['Move in by', g.preferences ? moveIn(g.preferences.moveInBy) : ''],
    ['Notice period', days(g.noticePeriodDays)],
    ['Lock-in', months(g.lockInMonths)],
    ['Maintenance', human(g.maintenanceBilling)],
    ['Electricity', human(g.electricityBilling)],
    ['Members', g.members.map((m) => m.name).filter(Boolean).join(', '), true],
    ['Tags', list(g.tags), true],
  ];
}

function postKvs(p) {
  const budget = p.budgetMax ? `${fmtINR(p.budget)} – ${fmtINR(p.budgetMax)}` : money(p.budget);
  return [
    ['Headline', p.title, true],
    ['Budget', budget ? `${budget} / month` : ''],
    ['Age', p.age == null ? '' : String(p.age)],
    ['Gender', human(p.gender)],
    ['Occupation', p.occupation],
    ['Move-in', moveIn(p.moveIn)],
    ['Flat preference', human(p.flatPref)],
    ['Room preference', human(p.roomPref)],
    ['Only verified may contact', p.verifiedContactOnly ? 'Yes' : 'No'],
    ['Localities', list(p.localities), true],
    ['Tags', list(p.tags), true],
  ];
}

function hostOf({ room, group, post }) {
  if (room) return { name: room.owner, mobile: room.ownerMobile };
  if (group) return { name: group.ownerName, mobile: group.ownerMobile };
  if (post) return { name: post.name, mobile: post.mobile };
  return { name: '', mobile: '' };
}

export default function PostDetails({ detail }) {
  const { item, room, group, post } = detail;
  const kvs = (room ? roomKvs(room) : group ? groupKvs(group) : post ? postKvs(post) : [])
    .filter(([, v]) => v);
  const host = hostOf(detail);
  return (
    <>
      {item.photos.length ? (
        <Block icon={ImageIcon} title={`Photos (${item.photos.length})`}>
          <div className="flatmate-mod-photos grid grid-cols-3 gap-2 sm:grid-cols-4">
            {/* Index key: nothing de-duplicates the list. Every photo is shown — a swapped one is as likely last as first. */}
            {item.photos.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer noopener" className="block">
                <img
                  src={src}
                  alt={`Photo ${i + 1} of ${item.photos.length}`}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full rounded-xl object-cover ring-1 ring-white/10"
                />
              </a>
            ))}
          </div>
        </Block>
      ) : null}

      {/* Never truncated: a broker blocked from the contact field types the number in here. */}
      <Block icon={FileText} title="What they wrote">
        {item.freeText ? (
          <p className="flatmate-mod-text whitespace-pre-wrap break-words text-sm text-gray-200">{item.freeText}</p>
        ) : (
          <p className="text-sm text-gray-500">Nothing written.</p>
        )}
      </Block>

      {kvs.length ? (
        <Block icon={Info} title="Details">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
            {kvs.map(([k, v, full]) => (
              <div key={k} className={classNames('bg-ink-2 p-3', full && 'col-span-2 sm:col-span-3')}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k}</div>
                <div className="mt-0.5 break-words text-sm font-semibold text-gray-100">{v}</div>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      <Block icon={User} title="Posted by">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="font-semibold text-gray-100">{host.name || item.authorName || '—'}</span>
          <span className="text-gray-400">{host.mobile || 'No mobile on file'}</span>
          <span className="text-gray-500">Posted {fmtDate(item.createdAt)}</span>
          {item.locality ? (
            <span className="inline-flex items-center gap-1 text-gray-400"><MapPin className="h-3.5 w-3.5" />{item.locality}</span>
          ) : null}
        </div>
      </Block>
    </>
  );
}
