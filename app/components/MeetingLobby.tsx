"use client";

import { QRCodeSVG } from "qrcode.react";
import { Participant } from "@/hooks/useMeeting";
import { ParticipantList } from "./ParticipantList";

interface MeetingLobbyProps {
  meetingId: string;
  isHost: boolean;
  participants: Participant[];
  maxParticipants: number;
  numDays: number;
  hostAddress?: string;
  currentAddress?: string;
  locked: boolean;
  onLock: () => void;
}

export function MeetingLobby({
  meetingId,
  isHost,
  participants,
  maxParticipants,
  numDays,
  hostAddress,
  currentAddress,
  locked,
  onLock,
}: MeetingLobbyProps) {
  const joinUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/meet/${meetingId}?join=1&days=${numDays}&max=${maxParticipants}`
      : "";

  const copyLink = () => {
    navigator.clipboard.writeText(joinUrl);
  };

  if (!isHost) {
    return (
      <div className="text-center space-y-4">
        <div className="text-2xl font-bold">Joining Meeting</div>
        <div className="text-[var(--muted)]">Meeting ID: {meetingId}</div>
        <div className="text-sm text-[var(--muted)]">
          {numDays} day{numDays > 1 ? "s" : ""} · {participants.length}/{maxParticipants} participants
        </div>
        {locked ? (
          <div className="text-[var(--success)] font-medium">
            Meeting locked! Waiting for TEE setup...
          </div>
        ) : (
          <div className="text-[var(--success)]">Connected! Waiting for host to start...</div>
        )}
        <ParticipantList
          participants={participants}
          maxParticipants={maxParticipants}
          hostAddress={hostAddress}
          currentAddress={currentAddress}
        />
      </div>
    );
  }

  return (
    <div className="text-center space-y-6">
      <div className="text-2xl font-bold">Share this meeting</div>
      <div className="text-[var(--muted)]">Meeting ID: {meetingId}</div>
      <div className="text-sm text-[var(--muted)]">
        {numDays} day{numDays > 1 ? "s" : ""} · Up to {maxParticipants} participants
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white rounded-xl">
          <QRCodeSVG value={joinUrl} size={200} />
        </div>
      </div>

      <div className="flex items-center gap-2 max-w-md mx-auto">
        <input
          readOnly
          value={joinUrl}
          className="flex-1 px-3 py-2 bg-[var(--card)] border border-[var(--border)] rounded-lg text-sm text-[var(--muted-strong)] truncate"
        />
        <button
          onClick={copyLink}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] rounded-lg text-white text-sm transition-colors"
        >
          Copy
        </button>
      </div>

      <ParticipantList
        participants={participants}
        maxParticipants={maxParticipants}
        hostAddress={hostAddress}
        currentAddress={currentAddress}
      />

      {/* Lock meeting button — only host, only when 2+ participants */}
      {isHost && !locked && (
        <button
          onClick={onLock}
          disabled={participants.length < 2}
          className="w-full px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] disabled:opacity-40 rounded-lg text-white font-medium transition-colors"
        >
          {participants.length < 2
            ? "Waiting for participants to join..."
            : `Lock Meeting & Start (${participants.length} participants)`}
        </button>
      )}
    </div>
  );
}
