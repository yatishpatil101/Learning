import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { fmtNum } from '../../../lib/format.js';
import { SOURCES, TOOLS_AS_OF, toolByPath } from '../../../data/freeTools.js';
import '../../../styles/routes/tools.css';

export const rupees = (n) => '₹' + fmtNum(Math.round(n));
export const toNum = (s) => Number(s) || 0;

const fieldCls = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';
const labelCls = 'mb-1.5 block text-xs font-medium text-gray-300';
const linkCls = 'inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-400 hover:text-teal-300 sm:min-h-0';

export function NumField({ id, label, value, onChange, prefix = '₹', suffix, decimal = false, maxLength = 11 }) {
  const shown = decimal || value === '' ? value : Number(value).toLocaleString('en-IN');
  const clean = (raw) => (decimal ? raw.replace(/[^\d.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1') : raw.replace(/\D/g, '')).slice(0, maxLength);
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="relative">
        {prefix && <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-teal-400">{prefix}</span>}
        <input id={id} type="text" inputMode={decimal ? 'decimal' : 'numeric'} autoComplete="off" value={shown} onChange={(e) => onChange(clean(e.target.value))} className={`${fieldCls} ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-16' : ''}`} />
        {suffix && <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

export function TextField({ id, label, value, onChange, placeholder, maxLength = 80, upper = false, hint, error }) {
  return (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      <input id={id} type="text" autoComplete="off" value={value} maxLength={maxLength} placeholder={placeholder} aria-invalid={error ? 'true' : undefined} onChange={(e) => onChange(upper ? e.target.value.toUpperCase() : e.target.value)} className={fieldCls} />
      {error ? <p role="alert" className="mt-1.5 text-xs text-amber-400">{error}</p> : hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export function Panel({ children }) {
  return <div className="glass-card rounded-2xl p-5 sm:p-8">{children}</div>;
}

export function ResultCard({ label, value, rows, note }) {
  return (
    <div className="rounded-xl bg-teal-500/[0.07] p-5 text-center sm:p-6" aria-live="polite" data-testid="tool-result">
      <p className="mb-1 text-xs text-gray-400">{label}</p>
      <p className="gradient-text text-3xl font-extrabold">{value}</p>
      {rows && (
        <dl className="mt-4 space-y-2 border-t border-white/10 pt-4 text-left text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><dt className="text-gray-400">{k}</dt><dd className="font-semibold text-white">{v}</dd></div>
          ))}
        </dl>
      )}
      {note && <p className="mt-4 text-[11px] leading-relaxed text-gray-400">{note}</p>}
    </div>
  );
}

export function CtaCard({ cta }) {
  return (
    <aside className="mt-10 rounded-2xl border border-teal-400/15 bg-teal-400/[0.06] p-5 sm:p-6">
      <p className="text-[15px] leading-relaxed text-gray-200">{cta.text}</p>
      <Link to={cta.to} className={`${linkCls} mt-2`}>{cta.label} <Icon name="arrow-right" aria-hidden="true" className="h-3.5 w-3.5" /></Link>
    </aside>
  );
}

export default function ToolShell({ path, children }) {
  const tool = toolByPath(path);
  return (
    <article className="tool-page mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header>
        <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
          <Icon name="calculator" aria-hidden="true" className="h-3.5 w-3.5" /> Free tool
        </p>
        <h1 className="mt-4 text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{tool.top} <span className="gradient-text">{tool.accent}</span></h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-300 sm:text-lg">{tool.subtitle}</p>
      </header>

      <div className="mt-6 sm:mt-8">{children}</div>

      <section className="mt-10" aria-labelledby="tool-how">
        <h2 id="tool-how" className="text-xl font-bold text-white sm:text-2xl">How it&rsquo;s calculated</h2>
        <div className="mt-3 space-y-3">
          {tool.how.map((p) => <p key={p} className="text-[15px] leading-relaxed text-gray-300">{p}</p>)}
        </div>
        <p className="mt-4 text-sm text-gray-400" data-testid="tool-as-of">Rates and rules as of {TOOLS_AS_OF}.</p>
        {tool.sources.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {tool.sources.map((k) => (
              <li key={k}>
                <a href={SOURCES[k].url} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  {SOURCES[k].label} <Icon name="external-link" aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-gray-400">{tool.noSources}</p>}
      </section>

      <section className="mt-10" aria-labelledby="tool-faq">
        <h2 id="tool-faq" className="text-xl font-bold text-white sm:text-2xl">Frequently asked questions</h2>
        <dl className="mt-4 space-y-4">
          {tool.faq.map((f) => (
            <div key={f.q}><dt className="font-medium text-white">{f.q}</dt><dd className="mt-1 text-sm leading-relaxed text-gray-400">{f.a}</dd></div>
          ))}
        </dl>
      </section>

      <CtaCard cta={tool.cta} />
    </article>
  );
}
