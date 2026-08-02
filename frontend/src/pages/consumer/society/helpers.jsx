import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { fmtNum } from '../../../lib/format.js';
import { DOW, ymd, titleCase } from './constants.js';

// Compact month calendar. Days with events show a teal dot; the selected day is
// highlighted. `events` is a map of YYYY-MM-DD → count. Purely presentational.
function MonthCalendar({ month, onMonth, events, selected, onSelect }) {
  const { t, i18n } = useTranslation();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = ymd(new Date());
  /* Month and weekday names come from Intl for the active language rather than
     the hardcoded English MONTHS/DOW arrays, so a Marathi reader picks dates
     against Marathi month names. Intl already ships these for hi and mr, so
     there is nothing to translate by hand and nothing to keep in sync. */
  const locale = i18n.language || 'en';
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long' }).format(month);
  // 7 Jan 2024 was a Sunday, matching getDay() === 0.
  const dowNames = DOW.map((_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2024, 0, 7 + i)));
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t('society.prevMonth')} className="w-8 h-8 rounded-lg border border-white/10 text-gray-300 hover:border-white/25 flex items-center justify-center"><Icon name="chevron-left" className="w-4 h-4" /></button>
        <span className="text-sm font-semibold text-white">{monthName} {month.getFullYear()}</span>
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t('society.nextMonth')} className="w-8 h-8 rounded-lg border border-white/10 text-gray-300 hover:border-white/25 flex items-center justify-center"><Icon name="chevron-right" className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {dowNames.map((d, i) => <div key={i} className="text-[10px] font-semibold text-slate-500 py-1">{d}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const key = ymd(new Date(month.getFullYear(), month.getMonth(), d));
          const has = events[key];
          const isSel = selected === key;
          const isToday = today === key;
          const label = has
            ? t('society.calDayEventsAria', { day: d, month: monthName, count: has })
            : t('society.calDayAria', { day: d, month: monthName });
          return (
            <button key={i} onClick={() => onSelect(key)} aria-label={label} aria-pressed={isSel}
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

/* Society blurb.
 *
 * Takes `t` rather than importing it: this is called from render, and passing the
 * translator keeps the function pure and testable.
 *
 * The English original built one sentence by gluing fragments — size, RERA,
 * builder, locality. That cannot survive translation, because Hindi and Marathi
 * put the builder and the locality in different positions relative to the noun.
 * So the sentence is now a whole template per case, with only the descriptor
 * ("3-tower, 160-home, RERA-registered") interpolated. */
function buildAbout(soc, locName, t) {
  if (soc._thin) return t('society.aboutThin', { name: soc.name, locality: locName });

  const verified = soc.registration && soc.conveyance;
  // Only assert specifics we actually hold — never invent size/utilities/occupancy.
  const descriptor = [
    soc.towers ? t('society.descTower', { count: soc.towers }) : null,
    soc.units ? t('society.descHome', { count: fmtNum(soc.units) }) : null,
    soc.rera ? t('society.descRera') : null,
  ].filter(Boolean).join(', ');
  const descArg = descriptor ? `${descriptor} ` : '';

  const sentences = [
    soc.builder
      ? t('society.aboutIntroBuilder', { name: soc.name, descriptor: descArg, builder: soc.builder, locality: locName })
      : t('society.aboutIntro', { name: soc.name, descriptor: descArg, locality: locName }),
  ];
  if (soc.year) {
    sentences.push(soc.occupancy
      ? t('society.aboutBuiltOccupancy', { year: soc.year, percent: soc.occupancy })
      : t('society.aboutBuilt', { year: soc.year }));
  }
  sentences.push(verified ? t('society.aboutVerified') : t('society.aboutBrokerFree'));
  return sentences.join(' ');
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
