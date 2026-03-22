"use client";

import { useState } from "react";
import { TIME_LABELS, SLOTS_PER_DAY } from "@/lib/constants";

const PREF_COLORS = [
  "bg-[var(--slot-0-bg)] text-[var(--slot-0-text)]",  // 0 — unavailable
  "bg-[var(--slot-1-bg)] text-[var(--slot-1-text)]",  // 1 — low
  "bg-[var(--slot-2-bg)] text-[var(--slot-2-text)]",  // 2 — medium
  "bg-[var(--slot-3-bg)] text-[var(--slot-3-text)]",  // 3 — high
  "bg-[var(--slot-4-bg)] text-[var(--slot-4-text)]",  // 4 — best
];

interface MultiDaySlotSelectorProps {
  numDays: number;
  startDate: number; // unix timestamp
  onSubmit: (slots: number[]) => void;
  disabled?: boolean;
}

function formatDayLabel(startDate: number, dayIndex: number): string {
  const date = new Date(startDate * 1000);
  date.setDate(date.getDate() + dayIndex);

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);

  const dayStr = date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  if (date.toDateString() === today.toDateString()) return `Today (${dayStr})`;
  if (date.toDateString() === tomorrow.toDateString())
    return `Tomorrow (${dayStr})`;
  return dayStr;
}

export function MultiDaySlotSelector({
  numDays,
  startDate,
  onSubmit,
  disabled,
}: MultiDaySlotSelectorProps) {
  const totalSlots = numDays * SLOTS_PER_DAY;
  const [slots, setSlots] = useState<number[]>(new Array(totalSlots).fill(0));
  const [activeDay, setActiveDay] = useState(0);

  const cycleSlot = (dayIndex: number, slotIndex: number) => {
    if (disabled) return;
    const flatIndex = dayIndex * SLOTS_PER_DAY + slotIndex;
    setSlots((prev) => {
      const next = [...prev];
      next[flatIndex] = (next[flatIndex] + 1) % 5;
      return next;
    });
  };

  const getDaySlots = (dayIndex: number): number[] => {
    const start = dayIndex * SLOTS_PER_DAY;
    return slots.slice(start, start + SLOTS_PER_DAY);
  };

  const getDayTotal = (dayIndex: number): number => {
    return getDaySlots(dayIndex).reduce((a, b) => a + b, 0);
  };

  return (
    <div className="space-y-4">
      {/* Day tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {Array.from({ length: numDays }).map((_, dayIdx) => {
          const dayTotal = getDayTotal(dayIdx);
          return (
            <button
              key={dayIdx}
              onClick={() => setActiveDay(dayIdx)}
              className={`flex-shrink-0 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeDay === dayIdx
                  ? "bg-[var(--accent)] text-white"
                  : dayTotal > 0
                  ? "bg-[var(--accent)]/20 text-[var(--accent-light)] hover:bg-[var(--accent)]/30"
                  : "bg-[var(--card)] text-[var(--muted)] hover:text-[var(--muted-strong)]"
              }`}
            >
              <div className="font-medium whitespace-nowrap">
                {formatDayLabel(startDate, dayIdx)}
              </div>
              {dayTotal > 0 && (
                <div className="text-xs opacity-75">{dayTotal} pts</div>
              )}
            </button>
          );
        })}
      </div>

      {/* Slot selector for active day */}
      <div className="space-y-1">
        <div className="text-xs text-[var(--muted)] mb-2">
          Tap each slot to cycle preference (0 = unavailable, 4 = best)
        </div>
        <div className="grid grid-cols-1 gap-2">
          {TIME_LABELS.map((label, slotIdx) => {
            const flatIndex = activeDay * SLOTS_PER_DAY + slotIdx;
            return (
              <button
                key={slotIdx}
                onClick={() => cycleSlot(activeDay, slotIdx)}
                disabled={disabled}
                className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                  PREF_COLORS[slots[flatIndex]]
                } ${
                  disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:opacity-80 cursor-pointer"
                }`}
              >
                <span className="font-medium">{label}</span>
                <span className="text-lg font-bold">
                  {slots[flatIndex] === 0 ? "\u2715" : slots[flatIndex]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary across all days */}
      {numDays > 1 && (
        <div className="p-3 bg-[var(--card)] border border-[var(--border)] rounded-lg">
          <div className="text-xs text-[var(--muted)] mb-2">All days overview</div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: numDays }).map((_, dayIdx) => (
              <div key={dayIdx} className="space-y-0.5">
                <div className="text-xs text-center text-[var(--muted)]">
                  {new Date(startDate * 1000 + dayIdx * 86400000).toLocaleDateString(
                    "en-US",
                    { weekday: "narrow" }
                  )}
                </div>
                {getDaySlots(dayIdx).map((val, slotIdx) => (
                  <div
                    key={slotIdx}
                    className={`h-2 rounded-sm ${
                      val === 0
                        ? "bg-[var(--slot-0-bg)]"
                        : val === 1
                        ? "bg-[var(--slot-1-bg)]"
                        : val === 2
                        ? "bg-[var(--slot-2-bg)]"
                        : val === 3
                        ? "bg-[var(--slot-3-bg)]"
                        : "bg-[var(--slot-4-bg)]"
                    }`}
                    title={`${formatDayLabel(startDate, dayIdx)} ${TIME_LABELS[slotIdx]}: ${val}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onSubmit(slots)}
        disabled={disabled || slots.every((s) => s === 0)}
        className="w-full mt-2 px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] active:scale-95 disabled:opacity-40 disabled:active:scale-100 rounded-lg text-white font-medium transition-all"
      >
        Submit Availability ({numDays} day{numDays > 1 ? "s" : ""})
      </button>
    </div>
  );
}
