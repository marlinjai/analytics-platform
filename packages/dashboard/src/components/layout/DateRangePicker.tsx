'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------
const presets = [
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
  { label: '90d', hours: 2160 },
];

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------
function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1);
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(dateStr: string): Date {
  // Parse YYYY-MM-DD as local date (not UTC)
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 2000;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// Calendar component
// ---------------------------------------------------------------------------
interface CalendarProps {
  fromISO: string; // YYYY-MM-DD
  toISO: string;   // YYYY-MM-DD
  onSelect: (from: string, to: string) => void;
}

function Calendar({ fromISO, toISO, onSelect }: CalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(() => {
    const d = parseLocalDate(toISO);
    return d.getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const d = parseLocalDate(toISO);
    return d.getMonth();
  });
  // Picking state: first click sets anchor, second click finishes range
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const fromDate = parseLocalDate(fromISO);
  const toDate = parseLocalDate(toISO);

  const firstDay = startOfMonth(viewYear, viewMonth).getDay(); // 0=Sun
  const totalDays = daysInMonth(viewYear, viewMonth);

  // Cells: leading blanks + day numbers
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  function cellDate(day: number) {
    return new Date(viewYear, viewMonth, day);
  }

  function handleDayClick(day: number) {
    const dateStr = isoDate(cellDate(day));
    if (!anchor) {
      // First click — set anchor
      setAnchor(dateStr);
    } else {
      // Second click — finalise range
      const a = parseLocalDate(anchor);
      const b = parseLocalDate(dateStr);
      if (b < a) {
        onSelect(dateStr, anchor);
      } else {
        onSelect(anchor, dateStr);
      }
      setAnchor(null);
      setHovered(null);
    }
  }

  function getDayClasses(day: number) {
    const d = cellDate(day);
    const dStr = isoDate(d);
    const isToday = sameDay(d, today);
    const isFuture = d > today;

    let rangeFrom: Date;
    let rangeTo: Date;

    if (anchor && hovered) {
      const a = parseLocalDate(anchor);
      const h = parseLocalDate(hovered);
      rangeFrom = a < h ? a : h;
      rangeTo = a < h ? h : a;
    } else {
      rangeFrom = fromDate;
      rangeTo = toDate;
    }

    const isStart = sameDay(d, rangeFrom);
    const isEnd = sameDay(d, rangeTo);
    const inRange = d >= rangeFrom && d <= rangeTo;
    const isAnchor = anchor === dStr;

    let base = 'relative flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors select-none';

    if (isFuture) {
      base += ' cursor-not-allowed text-gray-600';
    } else {
      base += ' cursor-pointer';
    }

    if (isStart || isEnd || isAnchor) {
      base += ' bg-blue-600 text-white';
    } else if (inRange) {
      base += ' bg-blue-900/50 text-blue-200';
    } else if (isToday) {
      base += ' text-blue-400 ring-1 ring-blue-600';
    } else {
      base += ' text-gray-300 hover:bg-gray-700';
    }

    return base;
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }

  function nextMonth() {
    const now = new Date();
    if (viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth >= now.getMonth())) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const canGoNext = !(
    viewYear > today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth >= today.getMonth())
  );

  return (
    <div className="w-64 select-none">
      {/* Month navigation */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={prevMonth}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition"
          aria-label="Previous month"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-200">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button
          onClick={nextMonth}
          disabled={!canGoNext}
          className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-30 transition"
          aria-label="Next month"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-1 grid grid-cols-7 gap-0">
        {WEEKDAYS.map((wd) => (
          <div key={wd} className="flex h-7 items-center justify-center text-[10px] font-medium text-gray-500">
            {wd}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center p-0.5">
            {day !== null ? (
              <button
                type="button"
                disabled={cellDate(day) > today}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => anchor && setHovered(isoDate(cellDate(day)))}
                onMouseLeave={() => setHovered(null)}
                className={getDayClasses(day)}
              >
                {day}
              </button>
            ) : (
              <div className="h-8 w-8" />
            )}
          </div>
        ))}
      </div>

      {/* Hint text */}
      {anchor && (
        <p className="mt-2 text-center text-[10px] text-gray-500">
          Click another date to complete the range
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateRangePicker — with URL sync and calendar dropdown
// ---------------------------------------------------------------------------
interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

export function DateRangePicker({ from, to, onChange }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [showCalendar, setShowCalendar] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync from/to into URL search params whenever they change
  const syncToUrl = useCallback(
    (newFrom: string, newTo: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('from', newFrom.slice(0, 10));
      params.set('to', newTo.slice(0, 10));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  function handleChange(newFrom: string, newTo: string) {
    onChange(newFrom, newTo);
    syncToUrl(newFrom, newTo);
    setShowCalendar(false);
  }

  function handlePreset(presetFrom: string, presetTo: string) {
    onChange(presetFrom, presetTo);
    syncToUrl(presetFrom, presetTo);
    setShowCalendar(false);
  }

  // Close calendar when clicking outside
  useEffect(() => {
    if (!showCalendar) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showCalendar]);

  // Close on Escape
  useEffect(() => {
    if (!showCalendar) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowCalendar(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showCalendar]);

  const fromDisplay = from.slice(0, 10);
  const toDisplay = to.slice(0, 10);

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      {presets.map((preset) => {
        const presetFrom = new Date(Date.now() - preset.hours * 3600000).toISOString();
        const presetTo = new Date().toISOString();
        const active =
          Math.abs(new Date(from).getTime() - new Date(presetFrom).getTime()) <
          preset.hours * 3600000 * 0.1;

        return (
          <button
            key={preset.label}
            onClick={() => handlePreset(presetFrom, presetTo)}
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

      {/* Date range display / trigger */}
      <button
        onClick={() => setShowCalendar((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-600 hover:text-gray-100 transition"
        aria-label="Open calendar date picker"
        aria-expanded={showCalendar}
      >
        <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{fromDisplay}</span>
        <span className="text-gray-600">–</span>
        <span>{toDisplay}</span>
      </button>

      {/* Calendar dropdown */}
      {showCalendar && (
        <div className="absolute right-0 top-full z-50 mt-2 rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
          <Calendar
            fromISO={fromDisplay}
            toISO={toDisplay}
            onSelect={(f, t) => {
              // Convert local date strings to full ISO (start/end of day)
              handleChange(
                new Date(f + 'T00:00:00').toISOString(),
                new Date(t + 'T23:59:59').toISOString(),
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
