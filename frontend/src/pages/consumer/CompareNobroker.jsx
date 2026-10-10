import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { AS_OF, CHECKED_ON, CORRECTIONS_EMAIL, COMPARE_NOBROKER as c, SOURCES } from '../../data/compareNobroker.js';

const linkCls = 'inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-400 hover:text-teal-300 sm:min-h-0';
const cellCls = 'block px-4 py-3 text-[15px] leading-relaxed text-gray-300 before:mb-1 before:block before:text-[11px] before:font-semibold before:uppercase before:tracking-widest before:text-teal-300 before:content-[attr(data-label)] sm:table-cell sm:align-top sm:before:hidden';

function Outbound({ id }) {
  const s = SOURCES[id];
  return (
    <a href={s.url} target="_blank" rel="noopener noreferrer" className={linkCls}>
      {s.label} <Icon name="external-link" aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}

function FitList({ fit }) {
  return (
    <section className="mt-8 sm:mt-10">
      <h2 className="text-xl font-bold text-white sm:text-2xl">{fit.title}</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-gray-300">
        {fit.list.map((item) => <li key={item}>{item}</li>)}
      </ul>
      {fit.links && (
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
          {fit.links.map(([text, to]) => (
            <Link key={to} to={to} className={linkCls}>
              {text} <Icon name="arrow-right" aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          ))}
        </p>
      )}
    </section>
  );
}

export default function CompareNobroker() {
  return (
    <article className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="rounded-3xl border border-teal-400/15 bg-gradient-to-br from-teal-400/[0.14] via-teal-400/[0.04] to-transparent px-5 py-8 sm:px-10 sm:py-12">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
          <Icon name="scale" aria-hidden="true" className="h-3.5 w-3.5" /> Comparison
        </p>
        <h1 className="mt-4 text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{c.top} <span className="gradient-text">{c.accent}</span></h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-300 sm:text-lg">{c.subtitle}</p>
        <p className="mt-3 text-sm text-gray-400" data-testid="compare-as-of">
          Facts as of {AS_OF}, from NoBroker&rsquo;s published pages. To correct anything, write to{' '}
          <a href={`mailto:${CORRECTIONS_EMAIL}`} className="font-semibold text-teal-400 hover:text-teal-300">{CORRECTIONS_EMAIL}</a>.
        </p>
      </header>

      <div className="mt-6 space-y-3 sm:mt-8">
        {c.summary.map((p) => <p key={p} className="text-[15px] leading-relaxed text-gray-300 sm:text-base">{p}</p>)}
      </div>

      <section className="mt-8 sm:mt-10">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Plans and fees side by side</h2>
        <table className="mt-4 block w-full text-left sm:table">
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-white/10 text-sm text-white">
              <th scope="col" className="w-36 px-4 py-3"><span className="sr-only">Topic</span></th>
              <th scope="col" className="px-4 py-3 font-bold">NoBroker</th>
              <th scope="col" className="px-4 py-3 font-bold">Draazy</th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {c.rows.map((r) => (
              <tr key={r.label} data-testid="compare-row" className="mb-4 block rounded-2xl border border-white/10 bg-white/[0.03] sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:bg-transparent">
                <th scope="row" className="block px-4 pb-1 pt-3 text-left text-base font-bold text-white sm:table-cell sm:w-36 sm:align-top sm:py-3 sm:text-[15px]">{r.label}</th>
                <td data-label="NoBroker" data-testid="compare-nobroker-cell" className={cellCls}>
                  <p>{r.nobroker.text}</p>
                  <p className="mt-1 flex flex-col text-sm text-gray-400 sm:block">
                    <span>Source:</span>
                    {r.nobroker.src.map((id) => <Outbound key={id} id={id} />)}
                  </p>
                </td>
                <td data-label="Draazy" className={cellCls}>
                  <p>{r.draazy.text}</p>
                  {r.draazy.link && (
                    <Link to={r.draazy.link[1]} className={linkCls}>
                      {r.draazy.link[0]} <Icon name="arrow-right" aria-hidden="true" className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <FitList fit={c.nobrokerFit} />
      <FitList fit={c.draazyFit} />

      <section className="mt-8 sm:mt-10">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Frequently asked questions</h2>
        <dl className="mt-4 space-y-5">
          {c.faq.map((f) => (
            <div key={f.q}>
              <dt className="font-semibold text-white">{f.q}</dt>
              <dd className="mt-1 text-[15px] leading-relaxed text-gray-400">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8 sm:mt-10">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Sources</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-gray-300">
          {Object.entries(SOURCES).map(([id]) => (
            <li key={id}><Outbound id={id} /> <span className="text-sm text-gray-500">checked {CHECKED_ON}</span></li>
          ))}
        </ul>
      </section>

      <p className="mt-8 text-xs text-gray-500">{c.disclaimer}</p>
    </article>
  );
}
