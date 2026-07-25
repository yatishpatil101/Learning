import Icon from '../../Icon.jsx';
import Sparkline from '../../charts/Sparkline.jsx';
import { Card } from './helpers.jsx';

export default function Stat({ icon, bg, fg, value, label, trend, spark, className = 'p-5' }) {
  const tIcon = trend ? (trend.dir === 'up' ? 'trending-up' : trend.dir === 'down' ? 'trending-down' : 'minus') : null;
  const tCls = trend ? (trend.dir === 'up' ? 'text-emerald-400' : trend.dir === 'down' ? 'text-rose-400' : 'text-gray-500') : '';
  return (
    <Card className={'w-full ' + className}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={'w-10 h-10 rounded-xl flex items-center justify-center ' + bg}>
          <Icon name={icon} className={'w-5 h-5 ' + fg} />
        </div>
        {spark ? <Sparkline data={spark.data} color={spark.color} width={58} height={24} className="mt-1 opacity-80" /> : null}
      </div>
      <p className="text-2xl font-bold text-white leading-tight">{value}</p>
      <p className="text-gray-400 text-xs mt-0.5">{label}</p>
      {trend ? (
        <p className={'text-[11px] mt-1.5 flex items-center gap-1 ' + tCls}>
          <Icon name={tIcon} className="w-3 h-3" /> {trend.text}
        </p>
      ) : null}
    </Card>
  );
}
