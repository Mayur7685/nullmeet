"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";

export type MeetingStep =
  | "lobby"
  | "locking"
  | "delegating"
  | "select-slots"
  | "submitting"
  | "waiting"
  | "computing"
  | "result";

interface MeetingResult {
  day: number;
  slot: number;
  score: number;
  valid: boolean;
}

export interface Participant {
  address: string;
  ready: boolean;
}

export function useMeeting(meetingId: string, walletAddress: string | null) {
  const [step, setStep] = useState<MeetingStep>("lobby");
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [locked, setLocked] = useState(false);
  const [allReady, setAllReady] = useState(false);
  const [result, setResult] = useState<MeetingResult | null>(null);

  const roleRef = useRef<"host" | "participant" | null>(null);

  useEffect(() => {
    if (!walletAddress) return;

    const socket = getSocket();

    const onMeetingCreated = () => {
      setIsHost(true);
      roleRef.current = "host";
    };

    const onParticipantJoined = (data: {
      participantAddress: string;
      participants: Participant[];
      count: number;
      max: number;
    }) => {
      console.log("[useMeeting] participant_joined:", data.participantAddress, `(${data.count}/${data.max})`);
      setParticipants(data.participants);
    };

    const onMeetingLocked = (data: { participants: Participant[] }) => {
      console.log("[useMeeting] meeting_locked");
      setLocked(true);
      setParticipants(data.participants);
    };

    const onParticipantReady = (data: {
      address: string;
      participants: Participant[];
      readyCount: number;
      allReady: boolean;
    }) => {
      console.log("[useMeeting] participant_ready:", data.address, `(${data.readyCount}/${data.participants.length})`);
      setParticipants(data.participants);
      setAllReady(data.allReady);
    };

    const onAllSubmitted = () => {
      console.log("[useMeeting] all_submitted");
      setAllReady(true);
    };

    const onMeetingResult = (data: MeetingResult) => {
      setResult(data);
      setStep("result");
    };

    const onJoinError = (data: { message: string }) => {
      console.error("[useMeeting] join error:", data.message);
    };

    const onReconnect = () => {
      console.log("[useMeeting] socket reconnected, re-registering...");
      if (roleRef.current === "host") {
        socket.emit("create_meeting", {
          meetingId,
          hostAddress: walletAddress,
        });
      } else if (roleRef.current === "participant") {
        socket.emit("join_meeting", {
          meetingId,
          participantAddress: walletAddress,
        });
      }
    };

    socket.on("meeting_created", onMeetingCreated);
    socket.on("participant_joined", onParticipantJoined);
    socket.on("meeting_locked", onMeetingLocked);
    socket.on("participant_ready", onParticipantReady);
    socket.on("all_submitted", onAllSubmitted);
    socket.on("meeting_result", onMeetingResult);
    socket.on("join_error", onJoinError);
    socket.io.on("reconnect", onReconnect);

    return () => {
      socket.off("meeting_created", onMeetingCreated);
      socket.off("participant_joined", onParticipantJoined);
      socket.off("meeting_locked", onMeetingLocked);
      socket.off("participant_ready", onParticipantReady);
      socket.off("all_submitted", onAllSubmitted);
      socket.off("meeting_result", onMeetingResult);
      socket.off("join_error", onJoinError);
      socket.io.off("reconnect", onReconnect);
    };
  }, [walletAddress, meetingId]);

  const createMeeting = useCallback(
    (numDays: number, maxParticipants: number) => {
      if (!walletAddress) return;
      const socket = getSocket();
      socket.emit("create_meeting", {
        meetingId,
        hostAddress: walletAddress,
        numDays,
        maxParticipants,
      });
      setIsHost(true);
      roleRef.current = "host";
    },
    [meetingId, walletAddress]
  );

  const joinMeeting = useCallback(() => {
    if (!walletAddress) return;
    const socket = getSocket();
    socket.emit("join_meeting", {
      meetingId,
      participantAddress: walletAddress,
    });
    setIsHost(false);
    roleRef.current = "participant";
  }, [meetingId, walletAddress]);

  const lockMeeting = useCallback(() => {
    const socket = getSocket();
    socket.emit("lock_meeting", { meetingId });
  }, [meetingId]);

  const signalReady = useCallback(() => {
    const socket = getSocket();
    socket.emit("participant_ready", { meetingId });
  }, [meetingId]);

  const broadcastResult = useCallback(
    (day: number, slot: number, score: number, valid: boolean) => {
      const socket = getSocket();
      socket.emit("broadcast_result", { meetingId, day, slot, score, valid });
    },
    [meetingId]
  );

  return {
    step,
    setStep,
    isHost,
    participants,
    locked,
    allReady,
    result,
    createMeeting,
    joinMeeting,
    lockMeeting,
    signalReady,
    broadcastResult,
  };
}
