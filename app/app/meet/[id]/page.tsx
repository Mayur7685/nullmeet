"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MeetingLobby } from "@/components/MeetingLobby";
import { MultiDaySlotSelector } from "@/components/MultiDaySlotSelector";
import { MeetingResult } from "@/components/MeetingResult";
import { ParticipantList } from "@/components/ParticipantList";
import { useMeeting } from "@/hooks/useMeeting";
import { useNullmeet } from "@/hooks/useNullmeet";

export default function MeetingPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const meetingId = params.id as string;
  const isJoining = searchParams.get("join") === "1";

  const { publicKey, connected } = useWallet();
  const walletAddress = publicKey?.toBase58() || null;

  // Meeting config (set by host on creation page, passed via URL params or defaults)
  const numDaysParam = parseInt(searchParams.get("days") || "3", 10);
  const maxParticipantsParam = parseInt(searchParams.get("max") || "5", 10);

  const [numDays] = useState(numDaysParam);
  const [maxParticipants] = useState(maxParticipantsParam);
  const [startDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return Math.floor(tomorrow.getTime() / 1000);
  });

  const {
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
  } = useMeeting(meetingId, walletAddress);

  const {
    createAndSetupHost,
    joinAndSetupParticipant,
    lockAndSetupMeetingPermission,
    authenticateTee,
    submitSlotsTee,
    computeResultTee,
  } = useNullmeet();

  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [computeTxHash, setComputeTxHash] = useState<string | null>(null);
  const [meetingAccount, setMeetingAccount] = useState<string | null>(null);
  const initRef = useRef(false);
  const lockingRef = useRef(false);
  const submittingRef = useRef(false);
  const computingRef = useRef(false);

  const isUserRejection = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes("User rejected") ||
      msg.includes("user rejected") ||
      msg.includes("User denied") ||
      msg.includes("cancelled") ||
      msg.includes("canceled")
    );
  };

  const handleError = (err: unknown, retry: () => void) => {
    console.error("Transaction error:", err);
    const msg = err instanceof Error ? err.message : "Transaction failed";
    if (isUserRejection(err)) {
      setErrorMsg("Transaction cancelled. Please try again.");
    } else {
      setErrorMsg(msg);
    }
    setRetryAction(() => retry);
  };

  const clearError = () => {
    setErrorMsg(null);
    setRetryAction(null);
  };

  // HOST: Create meeting + setup TEE (1 popup)
  // PARTICIPANT: Join meeting + setup TEE (1 popup)
  useEffect(() => {
    if (!connected || !walletAddress) return;
    if (initRef.current) return;

    const init = async () => {
      initRef.current = true;
      clearError();
      try {
        if (isJoining) {
          setStatus("Joining meeting & setting up TEE...");
          await joinAndSetupParticipant(Number(meetingId));
          joinMeeting();

          setStatus("Authenticating with TEE enclave...");
          await authenticateTee();

          setStatus("");
        } else {
          setStatus("Creating meeting & setting up TEE...");
          await createAndSetupHost(
            Number(meetingId),
            numDays,
            startDate,
            maxParticipants
          );
          createMeeting(numDays, maxParticipants);

          setStatus("Authenticating with TEE enclave...");
          await authenticateTee();

          setStatus("");
        }
      } catch (err) {
        setStatus("");
        initRef.current = false;
        handleError(err, () => init());
      }
    };

    init();
  }, [connected, walletAddress]);

  // HOST: Lock meeting + set up meeting permission + delegate meeting PDA
  const handleLockMeeting = async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    clearError();
    try {
      setStep("locking");
      setStatus("Locking meeting & setting up TEE permission...");

      const participantAddresses = participants.map((p) => p.address);
      await lockAndSetupMeetingPermission(
        Number(meetingId),
        participantAddresses
      );
      lockMeeting();

      setStatus("");
      setStep("select-slots");
    } catch (err) {
      setStatus("");
      setStep("lobby");
      lockingRef.current = false;
      handleError(err, handleLockMeeting);
    }
  };

  // When meeting is locked (non-host participants), move to slot selection
  useEffect(() => {
    if (!isHost && locked && step === "lobby") {
      setStep("select-slots");
    }
  }, [isHost, locked, step, setStep]);

  const handleSubmitSlots = async (slots: number[]) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearError();
    try {
      setStep("submitting");
      setStatus("Submitting slots to TEE enclave...");

      await submitSlotsTee(Number(meetingId), slots);
      signalReady();

      if (isHost) {
        setStep("waiting");
        setStatus("");
      } else {
        setStep("waiting");
        setStatus("Waiting for host to calculate result...");
      }
    } catch (err) {
      setStatus("");
      setStep("select-slots");
      submittingRef.current = false;
      handleError(err, () => handleSubmitSlots(slots));
    }
  };

  const handleComputeResult = async () => {
    if (computingRef.current) return;
    computingRef.current = true;
    clearError();
    try {
      setStep("computing");
      setStatus("Computing result inside TEE enclave...");

      const res = await computeResultTee(Number(meetingId));

      setComputeTxHash(res.txHash);
      setMeetingAccount(res.meetingAccount);
      broadcastResult(res.day, res.slot, res.score, res.valid);
      setStep("result");
    } catch (err) {
      setStatus("");
      setStep("waiting");
      computingRef.current = false;
      handleError(err, handleComputeResult);
    }
  };

  if (!connected) {
    return (
      <main className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="text-center space-y-6">
          <h1 className="text-3xl font-bold">
            Null<span className="text-[var(--accent)]">meet</span>
            <span className="text-sm text-[var(--muted)] ml-2">v2</span>
          </h1>
          <p className="text-[var(--muted)]">Connect your wallet to continue</p>
          <WalletMultiButton />
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            Null<span className="text-[var(--accent)]">meet</span>
            <span className="text-sm text-[var(--muted)] ml-1">v2</span>
          </h1>
          <WalletMultiButton />
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-sm">
          {["Lobby", "Lock", "TEE", "Select", "Submit", "Wait", "Result"].map(
            (label, i) => {
              const steps: string[] = [
                "lobby",
                "locking",
                "delegating",
                "select-slots",
                "submitting",
                "waiting",
                "result",
              ];
              const currentIdx = steps.indexOf(step);
              const isActive = i <= currentIdx;
              return (
                <div
                  key={label}
                  className={`flex-1 h-1 rounded-full transition-colors ${
                    isActive ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                  }`}
                />
              );
            }
          )}
        </div>

        {/* Error banner with retry */}
        {errorMsg && (
          <div className="bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-lg p-4 text-center space-y-3">
            <p className="text-[var(--error)] text-sm">{errorMsg}</p>
            {retryAction && (
              <button
                onClick={() => {
                  clearError();
                  retryAction();
                }}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-light)] active:scale-95 text-white text-sm font-medium rounded-lg transition-all cursor-pointer"
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {/* Content based on step */}
        {step === "lobby" && (
          <>
            {status && (
              <div className="text-center text-[var(--muted)] py-4">
                <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto mb-2" />
                {status}
              </div>
            )}
            <MeetingLobby
              meetingId={meetingId}
              isHost={isHost}
              participants={participants}
              maxParticipants={maxParticipants}
              numDays={numDays}
              hostAddress={isHost ? walletAddress || undefined : participants[0]?.address}
              currentAddress={walletAddress || undefined}
              locked={locked}
              onLock={handleLockMeeting}
            />
          </>
        )}

        {step === "locking" && (
          <div className="text-center space-y-4 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
            <div className="text-lg font-medium text-[var(--accent-light)]">
              Locking Meeting
            </div>
            <div className="text-[var(--muted)] text-sm">{status}</div>
          </div>
        )}

        {step === "delegating" && (
          <div className="text-center space-y-4 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
            <div className="text-lg font-medium text-[var(--accent-light)]">
              Setting up Private Enclave
            </div>
            <div className="text-[var(--muted)] text-sm">{status}</div>
          </div>
        )}

        {step === "select-slots" && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-center">
              Select Your Availability
            </h2>
            <p className="text-sm text-[var(--muted)] text-center">
              {numDays} day{numDays > 1 ? "s" : ""} · {participants.length} participants · Encrypted in TEE
            </p>
            <MultiDaySlotSelector
              numDays={numDays}
              startDate={startDate}
              onSubmit={handleSubmitSlots}
            />
          </div>
        )}

        {step === "submitting" && (
          <div className="text-center space-y-4 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
            <div className="text-[var(--muted)]">{status}</div>
          </div>
        )}

        {step === "waiting" && isHost && (
          <div className="text-center space-y-6 py-8">
            <ParticipantList
              participants={participants}
              maxParticipants={maxParticipants}
              hostAddress={walletAddress || undefined}
              currentAddress={walletAddress || undefined}
            />
            {!allReady ? (
              <>
                <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
                <div className="text-[var(--warning)]">
                  Your slots are submitted. Waiting for all participants...
                </div>
                <div className="text-sm text-[var(--muted)]">
                  {participants.filter((p) => p.ready).length}/{participants.length} submitted
                </div>
              </>
            ) : (
              <>
                <div className="text-[var(--success)] text-lg font-medium">
                  All {participants.length} participants have submitted!
                </div>
                <p className="text-[var(--muted)] text-sm">
                  Click below to compute the best meeting time inside the TEE enclave.
                </p>
                <button
                  onClick={handleComputeResult}
                  className="px-6 py-3 bg-[var(--accent)] hover:bg-[var(--accent-light)] active:scale-95 text-white font-semibold rounded-lg transition-all"
                >
                  Calculate Best Time
                </button>
              </>
            )}
          </div>
        )}

        {step === "waiting" && !isHost && (
          <div className="text-center space-y-4 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
            <div className="text-[var(--muted)]">
              Waiting for host to calculate result...
            </div>
            <ParticipantList
              participants={participants}
              maxParticipants={maxParticipants}
              currentAddress={walletAddress || undefined}
            />
          </div>
        )}

        {step === "computing" && (
          <div className="text-center space-y-4 py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full mx-auto" />
            <div className="text-[var(--muted)]">{status}</div>
          </div>
        )}

        {step === "result" && result && (
          <MeetingResult
            resultDay={result.day}
            resultSlot={result.slot}
            resultScore={result.score}
            validOverlap={result.valid}
            startDate={startDate}
            participantCount={participants.length}
            txHash={computeTxHash}
            meetingAccount={meetingAccount}
          />
        )}
      </div>
    </main>
  );
}
