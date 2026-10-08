import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import AmountInput from './AmountInput.jsx';
import MoveInField from './MoveInField.jsx';
import { MAX_GROUP_LOCALITIES, GROUP_BHKS } from './constants.js';
import { inr } from './helpers.js';

function perHeadRange(grp) {
  const seats = +grp.seats;
  if (!seats || !+grp.rentMax) return '—';
  const each = (v) => inr(Math.round(+v / seats));
  return +grp.rentMin ? `${each(grp.rentMin)} – ${each(grp.rentMax)}` : `${each(grp.rentMax)}`;
}

const labelCx = 'block text-xs font-medium text-gray-400 mb-1.5';

export default function GroupPreferencesFields({ grp, setGrp, grpErr, onLocalityBusy }) {
  const { t: tr } = useTranslation();
  const set = (patch, cleared) => { setGrp((g) => ({ ...g, ...patch })); if (cleared) grpErr.clear(cleared); };
  const toggleBhk = (b) => set({ bhk: grp.bhk.includes(b) ? grp.bhk.filter((x) => x !== b) : [...grp.bhk, b].sort() });
  const money = (name, label, placeholder, required = false) => (
    <div data-err={name}>
      <AmountInput value={grp[name]} onChange={(v) => set({ [name]: v }, name)} className={grpErr.cx(name)} placeholder={placeholder} aria-label={label} aria-required={required || undefined} />
      <FieldError show={grpErr.has(name)}>{grpErr.msg(name)}</FieldError>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="group-preferences">
      <div>
        <label className={labelCx}>{tr('flatmates.groupLocalities')} <span className="text-rose-400">*</span> <span className="text-gray-600">{tr('flatmates.upToN', { count: MAX_GROUP_LOCALITIES })}</span></label>
        <LocalitySelect
          multi
          autoClose
          values={grp.localities}
          onChange={(arr) => { if (arr.length <= MAX_GROUP_LOCALITIES) set({ localities: arr }, 'localities'); }}
          placeholder={tr('flatmates.addLocalities')}
          invalid={grpErr.has('localities')}
          dataErr="localities"
          ariaLabel={tr('flatmates.groupLocalities')}
          onBusyChange={onLocalityBusy}
        />
        <FieldError show={grpErr.has('localities')}>{grpErr.msg('localities')}</FieldError>
      </div>
      <div>
        <span className={labelCx}>{tr('flatmates.groupBhk')} <span className="text-gray-600">{tr('flatmates.optional')}</span></span>
        <div className="flex flex-wrap gap-2" role="group" aria-label={tr('flatmates.groupBhk')}>
          {GROUP_BHKS.map((b) => (
            <button key={b} type="button" onClick={() => toggleBhk(b)} aria-pressed={grp.bhk.includes(b)} className={'pick px-3 py-1.5 rounded-lg text-xs font-semibold' + (grp.bhk.includes(b) ? ' active' : '')}>{tr(b === '4' ? 'flatmates.bhk4Plus' : 'flatmates.bhkN', { n: b })}</button>
          ))}
        </div>
      </div>
      <div>
        <span className={labelCx}>{tr('flatmates.groupRentRange')} <span className="text-rose-400">*</span></span>
        <div className="grid grid-cols-2 gap-3">
          {money('rentMin', tr('flatmates.rentMinLabel'), tr('flatmates.rangeFrom'))}
          {money('rentMax', tr('flatmates.rentMaxLabel'), tr('flatmates.rangeUpTo'), true)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 -mt-1">
        <Icon name="calculator" className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-xs text-gray-400">{tr('flatmates.eachFlatmatePays')}</span>
        <span className="text-sm font-bold gradient-text" data-testid="group-per-head-range">{perHeadRange(grp)}{+grp.rentMax && +grp.seats ? tr('flatmates.perMonth') : ''}</span>
      </div>
      <div>
        <span className={labelCx}>{tr('flatmates.groupDepositRange')} <span className="text-gray-600">{tr('flatmates.optional')}</span></span>
        <div className="grid grid-cols-2 gap-3">
          {money('depositMin', tr('flatmates.depositMinLabel'), tr('flatmates.rangeFrom'))}
          {money('depositMax', tr('flatmates.depositMaxLabel'), tr('flatmates.rangeUpTo'))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className={labelCx}>{tr('flatmates.groupFurnishing')}</label><NativeSelect title={tr('flatmates.groupFurnishing')} value={grp.furnishing} onChange={(e) => set({ furnishing: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="">{tr('flatmates.optNoPreference')}</option><option value="furnished">{tr('flatmates.furnFurnished')}</option><option value="semi">{tr('flatmates.furnSemi')}</option><option value="unfurnished">{tr('flatmates.furnUnfurnished')}</option></NativeSelect></div>
      </div>
      <div><span className={labelCx}>{tr('flatmates.groupMoveInBy')}</span><MoveInField value={grp.moveInBy} onChange={(v) => set({ moveInBy: v })} label={tr('flatmates.groupMoveInBy')} /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
          <input type="checkbox" checked={grp.gatedOnly} onChange={(e) => set({ gatedOnly: e.target.checked })} className="w-4 h-4 accent-teal-500" />
          <span>{tr('flatmates.gatedOnly')}</span>
        </label>
        <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
          <input type="checkbox" checked={grp.bachelors} onChange={(e) => set({ bachelors: e.target.checked })} className="w-4 h-4 accent-teal-500" />
          <span>{tr('flatmates.needsBachelors')}</span>
        </label>
      </div>
    </div>
  );
}
