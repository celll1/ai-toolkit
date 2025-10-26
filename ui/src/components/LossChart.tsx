import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';

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

// Downsample data to reduce rendering load
const downsampleData = <T extends { step: number }>(data: T[], maxPoints: number = 1000): T[] => {
  if (data.length <= maxPoints) return data;

  const interval = Math.ceil(data.length / maxPoints);
  const downsampled: T[] = [];

  for (let i = 0; i < data.length; i += interval) {
    downsampled.push(data[i]);
  }

  // Always include the last point
  if (downsampled[downsampled.length - 1] !== data[data.length - 1]) {
    downsampled.push(data[data.length - 1]);
  }

  return downsampled;
};

// Calculate smoothed data using exponential moving average
const calculateSmoothing = (data: TensorboardEvent[], smoothingFactor: number): TensorboardEvent[] => {
  if (data.length === 0) return [];

  const smoothed: TensorboardEvent[] = [];
  let lastSmoothed = data[0].value;

  for (const point of data) {
    lastSmoothed = lastSmoothed * smoothingFactor + point.value * (1 - smoothingFactor);
    smoothed.push({
      step: point.step,
      value: lastSmoothed,
      wall_time: point.wall_time
    });
  }

  return smoothed;
};

export default function LossChart({ data, smoothData, isLoading = false }: LossChartProps) {
  const [rangeMode, setRangeMode] = useState<'all' | 'recent'>('all');
  const [maxPoints, setMaxPoints] = useState(1000);
  const [smoothingFactor, setSmoothingFactor] = useState(0.9); // 0-1, higher = smoother

  // Filter data based on range mode
  const filteredData = useMemo(() => {
    if (rangeMode === 'recent' && data.length > 0) {
      const recentCount = Math.min(1000, data.length);
      return data.slice(-recentCount);
    }
    return data;
  }, [data, rangeMode]);

  // Calculate client-side smoothing with user-adjustable factor
  const clientSmoothData = useMemo(() => {
    return calculateSmoothing(filteredData, smoothingFactor);
  }, [filteredData, smoothingFactor]);

  // Downsample and combine raw and smooth data into single dataset (memoized)
  const chartData = useMemo(() => {
    const downsampled = downsampleData(filteredData, maxPoints);
    const smoothDownsampled = downsampleData(clientSmoothData, maxPoints);

    return downsampled.map((point, index) => ({
      step: point.step,
      loss: point.value,
      smoothLoss: smoothDownsampled?.[index]?.value
    }));
  }, [filteredData, clientSmoothData, maxPoints]);

  // Helper function to calculate nice ticks
  const calculateNiceTicks = (dataMin: number, dataMax: number, maxTicks: number = 5): number[] => {
    if (dataMin === dataMax) return [dataMin];

    const range = dataMax - dataMin;
    const roughStep = range / (maxTicks - 1);

    // Find nice step size (1, 2, 5, 10, 20, 50, 100, etc.)
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;
    let niceStep;

    if (normalized < 1.5) niceStep = 1 * magnitude;
    else if (normalized < 3) niceStep = 2 * magnitude;
    else if (normalized < 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    // Generate ticks starting from floor and going up
    const ticks: number[] = [];
    const start = Math.floor(dataMin / niceStep) * niceStep;
    const end = Math.ceil(dataMax / niceStep) * niceStep;

    for (let tick = start; tick <= end; tick += niceStep) {
      ticks.push(tick);
    }

    return ticks;
  };

  // Calculate nice Y-axis ticks (memoized)
  const niceYTicks = useMemo(() => {
    const allValues = [...chartData.map(d => d.loss), ...(smoothData ? chartData.map(d => d.smoothLoss).filter(v => v !== undefined) : [])] as number[];
    const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
    const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
    return calculateNiceTicks(dataMin, dataMax);
  }, [chartData, smoothData]);

  // Calculate nice X-axis ticks (memoized)
  const niceXTicks = useMemo(() => {
    const allSteps = chartData.map(d => d.step);
    const minStep = allSteps.length > 0 ? Math.min(...allSteps) : 0;
    const maxStep = allSteps.length > 0 ? Math.max(...allSteps) : 1;
    return calculateNiceTicks(minStep, maxStep, 6);
  }, [chartData]);

  // Format Y-axis tick labels
  const formatYAxis = (value: number) => {
    if (value === 0) return '0';
    if (Math.abs(value) >= 1) {
      return value.toFixed(1);
    } else if (Math.abs(value) >= 0.01) {
      return value.toFixed(2);
    } else if (Math.abs(value) >= 0.001) {
      return value.toFixed(3);
    } else {
      return value.toFixed(4);
    }
  };

  return (
    <div className="bg-gray-900 rounded-xl shadow-lg border border-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center">
          <TrendingDown className="w-5 h-5 mr-2 text-red-400" />
          <h3 className="text-gray-100 font-medium">Loss</h3>
          {isLoading && (
            <div className="ml-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setRangeMode('all')}
            className={`px-2 py-1 rounded ${
              rangeMode === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setRangeMode('recent')}
            className={`px-2 py-1 rounded ${
              rangeMode === 'recent'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Recent
          </button>
          <span className="text-gray-400">
            ({chartData.length} pts)
          </span>
        </div>
      </div>

      {/* Smoothing slider */}
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-gray-400 whitespace-nowrap">
          Smoothing:
        </label>
        <input
          type="range"
          min="0"
          max="0.99"
          step="0.01"
          value={smoothingFactor}
          onChange={(e) => setSmoothingFactor(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          style={{
            background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${smoothingFactor * 100}%, #374151 ${smoothingFactor * 100}%, #374151 100%)`
          }}
        />
        <span className="text-xs text-gray-400 w-10 text-right">
          {smoothingFactor.toFixed(2)}
        </span>
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
                domain={[niceXTicks[0], niceXTicks[niceXTicks.length - 1]]}
                ticks={niceXTicks}
                allowDataOverflow={false}
              />
              <YAxis
                stroke="#9CA3AF"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                domain={[niceYTicks[0], niceYTicks[niceYTicks.length - 1]]}
                ticks={niceYTicks}
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
              <Line
                type="monotone"
                dataKey="smoothLoss"
                stroke="#FCA5A5"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: '#FCA5A5' }}
                isAnimationActive={false}
              />
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