'use client';

const presets = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ from, to, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => {
        const presetFrom = new Date(Date.now() - preset.days * 86400000).toISOString();
        const presetTo = new Date().toISOString();
        const active = Math.abs(new Date(from).getTime() - new Date(presetFrom).getTime()) < 86400000;

        return (
          <button
            key={preset.label}
            onClick={() => onChange(presetFrom, presetTo)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            {preset.label}
          </button>
        );
      })}

      <input
        type="date"
        value={from.slice(0, 10)}
        onChange={(e) => onChange(new Date(e.target.value).toISOString(), to)}
        className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300"
      />
      <span className="text-gray-600">–</span>
      <input
        type="date"
        value={to.slice(0, 10)}
        onChange={(e) => onChange(from, new Date(e.target.value).toISOString())}
        className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-gray-300"
      />
    </div>
  );
}
