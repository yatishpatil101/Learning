import { useState } from 'react';
import Icon from '../../../components/Icon.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { fmtNum } from '../../../lib/format.js';
import { updateManagedProp } from '../../../lib/data/managedProperty.js';
import { currentDueStatus, recentMonths, markRentReceived, downloadReceipt } from '../../../lib/data/rentReminders.js';
import { FIELD_CLS } from './constants.js';

const rentStr = (n) => '₹' + fmtNum(n) + '/mo';

/* Rent reminders & receipts — the retention hook. Offline-first: the owner records
   rent they collected (any way) and gets an instant HRA receipt. No payment rails. */
export default function RentPanel({ prop, onChange }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(!prop.rented);
  const [form, setForm] = useState({
    tenantName: prop.tenantName || '',
    monthlyRent: prop.monthlyRent || (prop.deal === 'rent' ? prop.price : '') || '',
    dueDay: prop.dueDay || 5,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const saveDetails = (rented) => {
    updateManagedProp(prop.id, {
      rented,
      tenantName: form.tenantName.trim(),
      monthlyRent: Number(form.monthlyRent) || 0,
      dueDay: Math.min(28, Math.max(1, Number(form.dueDay) || 5)),
    });
    setEditing(false);
    onChange?.();
    toast(rented ? 'Rent tracking is on' : 'Marked as vacant', 'success');
  };

  const markPaid = (ym) => {
    const r = markRentReceived(prop, ym);
    if (!r.ok) { toast('Set a monthly rent first', 'error'); return; }
    onChange?.();
    toast('Rent recorded', 'success');
  };

  // ---- Vacant / setup state ----
  if (!prop.rented || editing) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-1"><Icon name="receipt-indian-rupee" className="w-5 h-5 text-brand-teal-2" /><h2 className="text-lg font-bold text-white">Rent tracking</h2></div>
        <p className="text-gray-400 text-sm mb-5">Renting this out? Add the details and we'll remind you each month and generate rent receipts.</p>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-gray-400 mb-1.5 block">Tenant name</span>
            <input value={form.tenantName} onChange={set('tenantName')} placeholder="e.g. Rohit More" className={FIELD_CLS} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-gray-400 mb-1.5 block">Monthly rent (₹)</span>
              <input type="number" inputMode="numeric" value={form.monthlyRent} onChange={set('monthlyRent')} placeholder="e.g. 28000" className={FIELD_CLS} />
            </label>
            <label className="block">
              <span className="text-xs text-gray-400 mb-1.5 block">Due day of month</span>
              <input type="number" min="1" max="28" value={form.dueDay} onChange={set('dueDay')} className={FIELD_CLS} />
            </label>
          </div>
          <div className="flex gap-2.5">
            <button onClick={() => saveDetails(true)} className="btn-teal flex-1 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="bell" className="w-4 h-4" /> Start tracking</button>
            {prop.rented && <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 text-sm hover:bg-white/5">Cancel</button>}
          </div>
          {!prop.rented && <button onClick={() => saveDetails(false)} className="w-full text-center text-gray-500 text-xs hover:text-gray-300">It's vacant right now</button>}
        </div>
      </div>
    );
  }

  // ---- Active tracking state ----
  const s = currentDueStatus(prop);
  const months = recentMonths(prop, 6);
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2"><Icon name="receipt-indian-rupee" className="w-5 h-5 text-brand-teal-2" /><h2 className="text-lg font-bold text-white">Rent tracking</h2></div>
        <button onClick={() => setEditing(true)} className="text-gray-400 text-xs hover:text-white flex items-center gap-1"><Icon name="pencil" className="w-3.5 h-3.5" /> Edit</button>
      </div>

      <div className={'rounded-xl p-4 border mb-4 ' + (s.paid ? 'bg-emerald-500/10 border-emerald-500/25' : s.overdue ? 'bg-rose-500/10 border-rose-500/25' : 'bg-amber-500/10 border-amber-500/25')}>
        <p className="text-xs text-gray-300">{s.label} · {prop.tenantName || 'Tenant'}</p>
        <p className="text-2xl font-extrabold text-white leading-tight mt-0.5">{rentStr(prop.monthlyRent)}</p>
        <p className={'text-xs font-medium mt-1 flex items-center gap-1 ' + (s.paid ? 'text-emerald-300' : s.overdue ? 'text-rose-300' : 'text-amber-300')}>
          <Icon name={s.paid ? 'check-circle' : s.overdue ? 'alert-circle' : 'clock'} className="w-3.5 h-3.5" />
          {s.paid ? 'Received this month' : s.overdue ? `Overdue — was due on the ${s.dueDay}th` : `Due by the ${s.dueDay}th`}
        </p>
        {!s.paid && (
          <button onClick={() => markPaid(s.ym)} className="btn-teal w-full mt-3 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"><Icon name="check" className="w-4 h-4" /> Mark received</button>
        )}
      </div>

      <p className="text-xs text-gray-400 mb-2">Recent months</p>
      <ul className="space-y-1.5">
        {months.map((m) => (
          <li key={m.ym} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg hover:bg-white/[0.03]">
            <span className="text-gray-300">{m.label}</span>
            {m.paid ? (
              <span className="flex items-center gap-3">
                <span className="text-emerald-300 text-xs flex items-center gap-1"><Icon name="check-circle" className="w-3.5 h-3.5" /> {rentStr(m.amount)}</span>
                <button onClick={() => downloadReceipt(prop, m.ym)} className="text-brand-teal-3 text-xs hover:underline flex items-center gap-1"><Icon name="download" className="w-3.5 h-3.5" /> Receipt</button>
              </span>
            ) : (
              <button onClick={() => markPaid(m.ym)} className="text-gray-400 text-xs hover:text-white border border-white/10 rounded-lg px-2 py-1">Mark received</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
