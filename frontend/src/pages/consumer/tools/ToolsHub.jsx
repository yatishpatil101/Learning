import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { CtaCard } from './ToolShell.jsx';
import { FREE_TOOLS, TOOLS_HUB } from '../../../data/freeTools.js';
import '../../../styles/routes/tools.css';

export default function ToolsHub() {
  return (
    <article className="tool-page mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-[1.85rem] font-extrabold leading-[1.15] text-white sm:text-5xl">{TOOLS_HUB.top} <span className="gradient-text">{TOOLS_HUB.accent}</span></h1>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-300 sm:text-lg">{TOOLS_HUB.subtitle}</p>
      </header>
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:mt-8 sm:grid-cols-2">
        {FREE_TOOLS.map((t) => (
          <li key={t.path}>
            <Link to={t.path} className="glass-card flex h-full flex-col rounded-2xl p-5 transition-all hover:border-teal-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40">
              <h2 className="text-lg font-bold text-white">{t.name}</h2>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-400">{t.summary}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-400">Open <Icon name="arrow-right" aria-hidden="true" className="h-3.5 w-3.5" /></span>
            </Link>
          </li>
        ))}
      </ul>
      <CtaCard cta={TOOLS_HUB.cta} />
    </article>
  );
}
