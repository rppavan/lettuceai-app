import { useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn, interactive } from "../design-tokens";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

function composeMs(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const safeDay = clamp(day, 1, daysInMonth(year, month0));
  return new Date(year, month0, safeDay, hour, minute, 0, 0).getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

interface DateTimePickerProps {
  valueMs: number;
  onChange: (ms: number) => void;
  className?: string;
}

export function DateTimePicker({ valueMs, onChange, className }: DateTimePickerProps) {
  const current = new Date(valueMs);
  const year = current.getFullYear();
  const month0 = current.getMonth();
  const day = current.getDate();
  const hour = current.getHours();
  const minute = current.getMinutes();

  const cells = useMemo(() => {
    const total = daysInMonth(year, month0);
    const leading = (new Date(year, month0, 1).getDay() + 6) % 7; // Monday-first
    const out: (number | null)[] = [];
    for (let i = 0; i < leading; i += 1) out.push(null);
    for (let d = 1; d <= total; d += 1) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, month0]);

  const shiftMonth = (delta: number) => {
    const m = month0 + delta;
    const nextYear = year + Math.floor(m / 12);
    const nextMonth = ((m % 12) + 12) % 12;
    onChange(composeMs(nextYear, nextMonth, day, hour, minute));
  };

  const pickDay = (d: number) => onChange(composeMs(year, month0, d, hour, minute));
  const stepHour = (delta: number) =>
    onChange(composeMs(year, month0, day, clamp(hour + delta, 0, 23), minute));
  const stepMinute = (delta: number) =>
    onChange(composeMs(year, month0, day, hour, clamp(minute + delta, 0, 59)));

  const cellBase =
    "flex h-7 items-center justify-center rounded-md text-[12px] tabular-nums";

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-fg/12 bg-fg/5 p-2",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md text-fg/55 hover:bg-fg/10 hover:text-fg/85",
            interactive.transition.fast,
          )}
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-[12px] font-semibold text-fg/80">
          {MONTHS[month0]} {year}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md text-fg/55 hover:bg-fg/10 hover:text-fg/85",
            interactive.transition.fast,
          )}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="flex h-5 items-center justify-center text-[9px] font-semibold uppercase tracking-wide text-fg/35"
          >
            {label}
          </div>
        ))}
        {cells.map((cell, index) =>
          cell === null ? (
            <div key={`empty-${index}`} className={cellBase} />
          ) : (
            <button
              key={`day-${cell}`}
              type="button"
              onClick={() => pickDay(cell)}
              className={cn(
                cellBase,
                interactive.transition.fast,
                cell === day
                  ? "bg-accent font-semibold text-black"
                  : "text-fg/70 hover:bg-fg/10 hover:text-fg/90",
              )}
            >
              {cell}
            </button>
          ),
        )}
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-fg/8 pt-2">
        <TimeStepper
          value={hour}
          onStep={stepHour}
          label="Hour"
        />
        <span className="text-lg font-semibold text-fg/50">:</span>
        <TimeStepper
          value={minute}
          onStep={stepMinute}
          label="Minute"
        />
      </div>
    </div>
  );
}

function TimeStepper({
  value,
  onStep,
  label,
}: {
  value: number;
  onStep: (delta: number) => void;
  label: string;
}) {
  const btn = cn(
    "flex h-5 w-9 items-center justify-center rounded-md text-fg/55 hover:bg-fg/10 hover:text-fg/85",
    interactive.transition.fast,
  );
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button type="button" onClick={() => onStep(1)} aria-label={`Increase ${label}`} className={btn}>
        <ChevronUp size={14} />
      </button>
      <span className="w-9 text-center text-base font-semibold tabular-nums text-fg/90">
        {pad(value)}
      </span>
      <button type="button" onClick={() => onStep(-1)} aria-label={`Decrease ${label}`} className={btn}>
        <ChevronDown size={14} />
      </button>
    </div>
  );
}
