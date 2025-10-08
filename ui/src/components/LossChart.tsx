import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingDown } from 'lucide-react';

interface TensorboardEvent {
  step: number;
  value: number;
  wall_time: number;
}

interface LossChartProps {
  data: TensorboardEvent[];
  smoothData?: TensorboardEvent[];
  isLoading?: boolean;
}

export default function LossChart({ data, smoothData, isLoading = false }: LossChartProps) {
  // Combine raw and smooth data into single dataset
  const chartData = data.map((point, index) => ({
    step: point.step,
    loss: point.value,
    smoothLoss: smoothData?.[index]?.value
  }));
  
  // Format Y-axis tick labels - use decimal notation for better readability
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1) {
      return value.toFixed(2);
    } else if (Math.abs(value) >= 0.01) {
      return value.toFixed(3);
    } else if (Math.abs(value) >= 0.001) {
      return value.toFixed(4);
    } else {
      // For very small values, use scientific notation
      return value.toExponential(1);
    }
  };

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
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#F3F4F6',
                  fontSize: '12px'
                }}
                formatter={(value: number, name: string) => {
                  const formatted = typeof value === 'number' ? value.toFixed(4) : value;
                  const label = name === 'loss' ? 'Loss' : 'Smooth';
                  return [formatted, label];
                }}
                labelFormatter={(step: number) => `Step: ${step}`}
              />
              <Line
                type="monotone"
                dataKey="loss"
                stroke="#EF4444"
                strokeWidth={1}
                dot={false}
                activeDot={{ r: 3, fill: '#EF4444' }}
                opacity={0.6}
                isAnimationActive={false}
              />
              {smoothData && smoothData.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="smoothLoss"
                  stroke="#FCA5A5"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: '#FCA5A5' }}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            {isLoading ? 'Loading chart data...' : 'No loss data available'}
          </div>
        )}
      </div>
    </div>
  );
}