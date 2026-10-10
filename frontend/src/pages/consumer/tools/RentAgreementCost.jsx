import { useState } from 'react';
import ToolShell, { NumField, Panel, ResultCard, rupees, toNum } from './ToolShell.jsx';
import { usePricing } from '../../../context/PricingContext.jsx';
import { rentForTerm, leaveLicenceStamp } from '../../../lib/toolCalc.js';
import { MAX_MONTHS } from '../services/rent-agreement/constants.js';

const REGISTRATION_FEE = 1000;
const DOCUMENT_HANDLING = 300;

export default function RentAgreementCost() {
  const { prices } = usePricing();
  const [rent, setRent] = useState('25000');
  const [deposit, setDeposit] = useState('100000');
  const [months, setMonths] = useState('11');
  const [increase, setIncrease] = useState('');

  const term = Math.min(Math.max(toNum(months), 1), MAX_MONTHS);
  const years = Math.ceil(term / 12);
  const rentTotal = rentForTerm(toNum(rent), term, increase, 12);
  const stamp = leaveLicenceStamp(rentTotal, 0, toNum(deposit), years);
  const govt = stamp + REGISTRATION_FEE + DOCUMENT_HANDLING;
  const service = prices.rentAgreementPlatform;
  const gst = Math.round((service * prices.gstPercent) / 100);

  return (
    <ToolShell path="/tools/rent-agreement-cost-pune">
      <Panel>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div className="space-y-5">
            <NumField id="ra-rent" label="Monthly rent" value={rent} onChange={setRent} />
            <NumField id="ra-deposit" label="Refundable deposit" value={deposit} onChange={setDeposit} />
            <NumField id="ra-months" label={`Term in months (up to ${MAX_MONTHS})`} value={months} onChange={setMonths} prefix="" suffix="months" maxLength={2} />
            <NumField id="ra-increase" label="Yearly rent increase (optional)" value={increase} onChange={setIncrease} prefix="" suffix="%" decimal maxLength={5} />
            {toNum(months) > MAX_MONTHS && <p role="alert" className="text-xs text-amber-400">This tool covers up to {MAX_MONTHS} months. Longer agreements are taxed like a lease, so the sum differs.</p>}
          </div>
          <ResultCard
            label="Government charges"
            value={rupees(govt)}
            rows={[
              ['Rent for the term', rupees(rentTotal)],
              ['Stamp duty (0.25%)', rupees(stamp)],
              ['Registration fee', rupees(REGISTRATION_FEE)],
              ['Document handling', rupees(DOCUMENT_HANDLING)],
              ['Draazy service fee', rupees(service)],
              [`GST on service fee (${prices.gstPercent}%)`, rupees(gst)],
              ['Total with Draazy', rupees(govt + service + gst)],
            ]}
            note="The Draazy rows apply only if you book the agreement through Draazy. Final amounts are confirmed at registration."
          />
        </div>
      </Panel>
    </ToolShell>
  );
}
