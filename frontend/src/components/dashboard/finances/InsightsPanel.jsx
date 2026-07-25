import { BarChart, DoughnutChart } from '../../charts/index.jsx';
import { Card, SectionHead } from './helpers.jsx';

export default function InsightsPanel({ cf, cfData, expBreak, expData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
      <Card className="p-5 sm:p-6">
        <SectionHead icon="bar-chart-3" title="Cashflow by month" />
        {cf.labels?.length > 0 ? <BarChart labels={cfData.labels} datasets={cfData.datasets} height={220} /> : <p className="text-gray-400 text-sm text-center py-8">No data yet</p>}
      </Card>
      <Card className="p-5 sm:p-6">
        <SectionHead icon="pie-chart" title="Expense breakdown" />
        {expBreak.length > 0 ? <DoughnutChart labels={expData.labels} values={expData.values} colors={expData.colors} height={220} /> : <p className="text-gray-400 text-sm text-center py-8">No expenses recorded</p>}
      </Card>
    </div>
  );
}
