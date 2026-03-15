'use client';

interface Props {
  urls: string[];
  selected: string;
  onChange: (url: string) => void;
}

export function UrlSelector({ urls, selected, onChange }: Props) {
  return (
    <select
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
    >
      <option value="">Select a page...</option>
      {urls.map((url) => (
        <option key={url} value={url}>
          {url}
        </option>
      ))}
    </select>
  );
}
