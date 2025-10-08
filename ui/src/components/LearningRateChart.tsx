import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface TensorboardEvent {
  step: number;
  value: number;
  wall_time: number;
}

interface LearningRateChartProps {
  data: TensorboardEvent[];
  isLoading?: boolean;
}

export default function LearningRateChart({ data, isLoading = false }: LearningRateChartProps) {
  const chartData = data.map(point => ({
    step: point.step,
    lr: point.value
  }));
  
  // Format Y-axis tick labels - use decimal notation for better readability
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 0.1) {
      return value.toFixed(4);
    } else if (Math.abs(value) >= 0.00001) {
      return value.toFixed(6);
    } else {
      // For very small values, use scientific notation
      return value.toExponential(1);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl shadow-lg border border-gray-800 p-4">
      <div className="flex items-center mb-3">
        <TrendingUp className="w-5 h-5 mr-2 text-blue-400" />
        <h3 className="text-gray-100 font-medium">Learning Rate</h3>
        {isLoading && (
          <div className="ml-auto">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          </div>
        )}
      </div>

      <div className="h-64">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="step"
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={['auto', 'auto']}
                tickFormatter={formatYAxis}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F3F4F6',
                  fontSize: '12px'
                }}
                formatter={(value: number) => [typeof value === 'number' ? value.toFixed(6) : value, 'LR']}
                labelFormatter={(step: number) => `Step: ${step}`}
              />
              <Line
                type="monotone"
                dataKey="lr"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#3B82F6' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {isLoading ? 'Loading chart data...' : 'No learning rate data available'}
          </div>
        )}
      </div>
    </div>
  );
}