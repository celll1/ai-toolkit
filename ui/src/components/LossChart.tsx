import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingDown } from 'lucide-react';

interface TensorboardEvent {
  step: number;
  value: number;
  wall_time: number;
}

interface LossChartProps {
  data: TensorboardEvent[];
  isLoading?: boolean;
}

export default function LossChart({ data, isLoading = false }: LossChartProps) {
  const chartData = data.map(point => ({
    step: point.step,
    loss: point.value
  }));

  return (
    <div className="bg-gray-900 rounded-xl shadow-lg border border-gray-800 p-4">
      <div className="flex items-center mb-3">
        <TrendingDown className="w-5 h-5 mr-2 text-red-400" />
        <h3 className="text-gray-100 font-medium">Loss</h3>
        {isLoading && (
          <div className="ml-auto">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          </div>
        )}
      </div>
      
      <div className="h-32">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="step" 
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="#9CA3AF"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                domain={['dataMin', 'dataMax']}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F3F4F6'
                }}
                formatter={(value: number) => [value.toExponential(3), 'Loss']}
                labelFormatter={(step: number) => `Step: ${step}`}
              />
              <Line 
                type="monotone" 
                dataKey="loss" 
                stroke="#EF4444" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#EF4444' }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {isLoading ? 'Loading chart data...' : 'No loss data available'}
          </div>
        )}
      </div>
      
      {chartData.length > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          Latest: {chartData[chartData.length - 1]?.loss.toExponential(3) || 'N/A'}
        </div>
      )}
    </div>
  );
}