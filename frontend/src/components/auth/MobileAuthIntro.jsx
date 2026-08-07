import LogoMark from '../brand/LogoMark.jsx';

/* Compact brand + trust strip shown only on mobile (AuthShell renders it `<lg`).
   Mobile hides the desktop left panel, so this restores PuneNest branding and the
   trust differentiators that drive real-estate conversion. Styled as an "edge-lit
   proptech" header: glowing brand badge + a live status pill + trust chips. Chips
   use bg tints (not nested bordered boxes) per the app's design-consistency rules. */
export default function MobileAuthIntro({ eyebrow, tagline, chips = [] }) {
  return (
    <div className="mb-6 text-center slide-up">
      {eyebrow ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/[.08] px-3 py-1 mb-4">
          <span className="auth-live-dot inline-block w-1.5 h-1.5 rounded-full bg-teal-300" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-teal-200">{eyebrow}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-center gap-2.5 mb-3">
        <LogoMark className="auth-brand-badge w-9 h-9 shrink-0 text-teal-400" />
        <span className="text-2xl font-bold tracking-tight text-white">PuneNest</span>
      </div>
      {tagline ? <p className="text-gray-400 text-[13px] leading-relaxed mb-4 px-3">{tagline}</p> : null}
      {chips.length ? (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {chips.map(([Ic, label]) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.06] bg-white/[.04] px-2.5 py-1 text-[11px] font-medium text-gray-300">
              <Ic className="w-3.5 h-3.5 text-teal-300" /> {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
