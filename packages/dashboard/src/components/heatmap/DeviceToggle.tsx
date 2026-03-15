'use client';

import type { DeviceType } from '@analytics-platform/shared';

const devices: { value: DeviceType | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'mobile', label: 'Mobile' },
];

interface Props {
  selected: DeviceType | '';
  onChange: (device: DeviceType | '') => void;
}

export function DeviceToggle({ selected, onChange }: Props) {
  return (
    <div className="flex rounded-lg border border-gray-700 bg-gray-800">
      {devices.map((d) => (
        <button
          key={d.value}
          onClick={() => onChange(d.value)}
          className={`px-3 py-1.5 text-xs font-medium transition first:rounded-l-lg last:rounded-r-lg ${
            selected === d.value
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}
