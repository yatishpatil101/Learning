import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import { TRUST_PAGES } from '../../data/trustPages.js';

const BADGE = { '/about': ['house', 'About us'], '/how-verification-works': ['badge-check', 'Trust & safety'] };

/* `path` comes from the route, not the URL: routes match case-insensitively, the page keys don't. */
export default function TrustPage({ path }) {
  const page = TRUST_PAGES[path];
  const [icon, label] = BADGE[path];

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="rounded-3xl border border-teal-400/15 bg-gradient-to-br from-teal-400/[0.14] via-teal-400/[0.04] to-transparent px-5 py-8 sm:px-10 sm:py-12">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-teal-300">
          <Icon name={icon} aria-hidden="true" className="h-3.5 w-3.5" /> {label}
        </p>
        <h1 className="mt-4 text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{page.top} <span className="gradient-text">{page.accent}</span></h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-300 sm:text-lg">{page.intro}</p>
      </header>

      {page.sections.map((s) => (
        <section key={s.title} className="mt-8 sm:mt-10">
          <h2 className="text-xl font-bold text-white sm:text-2xl">{s.title}</h2>
          {s.body?.map((p) => <p key={p} className="mt-3 text-[15px] leading-relaxed text-gray-300">{p}</p>)}
          {s.list && (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-gray-300">
              {s.list.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {s.links && (
            <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
              {s.links.map(([text, to]) => (
                <Link key={to} to={to} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-teal-400 hover:text-teal-300">
                  {text} <Icon name="arrow-right" aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              ))}
            </p>
          )}
        </section>
      ))}

      {page.faq && (
        <section className="mt-8 sm:mt-10">
          <h2 className="text-xl font-bold text-white sm:text-2xl">Frequently asked questions</h2>
          <dl className="mt-4 space-y-5">
            {page.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-white">{f.q}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-gray-400">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </article>
  );
}
