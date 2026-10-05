import { useCallback, useState } from 'react';
import Icon from '../../../../components/Icon.jsx';
import { Gallery as PropertyGallery } from '../../property/Gallery.jsx';
import PhotoLightbox from '../../property/PhotoLightbox.jsx';

const filled = (v) => v != null && v !== '' && v !== false;

export function Identity({ avatar, title, meta, badges }) {
  return (
    <div className="reveal">
      <div className="flex items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug break-words">{title}</h1>
          {meta && <p className="text-sm text-gray-400 mt-1 break-words">{meta}</p>}
        </div>
      </div>
      {badges && <div className="flex flex-wrap items-center gap-1.5 mt-3">{badges}</div>}
    </div>
  );
}

export function Sheet({ children }) {
  return <div className="fm-sheet sf-card rounded-2xl reveal">{children}</div>;
}

export function Section({ icon, title, aside, children }) {
  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-white inline-flex items-center gap-2">{icon && <Icon name={icon} className="w-4 h-4 text-teal-300" />}{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function InfoRows({ items }) {
  const rows = items.filter(([, v]) => filled(v));
  if (!rows.length) return null;
  return (
    <dl className="-my-2">
      {rows.map(([k, v]) => (
        <div key={k} className="fm-row flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-sm text-gray-400 shrink-0">{k}</dt>
          <dd className="text-sm text-gray-100 text-right min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tags({ items }) {
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return <div className="flex flex-wrap gap-1.5">{list.map((x) => <span key={x} className="chip px-2.5 py-1 rounded-lg text-xs text-gray-200">{x}</span>)}</div>;
}

export function Gallery({ id, photos, alt }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const close = useCallback(() => setLightbox(false), []);
  return (
    <div className="reveal">
      <PropertyGallery gallery={photos} active={active} setActive={setActive} title={alt} p={{ id }} setLightbox={setLightbox} />
      {lightbox && <PhotoLightbox photos={photos} active={active} setActive={setActive} title={alt} onClose={close} />}
    </div>
  );
}

export function Stepper({ icon, label, value, onStep, canDec, canInc, decClass = '', incClass = '', decLabel, incLabel }) {
  const btn = "relative w-8 h-8 rounded-lg bg-white/5 border border-white/10 text-gray-200 inline-flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed before:absolute before:-inset-1.5 before:content-[''] ";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 pl-3 pr-1 py-1">
      <span className="text-[13px] text-gray-200 inline-flex items-center gap-2 min-w-0"><Icon name={icon} className="w-3.5 h-3.5 text-teal-300 shrink-0" /> {label}</span>
      <div className="inline-flex items-center gap-1 shrink-0">
        <button type="button" onClick={() => onStep(-1)} disabled={!canDec} className={btn + decClass} aria-label={decLabel}><Icon name="minus" className="w-3.5 h-3.5" /></button>
        <span className="text-sm font-bold text-white w-5 text-center tabular-nums" aria-live="polite">{value}</span>
        <button type="button" onClick={() => onStep(1)} disabled={!canInc} className={btn + incClass} aria-label={incLabel}><Icon name="plus" className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}

export function PriceCard({ label, value, sub, facts = [], cta, children }) {
  const strip = facts.filter(([, , v]) => filled(v));
  return (
    <div className="sf-card rounded-2xl p-4 sm:p-5 reveal">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-[1.75rem] font-bold gradient-text leading-tight">{value}</p>
      {sub}
      {strip.length > 0 && (
        <dl className="grid mt-4 pt-3 border-t border-white/10" style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }}>
          {strip.map(([icon, k, v], i) => (
            <div key={k} className={'min-w-0 ' + (i ? 'pl-3 border-l border-white/10' : '')}>
              <dt className="text-xs text-gray-500 inline-flex items-center gap-1"><Icon name={icon} className="w-3.5 h-3.5 text-teal-300/80 shrink-0" />{k}</dt>
              <dd className="text-sm font-semibold text-white mt-0.5 break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      {cta && <div className="hidden lg:flex mt-4">{cta}</div>}
    </div>
  );
}

export function StickyAsk({ price, label, children }) {
  return (
    <div className="dz-sticky-cta fm-sticky lg:hidden items-center">
      <div className="min-w-0 max-w-[42%]">
        <p className="text-lg font-bold gradient-text leading-none truncate">{price}</p>
        <p className="text-xs text-gray-400 mt-1 truncate">{label}</p>
      </div>
      <div className="flex-1 min-w-0 flex">{children}</div>
    </div>
  );
}

export function DetailLayout({ back, actions, hero, header, aside, sticky, children }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-3">{back}{actions}</div>
      {hero}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start">
        <div className="lg:col-start-1 lg:row-start-1 min-w-0">{header}</div>
        <aside className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-24 space-y-4">{aside}</aside>
        <div className="lg:col-start-1 lg:row-start-2 min-w-0 space-y-4">{children}</div>
      </div>
      {sticky}
    </>
  );
}
