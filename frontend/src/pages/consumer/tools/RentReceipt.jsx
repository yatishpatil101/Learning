import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import ToolShell, { NumField, Panel, TextField, rupees, toNum } from './ToolShell.jsx';
import { MAX_RECEIPT_MONTHS, isPan, monthsBetween } from '../../../lib/toolCalc.js';

const MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HRA_PAN_LIMIT = 100000;
const STAMP_LIMIT = 5000;

const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

function monthOptions() {
  const now = new Date();
  const start = now.getFullYear() * 12 + now.getMonth() - 36;
  return Array.from({ length: 49 }, (_, i) => {
    const idx = start + i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });
}

function receiptDate(ym, day) {
  const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  return `${String(Math.min(day, last)).padStart(2, '0')} ${monthLabel(ym)}`;
}

function Receipts({ list, f, stampBox }) {
  return list.map((ym, i) => (
    <section key={ym} className="tool-receipt" data-testid="rent-receipt">
      <header className="tool-receipt__head">
        <h3>Rent receipt</h3>
        <p>No. {i + 1} &middot; Date: {receiptDate(ym, f.day)}</p>
      </header>
      <p>
        Received with thanks from <strong>{f.tenant}</strong> a sum of <strong>{rupees(toNum(f.rent))}</strong> towards rent for the month of <strong>{monthLabel(ym)}</strong>,
        for the property at {f.address}. Paid by {MODES[f.mode].toLowerCase()}.
      </p>
      <div className="tool-receipt__foot">
        <div>
          <p>Landlord: <strong>{f.landlord}</strong></p>
          {f.pan && <p>PAN: {f.pan}</p>}
        </div>
        {stampBox && <div className="tool-receipt__stamp">Affix ₹1 revenue stamp and sign across it</div>}
        <div className="tool-receipt__sign">Landlord&rsquo;s signature</div>
      </div>
    </section>
  ));
}

export default function RentReceipt() {
  const options = useMemo(monthOptions, []);
  const thisMonth = options[36];
  const [f, setF] = useState({ tenant: '', landlord: '', address: '', rent: '', from: thisMonth, to: thisMonth, mode: 'bank', pan: '', day: '1' });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  const months = monthsBetween(f.from, f.to);
  const rent = toNum(f.rent);
  const day = Math.min(Math.max(toNum(f.day), 1), 31);
  const ready = months.length > 0 && rent > 0 && f.tenant.trim() && f.landlord.trim() && f.address.trim();
  const needsPan = rent * 12 > HRA_PAN_LIMIT && !f.pan;
  const panError = f.pan && !isPan(f.pan) ? 'A PAN has 5 letters, 4 digits and 1 letter, like ABCDE1234F.' : '';
  const periodError = months.length === 0 ? `Choose a period of 1 to ${MAX_RECEIPT_MONTHS} months, ending on or after the start month.` : '';
  const data = { ...f, tenant: f.tenant.trim(), landlord: f.landlord.trim(), address: f.address.trim(), day };
  const stampBox = f.mode === 'cash' && rent > STAMP_LIMIT;

  return (
    <ToolShell path="/tools/rent-receipt-generator">
      <Panel>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <TextField id="rr-tenant" label="Tenant name" value={f.tenant} onChange={set('tenant')} />
          <TextField id="rr-landlord" label="Landlord name" value={f.landlord} onChange={set('landlord')} />
          <div className="sm:col-span-2"><TextField id="rr-address" label="Property address" value={f.address} onChange={set('address')} maxLength={160} /></div>
          <NumField id="rr-rent" label="Monthly rent" value={f.rent} onChange={set('rent')} />
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-300">Payment mode</span>
            <NativeSelect value={f.mode} onChange={(e) => set('mode')(e.target.value)} title="Payment mode">
              {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-300">From</span>
            <NativeSelect value={f.from} onChange={(e) => set('from')(e.target.value)} title="From month">
              {options.map((o) => <option key={o} value={o}>{monthLabel(o)}</option>)}
            </NativeSelect>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-gray-300">To</span>
            <NativeSelect value={f.to} onChange={(e) => set('to')(e.target.value)} title="To month">
              {options.map((o) => <option key={o} value={o}>{monthLabel(o)}</option>)}
            </NativeSelect>
          </label>
          <TextField id="rr-pan" label="Landlord PAN (optional)" value={f.pan} onChange={set('pan')} maxLength={10} upper placeholder="ABCDE1234F" error={panError}
            hint={needsPan ? 'Your employer needs it when yearly rent is above ₹1,00,000.' : undefined} />
          <NumField id="rr-day" label="Day of month paid" value={f.day} onChange={set('day')} prefix="" maxLength={2} />
        </div>
        {periodError && <p role="alert" className="mt-4 text-xs text-amber-400">{periodError}</p>}
      </Panel>

      <section className="mt-8" aria-labelledby="rr-preview">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="rr-preview" className="text-xl font-bold text-white sm:text-2xl">Your receipts{ready ? ` (${months.length})` : ''}</h2>
          <button type="button" disabled={!ready || !!panError} onClick={() => window.print()} className="btn-teal inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-50">
            <Icon name="download" aria-hidden="true" className="h-4 w-4" /> Print or save as PDF
          </button>
        </div>
        {ready ? (
          <div className="mt-4 space-y-4" data-testid="receipt-preview"><Receipts list={months} f={data} stampBox={stampBox} /></div>
        ) : (
          <p className="mt-3 text-sm text-gray-400">Fill in both names, the address, the rent and the period to see your receipts.</p>
        )}
      </section>
      {ready && createPortal(<div className="tool-print-root" data-testid="receipt-print"><Receipts list={months} f={data} stampBox={stampBox} /></div>, document.body)}
    </ToolShell>
  );
}
