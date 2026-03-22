import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { PROGRAM_ID, MEETING_SEED, SLOT_RECORD_SEED } from "./constants";

export function getMeetingPda(meetingId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MEETING_SEED, meetingId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

export function getSlotRecordPda(
  meetingId: BN,
  owner: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SLOT_RECORD_SEED,
      meetingId.toArrayLike(Buffer, "le", 8),
      owner.toBuffer(),
    ],
    PROGRAM_ID
  );
}
