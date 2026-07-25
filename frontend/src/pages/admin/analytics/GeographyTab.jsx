import { BarChart } from '../../../components/charts/index.jsx';
import { C, AX, axis, Card } from './constants.jsx';

export default function GeographyTab({ locs }) {
  return (
    <div>
      <div className="mb-5 grid gap-6 lg:grid-cols-2">
        <Card title="Listings by locality" height={360}>
          <BarChart horizontal labels={locs.map((l) => l.name)} datasets={[{ label: 'Listings', data: locs.map((l) => l.listings), color: C.indigo }]} />
        </Card>
        <Card title="Demand index by locality" height={360}>
          <BarChart horizontal labels={locs.map((l) => l.name)} datasets={[{ label: 'Demand', data: locs.map((l) => l.demand), color: C.teal }]} />
        </Card>
      </div>
      <Card title="Avg. rate ₹/sq.ft by locality" height={300}>
        <BarChart labels={locs.map((l) => l.name)} datasets={[{ label: 'Rate', data: locs.map((l) => l.ratePerSqft), color: C.coral }]} options={{ scales: { x: AX, y: axis({ ticks: { color: '#94a3b8', callback: (v) => `₹${v / 1000}k` } }) } }} />
      </Card>
    </div>
  );
}
