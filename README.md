# Nullmeet - Private Multi-Party Meeting Scheduler on Solana

> Find a common meeting time across multiple people and multiple days. **No one sees anyone else's availability.** Only the best overlapping slot is revealed.


## The Problem

Scheduling a group meeting requires everyone to share their availability. Current solutions force a painful tradeoff:

**Option 1: Share your full calendar.** Tools like Google Calendar and When2meet require every participant to expose their entire schedule — doctor visits, personal routines, job interviews, lunch plans — to everyone in the group. The more people involved, the worse the privacy leak.

**Option 2: Trial and error.** "Are you free at 3?" "No." "How about 4?" "Still no." With 5 people across 3 days, this back-and-forth becomes exponentially painful — and still leaks partial schedule information.

**The core tension:** finding an overlapping slot requires comparing everyone's availability, but comparing availability means revealing it.

--- 

## The Solution

Nullmeet eliminates this tradeoff using MagicBlock's Private Ephemeral Rollups.

Each participant submits their availability preferences into a **Trusted Execution Environment (TEE)** running on Solana. The TEE computes the optimal meeting slot using a min+argmax algorithm — without revealing any individual's full schedule. The result, and only the result, is committed on-chain.

**What's private:** Each participant's full availability grid (which slots they rated 0–4)
**What's public:** The single best slot (day + time), the minimum compatibility score, and whether a valid overlap exists

No participant sees anyone else's schedule. No server operator sees the data. The privacy guarantee is enforced by Intel TDX hardware attestation — and it's verifiable directly from the frontend.

--- 

## How It Works

![How it works](https://raw.githubusercontent.com/Mayur7685/nullmeet/master/app/public/how-it-works.png)

### Step-by-Step Flow

| Step | Who | What Happens | Where |
|------|-----|-------------|-------|
| 1 | Host | Creates meeting, initializes their SlotRecord, sets up TEE permissions, delegates to TEE | Solana devnet (1 TX) |
| 2 | Participants | Join meeting, create their SlotRecord, set up TEE permissions, delegate to TEE | Solana devnet (1 TX each) |
| 3 | Host | Locks meeting (no more joins), creates meeting-wide permission, delegates Meeting PDA to TEE | Solana devnet (1 TX) |
| 4 | All | Authenticate with TEE enclave via wallet message signature | TEE RPC |
| 5 | All | Submit availability preferences (0–4 per slot) into their private SlotRecord | TEE enclave |
| 6 | Host | Triggers `compute_result` — TEE reads all SlotRecords, runs min+argmax, writes result | TEE enclave |
| 7 | Auto | Meeting PDA with result is committed back to Solana. Permissions cleared. Only result is public | Solana devnet |

**Total wallet popups:** Host = 4, Each participant = 2

--- 

## The Algorithm: Why Min + Argmax

This is the core design decision in v2. The fundamental question is: **"When can everyone actually meet?"**

### Why Not Multiply?

With binary preferences (v1), multiplying works fine for 2 people. But with multi-level preferences and N participants, multiplication breaks:

```
3 participants rate a slot:
Alice: 4, Bob: 4, Carol: 0 → Product = 0
Alice: 1, Bob: 1, Carol: 1 → Product = 1
```

A slot where two people are maximally available but one can't make it (0) scores **zero**. A slot where everyone barely can attend scores **1**. The "everyone is miserable" slot wins.

It gets worse at scale:

```
10 participants all rating 4: 4^10 = 1,048,576
10 participants all rating 3: 3^10 = 59,049
```

A 17x difference for a 1-point preference change. One person downgrading from 4 to 3 swings the score by 262,144. Multiplication creates exponential distortion that destroys ranking quality.

### Min + Argmax: The Maximin Criterion

For each slot, take the **minimum** preference across all participants. Then pick the slot with the **highest** minimum:

![Min Max NullMeet](https://raw.githubusercontent.com/Mayur7685/nullmeet/master/app/public/min-max-nullmeet.png)

The on-chain implementation:

```rust
let mut best_idx = 0usize;
let mut best_score = 0u8;

for slot_idx in 0..total_slots {
    let min_score = all_slots
        .iter()
        .map(|slots| slots[slot_idx])
        .min()
        .unwrap_or(0);

    if min_score > best_score {
        best_score = min_score;
        best_idx = slot_idx;
    }
}

meeting.result_day = Some((best_idx / SLOTS_PER_DAY) as u8);
meeting.result_slot = Some((best_idx % SLOTS_PER_DAY) as u8);
meeting.result_score = Some(best_score);
meeting.valid_overlap = best_score > 0;
```

| Property | Multiplication | Min + Argmax |
|---|---|---|
| **Veto** | 0 × anything = 0 | min(0, anything) = 0 |
| **Fairness** | One high rater inflates scores | Bounded by least-available person |
| **Scale** | Products grow exponentially with N | Always [0, 4] regardless of N |
| **Meaning** | "Total enthusiasm" | "Guaranteed minimum availability" |
| **Overflow** | 4^10 = 1M (needs u32+) | Always fits in u8 |

This is the **maximin criterion** from game theory — maximize the worst-case outcome. For scheduling: **pick the time where even the busiest person is the most free.**

### Multi-Day Extension

All days are flattened into a single array. A 3-day meeting with 8 slots/day = 24 slots total. The algorithm runs over all 24, and the result is split back:

```
result_day  = best_idx / 8  → which day
result_slot = best_idx % 8  → which time slot
```

No separate per-day computation needed.

--- 

## Privacy Model

### What Stays Private

Each participant's full availability grid — which slots they rated 0, 1, 2, 3, or 4. This data exists only inside the TEE enclave during computation. It is never written to the blockchain, never sent to any server, and never visible to other participants.

### What Becomes Public

The single best time slot (day index + slot index), the minimum compatibility score, the participant count, and whether a valid overlap exists. This is committed to Solana as an immutable on-chain record.

### How Privacy Is Enforced

1. **SlotRecord isolation:** Each participant's SlotRecord PDA is delegated to the TEE with a permission that only allows the account owner to write to it. No other participant or external party can read it.

2. **TEE computation:** The `compute_result` instruction runs inside the TEE enclave. It reads all SlotRecords (which are co-located in the TEE), computes the min+argmax, and writes only the result to the Meeting PDA.

3. **Permission clearing:** After computation, all permissions are cleared — the Meeting PDA becomes publicly readable (showing only the result), while SlotRecords are no longer accessible.

4. **Hardware attestation:** The TEE runs on Intel TDX hardware. The frontend includes a "Verify TEE Hardware Attestation" button that validates the Intel TDX quote via the MagicBlock SDK, proving the computation genuinely ran inside an isolated enclave.

### Trust Assumptions

- **Intel TDX hardware** is not compromised (standard TEE assumption)
- **MagicBlock's TEE infrastructure** is available (liveness, not safety — if it goes down, meetings can't be computed, but no data is leaked)
- **Solana devnet** finalizes transactions correctly

--- 

## On-Chain Program

**Program ID:** `ED2AyG4cew1sxP4RYiFm4xWvamY4VTJJ8yPSphfnVp2N`

### Instructions

| Instruction | Signer | Description |
|---|---|---|
| `create_meeting` | Host | Creates Meeting PDA + host's SlotRecord PDA. Args: meeting_id, num_days (1–7), start_date, max_participants (2–10) |
| `join_meeting` | Participant | Joins meeting, creates participant's SlotRecord PDA. Validates: meeting is Open, not full, not already joined |
| `lock_meeting` | Host | Sets status to Locked. Requires 2+ participants. No more joins allowed |
| `create_permission` | Any | CPI to MagicBlock Permission Program. Creates access control for a Meeting or SlotRecord PDA |
| `delegate_pda` | Any | CPI to MagicBlock Delegation Program. Delegates a PDA to the TEE validator |
| `submit_slots` | Participant | Writes preference array into SlotRecord inside TEE. Validates: exactly `num_days * 8` slots, all values 0–4 |
| `compute_result` | Host | Reads all SlotRecords via `remaining_accounts`, runs min+argmax, writes result to Meeting PDA. Marked `#[commit]` — commits result back to base layer. Clears all permissions |

### Accounts

#### Meeting PDA

Seeds: `["meeting", meeting_id.to_le_bytes()]`

| Field | Type | Description |
|---|---|---|
| meeting_id | u64 | Unique meeting identifier |
| host | Pubkey | Host's wallet address |
| num_days | u8 | Number of scheduling days (1–7) |
| start_date | i64 | Unix timestamp of first scheduling day |
| max_participants | u8 | Maximum allowed participants (2–10) |
| participant_count | u8 | Current number of participants |
| participants | [Pubkey; 10] | Array of participant wallet addresses |
| submitted_count | u8 | How many have submitted slots |
| result_day | Option\<u8\> | Winning day index |
| result_slot | Option\<u8\> | Winning time slot index |
| result_score | Option\<u8\> | Minimum preference score at winning slot |
| valid_overlap | bool | Whether a valid overlap was found (score > 0) |
| resolved | bool | Whether computation is complete |
| status | MeetingStatus | Open / Locked / Computing / Resolved |

#### SlotRecord PDA

Seeds: `["slot_record", meeting_id.to_le_bytes(), owner.to_bytes()]`

| Field | Type | Description |
|---|---|---|
| meeting_id | u64 | Associated meeting ID |
| owner | Pubkey | Participant's wallet address |
| num_days | u8 | Number of scheduling days |
| slots | [u8; 56] | Preference scores (max 7 days x 8 slots) |
| submitted | bool | Whether this participant has submitted |

### Related Programs

| Program | Address | Role |
|---|---|---|
| MagicBlock Delegation | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` | Delegates PDAs to TEE validator |
| MagicBlock Permission | `ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1` | Access control for delegated accounts |

--- 

## Architecture

```
nullmeet/
├── programs/nullmeet-v2/        Anchor program (Solana on-chain)
│   └── src/lib.rs               Meeting state, slot submission, min+argmax compute
│
├── app/                         Next.js 15 frontend
│   ├── app/
│   │   ├── layout.tsx           Root layout, wallet provider, theme system
│   │   ├── page.tsx             Home — configure days/participants, start meeting
│   │   └── meet/[id]/page.tsx   Meeting page — lobby, slot selection, result
│   ├── components/
│   │   ├── WalletProvider.tsx    Solana wallet adapter setup (Phantom, devnet)
│   │   ├── MeetingLobby.tsx     QR code, invite link, participant list, lock button
│   │   ├── MultiDaySlotSelector.tsx  Multi-day grid with 5-level preference cycling
│   │   ├── ParticipantList.tsx  Live participant status (joined/submitted)
│   │   ├── MeetingResult.tsx    Result display, Google Calendar, on-chain proof, TEE verification
│   │   ├── ThemeToggle.tsx      Dark/light theme toggle
│   │   └── NullmeetLogo.tsx     ASCII-style logo component
│   ├── hooks/
│   │   ├── useNullmeet.ts       All Solana + TEE transaction logic
│   │   ├── useMeeting.ts        WebSocket state management (Socket.IO)
│   │   └── useTheme.ts          Theme persistence (localStorage)
│   └── lib/
│       ├── constants.ts         Program ID, TEE RPC, validator pubkey, slot labels
│       ├── pda.ts               PDA derivation helpers
│       ├── socket.ts            Singleton Socket.IO client
│       └── nullmeet-v2.json     Anchor IDL
│
├── server/                      WebSocket signaling server
│   └── server.js                Socket.IO server (meeting rooms, participant sync)
│
└── Anchor.toml                  Anchor config (devnet deployment)
```

### Frontend Features

- **Multi-day slot selector** — Tab-based day view with 8 hourly slots (9 AM–5 PM). Tap to cycle through 5 preference levels (0–4) with color-coded feedback. Multi-day overview heatmap shows all days at a glance.
- **Real-time participant sync** — WebSocket-powered live updates. See participants join, submit, and get results in real time across all connected browsers.
- **QR code sharing** — Instant meeting invites via scannable QR code or copyable link.
- **Google Calendar integration** — One-click "Add to Google Calendar" with pre-filled event details and on-chain proof link.
- **TEE attestation verification** — In-browser Intel TDX hardware attestation check via MagicBlock SDK.
- **Dark/light theme** — System-preference-aware theme toggle with localStorage persistence.
- **On-chain proof** — Direct link to Solana Explorer showing the committed result.

### WebSocket Server

Lightweight Socket.IO signaling server for real-time meeting coordination. Manages meeting rooms, participant state, and event broadcasting. Does **not** handle any availability data — that flows exclusively through the TEE.

| Client Event | Server Response | Description |
|---|---|---|
| `create_meeting` | `meeting_created` | Host creates a meeting room |
| `join_meeting` | `participant_joined` (broadcast) | Participant joins, all notified |
| `lock_meeting` | `meeting_locked` (broadcast) | Host locks, all transition to slot selection |
| `participant_ready` | `participant_ready` / `all_submitted` (broadcast) | Slot submission confirmed |
| `broadcast_result` | `meeting_result` (broadcast) | Host shares computed result with all |

## MagicBlock Private Ephemeral Rollups

Nullmeet v2 is built on MagicBlock's **Private Ephemeral Rollups (PER)** — a privacy layer for Solana that uses Trusted Execution Environments (Intel TDX) to run confidential computations on delegated accounts.

### How We Use PER

1. **Account Delegation:** Meeting and SlotRecord PDAs are delegated from Solana devnet to MagicBlock's TEE validator (`FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA`). This moves the accounts into the TEE enclave where they can be read and written privately.

2. **Permission Program:** Each delegated account gets an associated permission via the MagicBlock Permission Program (`ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1`). Permissions specify which wallets can access each account inside the TEE — ensuring SlotRecords are only readable by their owners.

3. **TEE Authentication:** Participants authenticate with the TEE RPC (`https://tee.magicblock.app`) by signing a message with their wallet. This creates a session token that authorizes their transactions inside the enclave.

4. **Private Computation:** `submit_slots` and `compute_result` instructions execute inside the TEE. The TEE can read all SlotRecords (it's the enclave operator), but no external party — including MagicBlock — can inspect the enclave's memory thanks to Intel TDX isolation.

5. **Commit to Base Layer:** The `compute_result` instruction is marked with `#[commit]`, which tells MagicBlock's PER to commit the resulting Meeting PDA state back to Solana devnet. The committed state includes only the result — not the individual preferences.

6. **Permission Clearing:** After computation, all permissions are set to `None` (public), making the result readable on-chain while ensuring the private SlotRecord data is no longer accessible.

### Key MagicBlock SDKs Used

- `@magicblock-labs/ephemeral-rollups-sdk` — TEE authentication (`getAuthToken`), delegation helpers, permission management, attestation verification
- `bolt-sdk` — `FindComponentPda` for permission PDA derivation
- Delegation Program CPI — `DelegateAccount` for PDA delegation
- Permission Program CPI — `CreatePermissionCpiBuilder`, `UpdatePermissionCpiBuilder` for access control

## v1 vs v2

| | Nullmeet v1 | Nullmeet v2 |
|---|---|---|
| **Participants** | 2 (host + guest) | 2–10 (configurable) |
| **Days** | 1 day (8 slots) | 1–7 days (8 slots/day = up to 56 slots) |
| **Preference** | Binary (0 or 1) | 5-level (0–4) |
| **Algorithm** | Pairwise multiplication | Min-aggregation + argmax (maximin) |
| **Join flow** | Single guest joins | Multiple participants join independently |
| **Meeting control** | Implicit (2 people) | Explicit lock step (host decides when to start) |
| **Slot selection UI** | Single-day toggle grid | Multi-day tabbed grid with heatmap overview |
| **Program ID** | `75K6oNA9gF2gArS4yySXF7cXQPjareTuthuLjeTsRa7P` | `ED2AyG4cew1sxP4RYiFm4xWvamY4VTJJ8yPSphfnVp2N` |

## Tech Stack

| Layer | Technology |
|---|---|
| **Solana Program** | Anchor 0.32, Rust |
| **Privacy** | MagicBlock Private Ephemeral Rollups (Intel TDX) |
| **Frontend** | Next.js 15, React 19, Tailwind CSS 4 |
| **Wallet** | `@solana/wallet-adapter-react` (Phantom, Solflare) |
| **Signaling** | Socket.IO 4 (Node.js + Express) |
| **QR Codes** | `qrcode.react` |
| **Network** | Solana devnet |

## Development

### Prerequisites

- Node.js 18+
- Rust 1.75+ and Anchor CLI 0.32+
- Solana CLI (configured for devnet)
- Phantom wallet browser extension (set to devnet)

### Build & Deploy Program

```bash
cd nullmeet-v2
anchor build
anchor deploy --provider.cluster devnet
```

### Run Frontend

```bash
cd nullmeet-v2/app
npm install
npm run dev
# Opens at http://localhost:3000
```

### Run WebSocket Server

```bash
cd nullmeet-v2/server
npm install
npm run dev
# Listens on http://localhost:3030
```

### Environment Variables

**Frontend (`app/.env.local`):**
```env
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_SOCKET_URL=http://localhost:3030
NEXT_PUBLIC_PROGRAM_ID=ED2AyG4cew1sxP4RYiFm4xWvamY4VTJJ8yPSphfnVp2N
NEXT_PUBLIC_TEE_RPC=https://tee.magicblock.app
NEXT_PUBLIC_TEE_VALIDATOR=FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA
```

**Server (`server/.env`):**
```env
PORT=3030
CORS_ORIGIN=http://localhost:3000
```