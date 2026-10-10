import { useState } from 'react';
import ToolShell, { NumField, Panel, ResultCard, rupees, toNum } from './ToolShell.jsx';
import { PUNE_STAMP_RATE_PCT, computeStampDuty } from '../../../lib/toolCalc.js';
import { fmtINR } from '../../../lib/format.js';

export default function StampDutyTool() {
  const [agreement, setAgreement] = useState('7500000');
  const [reckoner, setReckoner] = useState('');
  const value = Math.max(toNum(agreement), toNum(reckoner));
  const { stamp, reg, total } = computeStampDuty(value, PUNE_STAMP_RATE_PCT);

  return (
    <ToolShell path="/tools/stamp-duty-calculator-maharashtra">
      <Panel>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div className="space-y-5">
            <NumField id="sd-agreement" label="Agreement value" value={agreement} onChange={setAgreement} />
            <NumField id="sd-reckoner" label="Ready reckoner value (optional)" value={reckoner} onChange={setReckoner} />
            <p className="text-xs text-gray-400">Area: Pune Municipal Corporation and PCMC limits ({PUNE_STAMP_RATE_PCT}%). Stamp duty is charged on the higher of the two values.</p>
          </div>
          <ResultCard
            label="Stamp duty and registration fee"
            value={rupees(total)}
            rows={[
              ['Value used', `${rupees(value)} (${fmtINR(value)})`],
              [`Stamp duty (${PUNE_STAMP_RATE_PCT}%)`, rupees(stamp)],
              ['Registration fee (1%, max ₹30,000)', rupees(reg)],
            ]}
            note="Estimate for a sale in PMC or PCMC limits. Confirm the final amount with IGR Maharashtra or your Sub-Registrar office."
          />
        </div>
      </Panel>
    </ToolShell>
  );
}
