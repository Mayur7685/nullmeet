"use client";

import { useCallback, useMemo, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import { BN, Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import { PROGRAM_ID, TEE_RPC_URL, TEE_VALIDATOR, SLOTS_PER_DAY } from "@/lib/constants";
import { getMeetingPda, getSlotRecordPda } from "@/lib/pda";
import idl from "@/lib/nullmeet-v2.json";
import {
  getAuthToken,
  permissionPdaFromAccount,
  createDelegatePermissionInstruction,
  waitUntilPermissionActive,
  AUTHORITY_FLAG,
  TX_LOGS_FLAG,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const TEE_URL = TEE_RPC_URL;
const TEE_WS_URL = TEE_RPC_URL.replace("https://", "wss://");

interface Member {
  flags: number;
  pubkey: PublicKey;
}

export function useNullmeet() {
  const wallet = useWallet();
  const { publicKey, signTransaction, signAllTransactions, signMessage } =
    wallet;
  const { connection } = useConnection();

  const authTokenRef = useRef<{ token: string; expiresAt: number } | null>(
    null
  );
  const teeConnectionRef = useRef<Connection | null>(null);

  const program = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions },
      { commitment: "confirmed" }
    );

    return new Program(idl as Idl, provider);
  }, [publicKey, signTransaction, signAllTransactions, connection]);

  // Helper: confirm tx with retry polling (handles 30s timeout)
  const confirmWithRetry = useCallback(
    async (conn: Connection, txHash: string, maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await conn.getSignatureStatus(txHash);
          if (
            result?.value?.confirmationStatus === "confirmed" ||
            result?.value?.confirmationStatus === "finalized"
          ) {
            return txHash;
          }
          if (result?.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
          }
        } catch {
          // Status check failed, keep polling
        }
        // Wait 5s between retries
        await new Promise((r) => setTimeout(r, 5000));
      }
      // Final check
      const final = await conn.getSignatureStatus(txHash);
      if (
        final?.value?.confirmationStatus === "confirmed" ||
        final?.value?.confirmationStatus === "finalized"
      ) {
        return txHash;
      }
      throw new Error(
        `Transaction not confirmed after retries. It may still succeed. Signature: ${txHash}`
      );
    },
    []
  );

  // Helper: sign and send a transaction on devnet
  const signAndSend = useCallback(
    async (tx: Transaction) => {
      if (!publicKey || !signTransaction)
        throw new Error("Wallet not connected");

      tx.feePayer = publicKey;
      tx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;

      const signed = await signTransaction(tx);
      const txHash = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
      });
      try {
        await connection.confirmTransaction(txHash, "confirmed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("was not confirmed")) {
          // Timeout — poll for confirmation
          await confirmWithRetry(connection, txHash);
        } else {
          throw err;
        }
      }
      return txHash;
    },
    [publicKey, signTransaction, connection, confirmWithRetry]
  );

  // Helper: sign and send a transaction on TEE
  const signAndSendTee = useCallback(
    async (tx: Transaction) => {
      if (!publicKey || !signTransaction)
        throw new Error("Wallet not connected");
      const teeConn = teeConnectionRef.current;
      if (!teeConn) throw new Error("TEE connection not established");

      tx.feePayer = publicKey;
      tx.recentBlockhash = (
        await teeConn.getLatestBlockhash()
      ).blockhash;

      const signed = await signTransaction(tx);
      try {
        const txHash = await sendAndConfirmRawTransaction(
          teeConn,
          signed.serialize(),
          { skipPreflight: true, commitment: "confirmed" }
        );
        return txHash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // Extract signature from timeout error
        const sigMatch = msg.match(/Check signature (\w+)/);
        if (msg.includes("was not confirmed") && sigMatch) {
          return await confirmWithRetry(teeConn, sigMatch[1]);
        }
        throw err;
      }
    },
    [publicKey, signTransaction, confirmWithRetry]
  );

  // Host: create meeting + host slot permission + delegate host slot (1 tx)
  const createAndSetupHost = useCallback(
    async (meetingId: number, numDays: number, startDate: number, maxParticipants: number) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const meetingIdBn = new BN(meetingId);
      const [, ] = getMeetingPda(meetingIdBn);
      const [hostSlotPda] = getSlotRecordPda(meetingIdBn, publicKey);

      // Create meeting instruction
      const createMeetingIx = await program.methods
        .createMeeting(meetingIdBn, numDays, new BN(startDate), maxParticipants)
        .accounts({ host: publicKey })
        .instruction();

      // Host slot record permission (only host can see)
      const hostMembers: Member[] = [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: publicKey },
      ];

      const createHostSlotPermIx = await program.methods
        .createPermission(
          { slotRecord: { meetingId: meetingIdBn, owner: publicKey } },
          hostMembers
        )
        .accountsPartial({
          payer: publicKey,
          permissionedAccount: hostSlotPda,
          permission: permissionPdaFromAccount(hostSlotPda),
        })
        .instruction();

      // Delegate host slot record permission to TEE
      const delegateHostSlotPermIx = createDelegatePermissionInstruction({
        payer: publicKey,
        validator: TEE_VALIDATOR,
        permissionedAccount: [hostSlotPda, false],
        authority: [publicKey, true],
      });

      // Delegate host slot record PDA to TEE
      const delegateHostSlotIx = await program.methods
        .delegatePda({
          slotRecord: { meetingId: meetingIdBn, owner: publicKey },
        })
        .accounts({
          payer: publicKey,
          validator: TEE_VALIDATOR,
          pda: hostSlotPda,
        })
        .instruction();

      const tx = new Transaction().add(
        createMeetingIx,
        createHostSlotPermIx,
        delegateHostSlotPermIx,
        delegateHostSlotIx
      );

      const txHash = await signAndSend(tx);
      console.log("[TEE] Host create+setup tx:", txHash);

      await waitUntilPermissionActive(TEE_URL, hostSlotPda);
      console.log("[TEE] Host slot record permission active");

      return txHash;
    },
    [program, publicKey, signAndSend]
  );

  // Participant: join meeting + slot permission + delegate slot (1 tx)
  const joinAndSetupParticipant = useCallback(
    async (meetingId: number) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const meetingIdBn = new BN(meetingId);
      const [participantSlotPda] = getSlotRecordPda(meetingIdBn, publicKey);

      // Join meeting instruction
      const joinMeetingIx = await program.methods
        .joinMeeting(meetingIdBn)
        .accounts({ participant: publicKey })
        .instruction();

      // Participant slot record permission (only participant can see)
      const participantMembers: Member[] = [
        { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: publicKey },
      ];

      const createSlotPermIx = await program.methods
        .createPermission(
          { slotRecord: { meetingId: meetingIdBn, owner: publicKey } },
          participantMembers
        )
        .accountsPartial({
          payer: publicKey,
          permissionedAccount: participantSlotPda,
          permission: permissionPdaFromAccount(participantSlotPda),
        })
        .instruction();

      // Delegate slot record permission to TEE
      const delegateSlotPermIx = createDelegatePermissionInstruction({
        payer: publicKey,
        validator: TEE_VALIDATOR,
        permissionedAccount: [participantSlotPda, false],
        authority: [publicKey, true],
      });

      // Delegate slot record PDA to TEE
      const delegateSlotIx = await program.methods
        .delegatePda({
          slotRecord: { meetingId: meetingIdBn, owner: publicKey },
        })
        .accounts({
          payer: publicKey,
          validator: TEE_VALIDATOR,
          pda: participantSlotPda,
        })
        .instruction();

      const tx = new Transaction().add(
        joinMeetingIx,
        createSlotPermIx,
        delegateSlotPermIx,
        delegateSlotIx
      );

      const txHash = await signAndSend(tx);
      console.log("[TEE] Participant join+setup tx:", txHash);

      await waitUntilPermissionActive(TEE_URL, participantSlotPda);
      console.log("[TEE] Participant slot record permission active");

      return txHash;
    },
    [program, publicKey, signAndSend]
  );

  // Host: lock meeting + create meeting permission for ALL participants + delegate meeting PDA
  const lockAndSetupMeetingPermission = useCallback(
    async (meetingId: number, participantAddresses: string[]) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const meetingIdBn = new BN(meetingId);
      const [meetingPda] = getMeetingPda(meetingIdBn);

      // Lock meeting instruction
      const lockMeetingIx = await program.methods
        .lockMeeting(meetingIdBn)
        .accounts({ host: publicKey })
        .instruction();

      // Meeting permission: ALL participants (including host)
      const meetingMembers: Member[] = participantAddresses.map((addr) => ({
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
        pubkey: new PublicKey(addr),
      }));

      const createMeetingPermIx = await program.methods
        .createPermission(
          { meeting: { meetingId: meetingIdBn } },
          meetingMembers
        )
        .accountsPartial({
          payer: publicKey,
          permissionedAccount: meetingPda,
          permission: permissionPdaFromAccount(meetingPda),
        })
        .instruction();

      // Delegate meeting permission to TEE
      const delegateMeetingPermIx = createDelegatePermissionInstruction({
        payer: publicKey,
        validator: TEE_VALIDATOR,
        permissionedAccount: [meetingPda, false],
        authority: [publicKey, true],
      });

      // Delegate meeting PDA to TEE
      const delegateMeetingPdaIx = await program.methods
        .delegatePda({ meeting: { meetingId: meetingIdBn } })
        .accounts({
          payer: publicKey,
          validator: TEE_VALIDATOR,
          pda: meetingPda,
        })
        .instruction();

      const tx = new Transaction().add(
        lockMeetingIx,
        createMeetingPermIx,
        delegateMeetingPermIx,
        delegateMeetingPdaIx
      );

      const txHash = await signAndSend(tx);
      console.log("[TEE] Lock + meeting permission tx:", txHash);

      await waitUntilPermissionActive(TEE_URL, meetingPda);
      console.log("[TEE] Meeting permission active on TEE");

      return txHash;
    },
    [program, publicKey, signAndSend]
  );

  // Authenticate with TEE (signMessage popup)
  const authenticateTee = useCallback(async () => {
    if (!publicKey || !signMessage)
      throw new Error("Wallet not connected or signMessage not available");

    const authToken = await getAuthToken(TEE_URL, publicKey, signMessage);
    authTokenRef.current = authToken;

    teeConnectionRef.current = new Connection(
      `${TEE_URL}?token=${authToken.token}`,
      {
        wsEndpoint: `${TEE_WS_URL}?token=${authToken.token}`,
        commitment: "confirmed",
      }
    );

    console.log("[TEE] Authenticated, token expires:", authToken.expiresAt);
    return authToken;
  }, [publicKey, signMessage]);

  // Submit slots via TEE RPC (multi-day: numDays * 8 slots)
  const submitSlotsTee = useCallback(
    async (meetingId: number, slots: number[]) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");

      const meetingIdBn = new BN(meetingId);
      const slotsBuffer = Buffer.from(slots);

      const submitIx = await program.methods
        .submitSlots(meetingIdBn, slotsBuffer)
        .accounts({ player: publicKey })
        .instruction();

      const tx = new Transaction().add(submitIx);
      const txHash = await signAndSendTee(tx);

      console.log("[TEE] submit_slots tx:", txHash);
      return txHash;
    },
    [program, publicKey, signAndSendTee]
  );

  // Compute result via TEE RPC (host only)
  // Passes all participant SlotRecords + their permissions via remaining_accounts
  const computeResultTee = useCallback(
    async (meetingId: number) => {
      if (!program || !publicKey) throw new Error("Wallet not connected");
      const teeConn = teeConnectionRef.current;
      if (!teeConn) throw new Error("TEE connection not established");

      const meetingIdBn = new BN(meetingId);
      const [meetingPda] = getMeetingPda(meetingIdBn);

      // Fetch meeting account from TEE to get all participant addresses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meetingAccount: any = await (program.account as any)[
        "meeting"
      ].fetch(meetingPda, "confirmed", teeConn);

      const participantCount = meetingAccount.participantCount as number;
      const participantPubkeys: PublicKey[] = [];
      for (let i = 0; i < participantCount; i++) {
        participantPubkeys.push(meetingAccount.participants[i] as PublicKey);
      }

      // Build remaining_accounts: [SlotRecords..., Permissions...]
      const remainingAccounts = [];

      // First N: SlotRecord accounts
      for (const pk of participantPubkeys) {
        const [slotPda] = getSlotRecordPda(meetingIdBn, pk);
        remainingAccounts.push({
          pubkey: slotPda,
          isSigner: false,
          isWritable: false,
        });
      }

      // Next N: Permission accounts for each SlotRecord
      for (const pk of participantPubkeys) {
        const [slotPda] = getSlotRecordPda(meetingIdBn, pk);
        remainingAccounts.push({
          pubkey: permissionPdaFromAccount(slotPda),
          isSigner: false,
          isWritable: true,
        });
      }

      const computeIx = await program.methods
        .computeResult(meetingIdBn)
        .accountsPartial({
          meeting: meetingPda,
          permissionMeeting: permissionPdaFromAccount(meetingPda),
          payer: publicKey,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      const tx = new Transaction().add(computeIx);
      const txHash = await signAndSendTee(tx);

      console.log("[TEE] compute_result tx:", txHash);

      // Read result from TEE
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await (program.account as any)["meeting"].fetch(
        meetingPda,
        "confirmed",
        teeConn
      );

      return {
        day: result.resultDay as number,
        slot: result.resultSlot as number,
        score: result.resultScore as number,
        valid: result.validOverlap as boolean,
        txHash,
        meetingAccount: meetingPda.toBase58(),
      };
    },
    [program, publicKey, signAndSendTee]
  );

  // Fetch meeting account from devnet
  const fetchMeetingAccount = useCallback(
    async (meetingId: number) => {
      if (!program) return null;

      const meetingIdBn = new BN(meetingId);
      const [meetingPda] = getMeetingPda(meetingIdBn);

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const account: any = await (program.account as any)["meeting"].fetch(
          meetingPda
        );
        const participantCount = account.participantCount as number;
        const participants: string[] = [];
        for (let i = 0; i < participantCount; i++) {
          participants.push((account.participants[i] as PublicKey).toBase58());
        }
        return {
          meetingId: (account.meetingId as BN).toNumber(),
          host: (account.host as PublicKey).toBase58(),
          participants,
          participantCount,
          numDays: account.numDays as number,
          startDate: (account.startDate as BN).toNumber(),
          maxParticipants: account.maxParticipants as number,
          resultDay: account.resultDay ?? null,
          resultSlot: account.resultSlot ?? null,
          resultScore: account.resultScore ?? null,
          validOverlap: account.validOverlap as boolean,
          resolved: account.resolved as boolean,
        };
      } catch {
        return null;
      }
    },
    [program]
  );

  return {
    createAndSetupHost,
    joinAndSetupParticipant,
    lockAndSetupMeetingPermission,
    authenticateTee,
    submitSlotsTee,
    computeResultTee,
    fetchMeetingAccount,
  };
}
