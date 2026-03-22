"use client";

import { useState } from "react";
import { TEE_RPC_URL, TEE_VALIDATOR, TIME_LABELS } from "@/lib/constants";
import { verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
);

interface MeetingResultProps {
  resultDay: number | null;
  resultSlot: number | null;
  resultScore: number | null;
  validOverlap: boolean;
  startDate: number;
  participantCount: number;
  txHash?: string | null;
  meetingAccount?: string | null;
}

export function MeetingResult({
  resultDay,
  resultSlot,
  resultScore,
  validOverlap,
  startDate,
  participantCount,
  txHash,
  meetingAccount,
}: MeetingResultProps) {
  const [teeVerified, setTeeVerified] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);

  const handleVerifyTee = async () => {
    setVerifying(true);
    try {
      const isValid = await verifyTeeRpcIntegrity(TEE_RPC_URL);
      setTeeVerified(isValid);
    } catch (err) {
      console.error("TEE verification failed:", err);
      setTeeVerified(false);
    }
    setVerifying(false);
  };

  const getResultDate = (): Date | null => {
    if (resultDay === null) return null;
    const date = new Date(startDate * 1000);
    date.setDate(date.getDate() + resultDay);
    return date;
  };

  const generateCalendarLink = (): string => {
    if (resultSlot === null || resultDay === null) return "#";

    const resultDate = getResultDate();
    if (!resultDate) return "#";

    const startHour = (9 + resultSlot).toString().padStart(2, "0");
    const endHour = (10 + resultSlot).toString().padStart(2, "0");

    const dateStr = `${resultDate.getFullYear()}${(resultDate.getMonth() + 1)
      .toString()
      .padStart(2, "0")}${resultDate.getDate().toString().padStart(2, "0")}`;

    const details = meetingAccount
      ? `Meeting+scheduled+via+Nullmeet+(Solana+TEE)%0A${participantCount}+participants%0AOn-chain+proof:+https://explorer.solana.com/address/${meetingAccount}?cluster=devnet`
      : `Meeting+scheduled+via+Nullmeet+(Solana+TEE)%0A${participantCount}+participants`;

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=Private+Group+Meeting&dates=${dateStr}T${startHour}0000/${dateStr}T${endHour}0000&details=${details}`;
  };

  const formatResultDate = (): string => {
    const date = getResultDate();
    if (!date) return "";
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  };

  if (!validOverlap || resultSlot === null || resultDay === null) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">:(</div>
        <div className="text-2xl font-bold text-[var(--error)]">No Overlap Found</div>
        <p className="text-[var(--muted)]">
          No time slot had all {participantCount} participants available.
          Try again with broader availability.
        </p>
      </div>
    );
  }

  return (
    <div className="text-center space-y-6">
      <div className="text-2xl font-bold text-[var(--success)]">Meeting Scheduled!</div>

      <div className="p-6 bg-[var(--card)] border border-[var(--border)] rounded-xl">
        <div className="text-sm text-[var(--muted)] mb-1">Best time slot</div>
        <div className="text-xl font-bold text-[var(--accent-light)] mb-1">
          {formatResultDate()}
        </div>
        <div className="text-3xl font-bold text-[var(--foreground)]">
          {TIME_LABELS[resultSlot]}
        </div>
        <div className="text-sm text-[var(--muted)] mt-2">
          Compatibility score: {resultScore} · {participantCount} participants
        </div>
      </div>

      <a
        href={generateCalendarLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] active:scale-95 text-white font-semibold rounded-lg transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        Add to Google Calendar
      </a>

      <p className="text-sm text-[var(--muted)] max-w-sm mx-auto">
        This result was computed inside a TEE enclave. No participant&apos;s full
        schedule was revealed — only this best matching slot.
      </p>

      {/* On-chain proof */}
      <div className="flex flex-col items-center gap-3">
        {meetingAccount && (
          <a
            href={`https://explorer.solana.com/address/${meetingAccount}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-[var(--accent-light)] hover:text-[var(--accent)] active:scale-95 border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-all"
          >
            View committed result on Solana Explorer
            <ExternalLinkIcon />
          </a>
        )}
      </div>

      {/* TEE proof section */}
      <div className="p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl space-y-3 text-left">
        <div className="text-sm font-medium text-[var(--muted-strong)]">TEE Execution Proof</div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-start gap-2">
            <span className="text-[var(--muted)] shrink-0">TEE Validator</span>
            <span className="text-[var(--muted-strong)] font-mono truncate">
              {TEE_VALIDATOR.toBase58()}
            </span>
          </div>

          {txHash && (
            <div className="flex justify-between items-start gap-2">
              <span className="text-[var(--muted)] shrink-0">Compute TX</span>
              <span className="text-[var(--muted-strong)] font-mono truncate">{txHash}</span>
            </div>
          )}

          {meetingAccount && (
            <div className="flex justify-between items-start gap-2">
              <span className="text-[var(--muted)] shrink-0">Meeting PDA</span>
              <span className="text-[var(--muted-strong)] font-mono truncate">{meetingAccount}</span>
            </div>
          )}

          <div className="flex justify-between items-start gap-2">
            <span className="text-[var(--muted)] shrink-0">Participants</span>
            <span className="text-[var(--muted-strong)]">{participantCount}</span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--border)]">
          {teeVerified === null ? (
            <button
              onClick={handleVerifyTee}
              disabled={verifying}
              className="w-full py-2 text-sm text-[var(--accent-light)] hover:text-[var(--accent)] active:scale-95 border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-all disabled:opacity-50 disabled:active:scale-100"
            >
              {verifying ? "Verifying Intel TDX attestation..." : "Verify TEE Hardware Attestation"}
            </button>
          ) : teeVerified ? (
            <div className="flex items-center gap-2 text-sm text-[var(--success)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              TEE hardware verified (Intel TDX attestation valid)
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-[var(--warning)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              TEE attestation could not be verified
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
