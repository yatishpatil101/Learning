import { useState } from 'react';
import ToolShell, { NumField, Panel, ResultCard, rupees, toNum } from './ToolShell.jsx';
import { rentalYield } from '../../../lib/toolCalc.js';

const pct = (n) => `${n.toFixed(2)}%`;

function reading(r) {
  if (r.net == null) return 'Enter the price to see the yield.';
  if (r.netIncome <= 0) return 'Costs and empty months are higher than the rent, so this property loses money each year.';
  return `For every ₹100 you pay, the property earns about ₹${r.net.toFixed(2)} a year after costs. It would take about ${r.payback.toFixed(1)} years of rent to earn back the price. Compare this with the interest on your home loan or what else your money could earn.`;
}

export default function RentalYield() {
  const [price, setPrice] = useState('7500000');
  const [rent, setRent] = useState('25000');
  const [maintenance, setMaintenance] = useState('2000');
  const [propertyTax, setPropertyTax] = useState('6000');
  const [vacancy, setVacancy] = useState('1');

  const r = rentalYield({ price: toNum(price), rent: toNum(rent), maintenance: toNum(maintenance), propertyTax: toNum(propertyTax), vacancyMonths: toNum(vacancy) });

  return (
    <ToolShell path="/tools/rental-yield-calculator">
      <Panel>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr] lg:gap-10">
          <div className="space-y-5">
            <NumField id="ry-price" label="Property price" value={price} onChange={setPrice} />
            <NumField id="ry-rent" label="Monthly rent" value={rent} onChange={setRent} />
            <NumField id="ry-maintenance" label="Monthly maintenance paid by you" value={maintenance} onChange={setMaintenance} />
            <NumField id="ry-tax" label="Property tax a year" value={propertyTax} onChange={setPropertyTax} />
            <NumField id="ry-vacancy" label="Empty months a year (0 to 12)" value={vacancy} onChange={setVacancy} prefix="" suffix="months" maxLength={2} />
          </div>
          <ResultCard
            label="Net rental yield"
            value={r.net == null ? '–' : pct(r.net)}
            rows={r.net == null ? null : [
              ['Gross yield', pct(r.gross)],
              ['Yearly rent at full occupancy', rupees(r.grossRent)],
              ['Net income a year', rupees(r.netIncome)],
              ['Payback', r.payback == null ? '–' : `${r.payback.toFixed(1)} years`],
            ]}
            note={reading(r)}
          />
        </div>
      </Panel>
    </ToolShell>
  );
}
