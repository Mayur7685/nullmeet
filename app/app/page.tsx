"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MAX_DAYS, MAX_PARTICIPANTS } from "@/lib/constants";

export default function Home() {
  const router = useRouter();
  const { connected } = useWallet();
  const [numDays, setNumDays] = useState(3);
  const [maxParticipants, setMaxParticipants] = useState(5);

  const handleStart = () => {
    const meetingId = Math.floor(Math.random() * 1_000_000_000);
    router.push(`/meet/${meetingId}?days=${numDays}&max=${maxParticipants}`);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="max-w-lg text-center space-y-8">
        <h1 className="text-5xl font-bold tracking-tight">
          Null<span className="text-[var(--accent)]">meet</span>
          <span className="text-lg text-[var(--muted)] ml-2">v2</span>
        </h1>
        <p className="text-lg text-[var(--muted)]">
          Find a common meeting time. Reveal nothing else.
        </p>
        <p className="text-sm text-[var(--muted)] max-w-md">
          Multiple people compute the best meeting slot from their private
          calendars across multiple days. No one sees anyone else&apos;s
          availability. Only the result is public. Built on MagicBlock&apos;s
          Private Ephemeral Rollups (TEE) on Solana.
        </p>

        <div className="flex flex-col items-center gap-4">
          <WalletMultiButton />

          {connected && (
            <div className="w-full max-w-sm space-y-4">
              {/* Meeting config */}
              <div className="p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-[var(--muted)]">
                    Scheduling days
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setNumDays(Math.max(1, numDays - 1))}
                      className="w-8 h-8 bg-[var(--border)] hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50 rounded text-[var(--foreground)] font-bold transition-colors select-none"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-bold">{numDays}</span>
                    <button
                      onClick={() =>
                        setNumDays(Math.min(MAX_DAYS, numDays + 1))
                      }
                      className="w-8 h-8 bg-[var(--border)] hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50 rounded text-[var(--foreground)] font-bold transition-colors select-none"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm text-[var(--muted)]">
                    Max participants
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setMaxParticipants(Math.max(2, maxParticipants - 1))
                      }
                      className="w-8 h-8 bg-[var(--border)] hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50 rounded text-[var(--foreground)] font-bold transition-colors select-none"
                    >
                      -
                    </button>
                    <span className="w-8 text-center font-bold">
                      {maxParticipants}
                    </span>
                    <button
                      onClick={() =>
                        setMaxParticipants(
                          Math.min(MAX_PARTICIPANTS, maxParticipants + 1)
                        )
                      }
                      className="w-8 h-8 bg-[var(--border)] hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50 rounded text-[var(--foreground)] font-bold transition-colors select-none"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <button
                onClick={handleStart}
                className="w-full px-8 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] active:scale-95 rounded-lg text-white font-medium transition-all"
              >
                Start a Meeting
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 pt-8 text-sm text-[var(--muted)]">
          <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)]">
            <div className="font-medium text-[var(--foreground)] mb-1">Private</div>
            <div>Slots never leave the TEE enclave</div>
          </div>
          <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)]">
            <div className="font-medium text-[var(--foreground)] mb-1">Group</div>
            <div>Up to 10 participants</div>
          </div>
          <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)]">
            <div className="font-medium text-[var(--foreground)] mb-1">Multi-day</div>
            <div>Schedule across 7 days</div>
          </div>
        </div>
      </div>
    </main>
  );
}
