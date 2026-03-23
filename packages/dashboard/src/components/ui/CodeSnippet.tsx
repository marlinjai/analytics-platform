'use client';

import { useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface CodeTab {
  label: string;
  language: string;
  code: string;
}

interface CodeSnippetProps {
  tabs: CodeTab[];
}

// ── Component ────────────────────────────────────────────────────────────────

export function CodeSnippet({ tabs }: CodeSnippetProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const tab = tabs[activeTab];
    if (!tab) return;
    await navigator.clipboard.writeText(tab.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 px-1">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-3 py-2 text-xs font-medium transition ${
                activeTab === i
                  ? 'border-b-2 border-blue-500 text-blue-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="mr-1 rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 transition"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Code block */}
      <pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed text-gray-300">
        <code>{tabs[activeTab]?.code}</code>
      </pre>
    </div>
  );
}
