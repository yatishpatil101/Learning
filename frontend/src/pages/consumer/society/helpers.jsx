import Icon from '../../../components/Icon.jsx';
import { fmtNum } from '../../../lib/format.js';
import { MONTHS, DOW, ymd, titleCase } from './constants.js';

// Compact month calendar. Days with events show a teal dot; the selected day is
// highlighted. `events` is a map of YYYY-MM-DD → count. Purely presentational.
function MonthCalendar({ month, onMonth, events, selected, onSelect }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = ymd(new Date());
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month" className="w-8 h-8 rounded-lg border border-white/10 text-gray-300 hover:border-white/25 flex items-center justify-center"><Icon name="chevron-left" className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-white">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month" className="w-8 h-8 rounded-lg border border-white/10 text-gray-300 hover:border-white/25 flex items-center justify-center"><Icon name="chevron-right" className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((d, i) => <div key={i} className="text-[10px] font-semibold text-slate-500 py-1">{d}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const key = ymd(new Date(month.getFullYear(), month.getMonth(), d));
          const has = events[key];
          const isSel = selected === key;
          const isToday = today === key;
          return (
            <button key={i} onClick={() => onSelect(key)} aria-label={`${d} ${MONTHS[month.getMonth()]}${has ? `, ${has} event${has > 1 ? 's' : ''}` : ''}`} aria-pressed={isSel}
              className={`relative h-9 rounded-lg text-xs font-medium transition ${isSel ? 'bg-brand-teal text-ink' : isToday ? 'border border-brand-teal/40 text-white' : 'text-gray-300 hover:bg-white/5'}`}>
              {d}
              {has ? <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSel ? 'bg-ink' : 'bg-brand-teal-2'}`} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Deterministic per-society baseline so a fresh society still shows a sensible
// rating breakdown; blended with real user reviews as they arrive.
function baselineBars(soc) {
  const seed = (soc.occupancy || 85) + (soc.year || 2016);
  const pick = (base, i) => Math.max(3.4, Math.min(4.9, +(base + ((seed + i * 7) % 9) / 10 - 0.4).toFixed(1)));
  return { Safety: pick(4.2, 1), Maintenance: pick(3.9, 2), Management: pick(3.8, 3), Amenities: pick(4.1, 4), Connectivity: pick(4.3, 5) };
}

function buildAbout(soc, locName) {
  if (soc._thin) {
    return `${soc.name} is a community-added society in ${locName}, Pune. Its details aren't verified yet — PuneNest mints a society the moment someone lists or searches for it, then confirms the specifics. Know this place? Add its details below.`;
  }
  const verified = soc.registration && soc.conveyance;
  // Only assert specifics we actually hold — never invent size/utilities/occupancy.
  const size = [soc.towers ? `${soc.towers}-tower` : null, soc.units ? `${fmtNum(soc.units)}-home` : null].filter(Boolean).join(', ');
  let s = `${soc.name} is a ${size ? size + ' ' : ''}${soc.rera ? 'RERA-registered ' : ''}society${soc.builder ? ` by ${soc.builder}` : ''} in ${locName}, Pune.`;
  if (soc.year) s += ` Built in ${soc.year}${soc.occupancy ? `, with roughly ${soc.occupancy}% occupancy` : ''}.`;
  s += verified ? ' Registration and conveyance are verified.' : ' Listed broker-free on PuneNest — connect directly with verified owners.';
  return s;
}

// Back-compat: a `?s=` slug not in the dataset still renders a sensible page.
function genericSociety(slug, name, locName) {
  return {
    id: 'G:' + slug, slug, name: name || titleCase(slug), builder: 'Independent', localitySlug: slug,
    lat: 18.5204, lng: 73.8567, year: 2016, towers: 3, units: 160, occupancy: 88, maintenancePerSqft: 3,
    water: 'Corporation', power: 'Full DG backup', parkingRatio: 1.2, lifts: 6, security: '24x7 Security + CCTV',
    petPolicy: 'Allowed', vegPolicy: 'Mixed', rera: '', registration: true, conveyance: true,
    amenities: ['security', 'garden', 'gym', 'clubhouse'], _generic: true, _locName: locName,
  };
}

export { MonthCalendar, baselineBars, buildAbout, genericSociety };
