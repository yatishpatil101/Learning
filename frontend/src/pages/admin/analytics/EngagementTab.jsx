import { BarChart, LineChart } from '../../../components/charts/index.jsx';
import { C, WK12, Card } from './constants.jsx';

export default function EngagementTab() {
  return (
    <div>
      <div className="mb-5 grid gap-6 lg:grid-cols-2">
        <Card title="Avg. session duration" desc="minutes" chip="Sample">
          <LineChart labels={WK12} datasets={[{ label: 'Minutes', data: [3.2, 3.4, 3.1, 3.6, 3.8, 3.7, 4.0, 4.2, 4.1, 4.4, 4.6, 4.5], color: C.teal, fill: true }]} />
        </Card>
        <Card title="Bounce rate" desc="%" chip="Sample">
          <LineChart labels={WK12} datasets={[{ label: 'Bounce %', data: [48, 47, 49, 45, 44, 43, 42, 41, 40, 39, 38, 37], color: C.coral, fill: true }]} />
        </Card>
      </div>
      <Card title="Top pages by views" chip="Sample" height={300}>
        <BarChart horizontal labels={['Home', 'Listings (Buy)', 'Listings (Rent)', 'Property detail', 'Services', 'Locality insights', 'EMI calculator', 'Post property']} datasets={[{ label: 'Index', data: [100, 86, 74, 68, 41, 33, 28, 22], color: C.indigo }]} />
      </Card>
    </div>
  );
}
