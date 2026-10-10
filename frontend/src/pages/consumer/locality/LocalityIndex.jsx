import { useState } from 'react';
import { Link } from 'react-router';
import { guides, zones, hub } from 'virtual:locality-guides';
import Icon from '../../../components/Icon.jsx';
import usePageHead from '../../../lib/usePageHead.js';
import { OwnerCta } from '../blog/BlogParts.jsx';
import PuneMap, { ZONE_TONE } from './PuneMap.jsx';

const sections = Object.entries(zones)
  .map(([id, zone]) => ({ id, ...zone, guides: guides.filter((g) => g.zone === id) }))
  .filter((s) => s.guides.length);

function GuideCard({ guide, active, onActive }) {
  const tone = ZONE_TONE[guide.zone];
  return (
    <Link
      to={`/locality/${guide.slug}`}
      onMouseEnter={() => onActive(guide.slug)}
      onMouseLeave={() => onActive('')}
      onFocus={() => onActive(guide.slug)}
      onBlur={() => onActive('')}
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-ink-card p-5 shadow-[var(--tile-shadow)] transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-400 ${active ? 'border-teal-400/40' : 'border-white/10'}`}
    >
      <Icon name="map-pin" aria-hidden="true" className={`pointer-events-none absolute -bottom-6 -right-5 h-28 w-28 opacity-[0.07] ${tone.text}`} />
      <span aria-hidden="true" className={`h-1 w-8 rounded-full ${tone.bg}`} />
      <h3 className={`mt-3 text-lg font-bold leading-snug ${active ? 'text-teal-300' : 'text-white'}`}>{guide.name}</h3>
      <p className="mt-1 text-sm leading-relaxed text-gray-400">{guide.tagline}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-semibold text-teal-400">
        Read guide <Icon name="arrow-right" aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default function LocalityIndex() {
  usePageHead({ title: hub.title, description: hub.description, path: '/locality' });
  const [active, setActive] = useState('');

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="overflow-hidden rounded-3xl border border-teal-400/15 bg-gradient-to-br from-teal-400/[0.14] via-teal-400/[0.04] to-transparent p-4 sm:p-8 lg:grid lg:grid-cols-[2fr_3fr] lg:items-center lg:gap-8">
        <div className="px-1 sm:px-2">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
            <Icon name="map-pin" aria-hidden="true" className="h-3.5 w-3.5" /> Pune locality guides
          </p>
          <h1 className="mt-4 text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{hub.heading}</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-gray-400 sm:text-lg">{hub.intro}</p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
            <Link to="/rent/pune" className="text-teal-300 hover:underline">Homes for rent in Pune</Link>
            <Link to="/buy/pune" className="text-teal-300 hover:underline">Homes for sale in Pune</Link>
          </p>
        </div>
        <figure className="mt-6 rounded-2xl border border-white/10 bg-ink-card p-2 sm:p-4 lg:mt-0">
          <PuneMap guides={guides} active={active} onActive={setActive} />
          <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-gray-500">
            {sections.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${ZONE_TONE[s.id].bg}`} /> {s.label}
              </span>
            ))}
            <span className="ml-auto">Positions are approximate</span>
          </figcaption>
        </figure>
      </header>

      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`zone-${s.id}`} className="mt-10">
          <div className="flex items-baseline gap-3">
            <h2 id={`zone-${s.id}`} className="text-xl font-extrabold text-white sm:text-2xl">{s.label}</h2>
            <span className="text-sm font-medium text-gray-500">{s.guides.length} guides</span>
          </div>
          <p className="mt-1 text-sm text-gray-400">{s.blurb}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {s.guides.map((g) => <GuideCard key={g.slug} guide={g} active={active === g.slug} onActive={setActive} />)}
          </div>
        </section>
      ))}

      <div className="mt-12"><OwnerCta /></div>
    </div>
  );
}
