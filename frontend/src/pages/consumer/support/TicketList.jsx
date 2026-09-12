import Icon from '../../../components/Icon.jsx';
import { useTranslation } from 'react-i18next';
import { getCatLabel, getCatIcon, getStatusLabel, fmtTime } from '../../../lib/data/support.js';
import { STATUS_CHIP } from './constants.js';

export default function TicketList({ tickets, openThread }) {
  const { t: tr } = useTranslation();
  return (
    <div className="reveal">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Icon name="inbox" className="w-5 h-5 text-teal-400" /> {tr('misc.tlYourTickets')}
        </h2>
        {tickets.length > 0 && <span className="text-xs text-gray-500">{tr('misc.tlTotal', { count: tickets.length })}</span>}
      </div>
      {tickets.length === 0 ? (
        <div className="glass-card rounded-2xl p-8 text-center">
          <Icon name="ticket" className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-400 text-sm font-medium">{tr('misc.tlNoTickets')}</p>
          <p className="text-gray-600 text-xs mt-1">{tr('misc.tlNoTicketsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const unread = t.unreadCustomer > 0;
            const last = t.messages[t.messages.length - 1] || {};
            const prevText = last.system
              ? last.text
              : last.by === 'staff'
              ? tr('misc.tlSupportPrefix') + (last.text || (last.images?.length ? tr('misc.tlImage') : ''))
              : tr('misc.tlYouPrefix') + (last.text || (last.images?.length ? tr('misc.tlImage') : ''));
            return (
              <button
                key={t.id}
                onClick={() => openThread(t.id)}
                className="w-full text-left glass-card rounded-2xl p-4 hover:border-teal-400/40 hover:bg-white/7 transition-all"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-[11px] text-gray-500 font-mono">{t.id}</span>
                  <div className="flex items-center gap-1.5">
                    {unread && <span className="w-2 h-2 rounded-full bg-teal-400 flex-shrink-0" />}
                    <span className={'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ' + (STATUS_CHIP[t.status] || STATUS_CHIP.open)}>
                      {getStatusLabel(t.status)}
                    </span>
                  </div>
                </div>
                <p className="text-white text-sm font-semibold truncate">{t.subject}</p>
                <p className="text-gray-500 text-xs mt-1 truncate">{prevText}</p>
                <div className="flex items-center justify-between gap-2 mt-2.5">
                  <span className="inline-flex items-center gap-1 text-[11px] rounded-full bg-white/6 text-gray-300 px-2 py-0.5">
                    <Icon name={getCatIcon(t.category)} className="w-3 h-3" />
                    {getCatLabel(t.category)}
                  </span>
                  <span className="text-[11px] text-gray-500">{fmtTime(t.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
