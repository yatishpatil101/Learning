import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import Icon from '../../../components/Icon.jsx';
import { LOC } from '../../../data/localityIntel.js';
import { NAMES, SUBKEYS, SUB_ICON } from './helpers.js';

export default function LivabilityCard({ current, vsLoc, setVsLoc, sc, scoreLabel, livRank, L }) {
  return (
    <div className="glass-card rounded-2xl p-5 sm:p-6 reveal">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Livability</h2>
        <div className="w-1/2 max-w-[220px]">
          <NativeSelect value={vsLoc} onChange={(e) => setVsLoc(e.target.value)} className="field text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-gray-300"><option value="">Compare with…</option>{NAMES.filter((n) => n !== current).map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect>
        </div>
      </div>
      <div className="flex items-end gap-4 mb-5">
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="text-5xl font-bold text-white tabular-nums leading-none">{sc}</span>
          <span className="text-base text-gray-500 font-semibold">/10</span>
        </div>
        <div className="pb-0.5">
          <p className="text-teal-400 font-bold leading-tight">{scoreLabel}</p>
          <p className="text-gray-500 text-xs mt-0.5">Ranked #{livRank} of {NAMES.length} tracked Pune areas</p>
        </div>
      </div>
      <div className="space-y-2.5">
        {SUBKEYS.map((k) => {
          const v = L.subs[k];
          const cmpV = vsLoc && LOC[vsLoc] ? LOC[vsLoc].subs[k] : null;
          return (
            <div key={k} className="flex items-center gap-3">
              <span className="w-7 h-7 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0"><Icon name={SUB_ICON[k] || 'star'} className="w-4 h-4 text-teal-300" /></span>
              <span className="text-xs font-medium text-gray-300 w-[68px] shrink-0">{k}</span>
              <div className="flex-1 relative h-2.5 rounded-full bg-white/[0.08]">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v * 10}%`, background: 'linear-gradient(90deg,#0d9488,#2dd4bf)' }} />
                {cmpV != null ? <span className="absolute top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-indigo-400" style={{ left: `calc(${cmpV * 10}% - 1.5px)` }} title={`${vsLoc}: ${cmpV}`} /> : null}
              </div>
              <span className="text-sm font-bold text-white tabular-nums w-7 text-right shrink-0">{v}</span>
              {cmpV != null ? <span className="text-xs font-semibold text-indigo-400 tabular-nums w-7 text-right shrink-0">{cmpV}</span> : null}
            </div>
          );
        })}
      </div>
      {vsLoc && LOC[vsLoc] ? (
        <div className="flex items-center gap-4 mt-4 text-xs">
          <span className="flex items-center gap-1.5 text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400" /> {current}</span>
          <span className="flex items-center gap-1.5 text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-400" /> {vsLoc}</span>
        </div>
      ) : null}
    </div>
  );
}
