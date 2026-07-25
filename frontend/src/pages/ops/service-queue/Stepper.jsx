import { stepStates } from '../../../lib/serviceFlow.js';
import { classNames } from '../../../lib/format.js';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';

export default function Stepper({ status, steps }) {
  const states = stepStates(status);
  return (
    <HScroll className="flex items-center gap-1 pb-1">
      {steps.map((lab, i) => {
        const st = states[i];
        const dot = st === 'done' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          : st === 'active' ? 'bg-teal-500/20 text-teal-300 border-teal-500/30'
          : 'bg-white/5 text-gray-500 border-white/10';
        return (
          <div key={lab} className="flex items-center gap-1 flex-shrink-0">
            <div className={classNames('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium', dot)}>
              <Icon name={st === 'done' ? 'check' : st === 'active' ? 'loader' : 'circle'} className="w-3 h-3" /> {lab}
            </div>
            {i < steps.length - 1 ? <div className={classNames('w-4 h-px', st === 'done' ? 'bg-emerald-500/40' : 'bg-white/10')} /> : null}
          </div>
        );
      })}
    </HScroll>
  );
}
