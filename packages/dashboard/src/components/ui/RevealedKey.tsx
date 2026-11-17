'use client';

/**
 * A freshly created API key, shown once with its copy button. The key is
 * marked `data-feedback-mask`, so a feedback screenshot taken while it is on
 * screen shows a black box instead of a working secret.
 */
export function RevealedKey({ value, copied, onCopy }: { value: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <code className="block flex-1 break-all rounded bg-gray-800 px-3 py-2 text-sm text-gray-100" data-feedback-mask>
        {value}
      </code>
      <button
        onClick={onCopy}
        className="shrink-0 rounded-lg bg-gray-700 px-3 py-2 text-sm font-medium text-gray-100 hover:bg-gray-600 transition"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
