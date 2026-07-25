import Icon from '../../../../components/Icon.jsx';

export default function DocCard({ icon, color, title, items }) {
  const tone = { teal: 'bg-teal-400/15 text-teal-400', indigo: 'bg-indigo-400/15 text-indigo-400', amber: 'bg-amber-400/15 text-amber-400' }[color];
  const check = { teal: 'text-teal-400', indigo: 'text-indigo-400', amber: 'text-amber-400' }[color];
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className={'w-10 h-10 rounded-xl flex items-center justify-center mb-4 ' + tone.split(' ')[0]}><Icon name={icon} className={'w-5 h-5 ' + tone.split(' ')[1]} /></div>
      <h3 className="text-white font-bold mb-3">{title}</h3>
      <ul className="space-y-2 text-sm text-gray-400">
        {items.map((d) => <li key={d} className="flex items-start gap-2"><Icon name="check" className={'w-4 h-4 mt-0.5 flex-shrink-0 ' + check} /> {d}</li>)}
      </ul>
    </div>
  );
}
