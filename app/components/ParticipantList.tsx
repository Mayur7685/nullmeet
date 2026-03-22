"use client";

import { Participant } from "@/hooks/useMeeting";

interface ParticipantListProps {
  participants: Participant[];
  maxParticipants: number;
  hostAddress?: string;
  currentAddress?: string;
}

export function ParticipantList({
  participants,
  maxParticipants,
  hostAddress,
  currentAddress,
}: ParticipantListProps) {
  const truncate = (addr: string) =>
    `${addr.slice(0, 4)}...${addr.slice(-4)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-[var(--muted-strong)]">
          Participants ({participants.length}/{maxParticipants})
        </div>
        <div className="text-xs text-[var(--muted)]">
          {maxParticipants - participants.length} spots left
        </div>
      </div>

      <div className="space-y-2">
        {participants.map((p) => (
          <div
            key={p.address}
            className="flex items-center justify-between px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg"
          >
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  p.ready ? "bg-[var(--success)]" : "bg-[var(--warning)] animate-pulse"
                }`}
              />
              <span className="text-sm font-mono text-[var(--muted-strong)]">
                {truncate(p.address)}
              </span>
              {p.address === hostAddress && (
                <span className="text-xs px-1.5 py-0.5 bg-[var(--accent)] text-white rounded">
                  Host
                </span>
              )}
              {p.address === currentAddress && (
                <span className="text-xs px-1.5 py-0.5 bg-[var(--border)] text-[var(--muted-strong)] rounded">
                  You
                </span>
              )}
            </div>
            <span className="text-xs text-[var(--muted)]">
              {p.ready ? "Submitted" : "Pending"}
            </span>
          </div>
        ))}

        {/* Empty slots */}
        {Array.from({
          length: Math.max(0, maxParticipants - participants.length),
        }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center justify-center px-3 py-2 border border-dashed border-[var(--border)] rounded-lg"
          >
            <span className="text-xs text-[var(--muted)]">Empty slot</span>
          </div>
        ))}
      </div>
    </div>
  );
}
