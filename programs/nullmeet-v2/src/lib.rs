use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::{
    CreatePermissionCpiBuilder, UpdatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::PERMISSION_PROGRAM_ID;
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

declare_id!("ED2AyG4cew1sxP4RYiFm4xWvamY4VTJJ8yPSphfnVp2N");

pub const MEETING_SEED: &[u8] = b"meeting";
pub const SLOT_RECORD_SEED: &[u8] = b"slot_record";

pub const MAX_PARTICIPANTS: usize = 10;
pub const MAX_DAYS: usize = 7;
pub const SLOTS_PER_DAY: usize = 8;
pub const MAX_SLOTS: usize = MAX_DAYS * SLOTS_PER_DAY; // 56

#[ephemeral]
#[program]
pub mod nullmeet_v2 {
    use super::*;

    /// Host creates a meeting and their own SlotRecord
    pub fn create_meeting(
        ctx: Context<CreateMeeting>,
        meeting_id: u64,
        num_days: u8,
        start_date: i64,
        max_participants: u8,
    ) -> Result<()> {
        require!(
            num_days >= 1 && num_days <= MAX_DAYS as u8,
            NullmeetError::InvalidDayCount
        );
        require!(
            max_participants >= 2 && max_participants <= MAX_PARTICIPANTS as u8,
            NullmeetError::InvalidParticipantCount
        );

        let meeting = &mut ctx.accounts.meeting;
        let host = ctx.accounts.host.key();

        meeting.meeting_id = meeting_id;
        meeting.host = host;
        meeting.num_days = num_days;
        meeting.start_date = start_date;
        meeting.max_participants = max_participants;
        meeting.participant_count = 1;
        meeting.participants = [Pubkey::default(); MAX_PARTICIPANTS];
        meeting.participants[0] = host;
        meeting.submitted_count = 0;
        meeting.result_day = None;
        meeting.result_slot = None;
        meeting.result_score = None;
        meeting.valid_overlap = false;
        meeting.resolved = false;
        meeting.status = MeetingStatus::Open;

        let slot_record = &mut ctx.accounts.host_slot_record;
        slot_record.meeting_id = meeting_id;
        slot_record.owner = host;
        slot_record.num_days = num_days;
        slot_record.slots = [0; MAX_SLOTS];
        slot_record.submitted = false;

        msg!("Meeting {} created by {} ({} days, max {} participants)",
            meeting_id, host, num_days, max_participants);
        Ok(())
    }

    /// Participant joins and creates their own SlotRecord
    pub fn join_meeting(ctx: Context<JoinMeeting>, meeting_id: u64) -> Result<()> {
        let meeting = &mut ctx.accounts.meeting;
        let participant = ctx.accounts.participant.key();

        require!(
            meeting.status == MeetingStatus::Open,
            NullmeetError::MeetingNotOpen
        );
        require!(
            meeting.participant_count < meeting.max_participants,
            NullmeetError::MeetingFull
        );
        require!(
            meeting.host != participant,
            NullmeetError::CannotJoinOwnMeeting
        );

        // Check not already joined
        for i in 0..meeting.participant_count as usize {
            require!(
                meeting.participants[i] != participant,
                NullmeetError::AlreadyJoined
            );
        }

        let idx = meeting.participant_count as usize;
        meeting.participants[idx] = participant;
        meeting.participant_count += 1;

        let slot_record = &mut ctx.accounts.participant_slot_record;
        slot_record.meeting_id = meeting_id;
        slot_record.owner = participant;
        slot_record.num_days = meeting.num_days;
        slot_record.slots = [0; MAX_SLOTS];
        slot_record.submitted = false;

        msg!("{} joined Meeting {} ({}/{})",
            participant, meeting_id, meeting.participant_count, meeting.max_participants);
        Ok(())
    }

    /// Host locks meeting — no more joins allowed, TEE delegation phase begins
    pub fn lock_meeting(ctx: Context<LockMeeting>, _meeting_id: u64) -> Result<()> {
        let meeting = &mut ctx.accounts.meeting;

        require!(
            ctx.accounts.host.key() == meeting.host,
            NullmeetError::NotHost
        );
        require!(
            meeting.status == MeetingStatus::Open,
            NullmeetError::MeetingNotOpen
        );
        require!(
            meeting.participant_count >= 2,
            NullmeetError::NotEnoughParticipants
        );

        meeting.status = MeetingStatus::Locked;

        msg!("Meeting {} locked with {} participants",
            meeting.meeting_id, meeting.participant_count);
        Ok(())
    }

    /// Submit slots — called inside TEE after delegation
    pub fn submit_slots(
        ctx: Context<SubmitSlots>,
        _meeting_id: u64,
        slots: Vec<u8>,
    ) -> Result<()> {
        let slot_record = &mut ctx.accounts.slot_record;
        require!(!slot_record.submitted, NullmeetError::AlreadySubmitted);

        let num_slots = slot_record.num_days as usize * SLOTS_PER_DAY;
        require!(slots.len() == num_slots, NullmeetError::InvalidSlotCount);

        // Validate all scores are 0-4
        for &s in &slots {
            require!(s <= 4, NullmeetError::InvalidPreference);
        }

        // Copy into fixed array
        for (i, &s) in slots.iter().enumerate() {
            slot_record.slots[i] = s;
        }
        slot_record.submitted = true;

        msg!("Player {:?} submitted {} slots", slot_record.owner, num_slots);
        Ok(())
    }

    /// Compute result — reads all participant SlotRecords via remaining_accounts
    /// Called inside TEE once all parties have submitted
    ///
    /// remaining_accounts layout:
    ///   [0..N]   = SlotRecord accounts (one per participant)
    ///   [N..2N]  = Permission accounts for each SlotRecord
    pub fn compute_result<'a>(ctx: Context<'_, '_, 'a, 'a, ComputeResult<'a>>, _meeting_id: u64) -> Result<()> {
        let n = ctx.accounts.meeting.participant_count as usize;
        let total_slots = ctx.accounts.meeting.num_days as usize * SLOTS_PER_DAY;
        let meeting_id_bytes = ctx.accounts.meeting.meeting_id.to_le_bytes();
        let meeting_bump = ctx.bumps.meeting;

        // Copy participant pubkeys before borrowing remaining_accounts
        let mut participant_keys = Vec::with_capacity(n);
        for i in 0..n {
            participant_keys.push(ctx.accounts.meeting.participants[i]);
        }

        let remaining = ctx.remaining_accounts;
        require!(remaining.len() == 2 * n, NullmeetError::InvalidAccountCount);

        // Deserialize and validate all SlotRecords
        let mut all_slots: Vec<[u8; MAX_SLOTS]> = Vec::with_capacity(n);
        let mut slot_record_bumps: Vec<u8> = Vec::with_capacity(n);

        for i in 0..n {
            let account_info = &remaining[i];
            let participant = participant_keys[i];

            // Verify PDA
            let (expected_pda, bump) = Pubkey::find_program_address(
                &[
                    SLOT_RECORD_SEED,
                    &meeting_id_bytes,
                    participant.as_ref(),
                ],
                &crate::ID,
            );
            require!(
                account_info.key() == expected_pda,
                NullmeetError::InvalidSlotRecord
            );

            // Deserialize
            let data = account_info.try_borrow_data()?;
            // Skip 8-byte discriminator
            let record = SlotRecord::try_from_slice(&data[8..])?;
            require!(record.submitted, NullmeetError::SlotsNotSubmitted);

            all_slots.push(record.slots);
            slot_record_bumps.push(bump);
        }

        // Compute: for each slot, take minimum across all participants
        // Min preserves the veto property (any 0 blocks the slot)
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

        let meeting = &mut ctx.accounts.meeting;
        meeting.result_day = Some((best_idx / SLOTS_PER_DAY) as u8);
        meeting.result_slot = Some((best_idx % SLOTS_PER_DAY) as u8);
        meeting.result_score = Some(best_score);
        meeting.valid_overlap = best_score > 0;
        meeting.resolved = true;
        meeting.status = MeetingStatus::Resolved;

        let permission_program = &ctx.accounts.permission_program.to_account_info();
        let permission_meeting = &ctx.accounts.permission_meeting.to_account_info();

        // Clear meeting permission (make result public)
        UpdatePermissionCpiBuilder::new(permission_program)
            .permissioned_account(&meeting.to_account_info(), true)
            .authority(&meeting.to_account_info(), false)
            .permission(permission_meeting)
            .args(MembersArgs { members: None })
            .invoke_signed(&[&[
                MEETING_SEED,
                &meeting_id_bytes,
                &[meeting_bump],
            ]])?;

        // Clear all SlotRecord permissions
        for i in 0..n {
            let slot_record_info = &remaining[i];
            let permission_info = &remaining[n + i];
            let participant = participant_keys[i];

            UpdatePermissionCpiBuilder::new(permission_program)
                .permissioned_account(slot_record_info, true)
                .authority(slot_record_info, false)
                .permission(permission_info)
                .args(MembersArgs { members: None })
                .invoke_signed(&[&[
                    SLOT_RECORD_SEED,
                    &meeting_id_bytes,
                    participant.as_ref(),
                    &[slot_record_bumps[i]],
                ]])?;
        }

        msg!(
            "Result: day {}, slot {}, score {}, valid {}",
            best_idx / SLOTS_PER_DAY,
            best_idx % SLOTS_PER_DAY,
            best_score,
            best_score > 0
        );

        // Exit and commit meeting to base layer
        let magic_program = &ctx.accounts.magic_program.to_account_info();
        let magic_context = &ctx.accounts.magic_context.to_account_info();
        meeting.exit(&crate::ID)?;

        commit_and_undelegate_accounts(
            &ctx.accounts.payer,
            vec![&meeting.to_account_info()],
            magic_context,
            magic_program,
        )?;

        Ok(())
    }

    /// Generic PDA delegation — delegates any account type to TEE validator
    pub fn delegate_pda(ctx: Context<DelegatePda>, account_type: AccountType) -> Result<()> {
        let seed_data = derive_seeds_from_account_type(&account_type);
        let seeds_refs: Vec<&[u8]> = seed_data.iter().map(|s| s.as_slice()).collect();

        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &seeds_refs,
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Creates a permission for a PDA based on AccountType
    pub fn create_permission(
        ctx: Context<CreatePermission>,
        account_type: AccountType,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        let CreatePermission {
            permissioned_account,
            permission,
            payer,
            permission_program,
            system_program,
        } = ctx.accounts;

        let seed_data = derive_seeds_from_account_type(&account_type);

        let (_, bump) = Pubkey::find_program_address(
            &seed_data.iter().map(|s| s.as_slice()).collect::<Vec<_>>(),
            &crate::ID,
        );

        let mut seeds = seed_data.clone();
        seeds.push(vec![bump]);
        let seed_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();

        CreatePermissionCpiBuilder::new(&permission_program)
            .permissioned_account(&permissioned_account.to_account_info())
            .permission(permission)
            .payer(payer)
            .system_program(system_program)
            .args(MembersArgs { members })
            .invoke_signed(&[seed_refs.as_slice()])?;
        Ok(())
    }
}

// ── Account Contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(meeting_id: u64)]
pub struct CreateMeeting<'info> {
    #[account(
        init_if_needed,
        payer = host,
        space = 8 + Meeting::LEN,
        seeds = [MEETING_SEED, &meeting_id.to_le_bytes()],
        bump
    )]
    pub meeting: Account<'info, Meeting>,

    #[account(
        init_if_needed,
        payer = host,
        space = 8 + SlotRecord::LEN,
        seeds = [SLOT_RECORD_SEED, &meeting_id.to_le_bytes(), host.key().as_ref()],
        bump
    )]
    pub host_slot_record: Account<'info, SlotRecord>,

    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meeting_id: u64)]
pub struct JoinMeeting<'info> {
    #[account(
        mut,
        seeds = [MEETING_SEED, &meeting_id.to_le_bytes()],
        bump
    )]
    pub meeting: Account<'info, Meeting>,

    #[account(
        init_if_needed,
        payer = participant,
        space = 8 + SlotRecord::LEN,
        seeds = [SLOT_RECORD_SEED, &meeting_id.to_le_bytes(), participant.key().as_ref()],
        bump
    )]
    pub participant_slot_record: Account<'info, SlotRecord>,

    #[account(mut)]
    pub participant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(meeting_id: u64)]
pub struct LockMeeting<'info> {
    #[account(
        mut,
        seeds = [MEETING_SEED, &meeting_id.to_le_bytes()],
        bump
    )]
    pub meeting: Account<'info, Meeting>,

    pub host: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(meeting_id: u64)]
pub struct SubmitSlots<'info> {
    #[account(
        mut,
        seeds = [SLOT_RECORD_SEED, &meeting_id.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub slot_record: Account<'info, SlotRecord>,

    #[account(mut)]
    pub player: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(meeting_id: u64)]
pub struct ComputeResult<'info> {
    #[account(mut, seeds = [MEETING_SEED, &meeting_id.to_le_bytes()], bump)]
    pub meeting: Account<'info, Meeting>,

    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission_meeting: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,

    // SlotRecords + their permissions passed via remaining_accounts
}

/// Generic delegation context
#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: The PDA to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
    pub payer: Signer<'info>,
    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct CreatePermission<'info> {
    /// CHECK: Validated via permission program CPI
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: Checked by the permission program
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PERMISSION PROGRAM
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

// ── Account Data ────────────────────────────────────────────────────────────

#[account]
pub struct Meeting {
    pub meeting_id: u64,                          // 8
    pub host: Pubkey,                             // 32
    pub num_days: u8,                             // 1
    pub start_date: i64,                          // 8
    pub max_participants: u8,                     // 1
    pub participant_count: u8,                    // 1
    pub participants: [Pubkey; MAX_PARTICIPANTS],  // 320
    pub submitted_count: u8,                      // 1
    pub result_day: Option<u8>,                   // 2
    pub result_slot: Option<u8>,                  // 2
    pub result_score: Option<u8>,                 // 2
    pub valid_overlap: bool,                      // 1
    pub resolved: bool,                           // 1
    pub status: MeetingStatus,                    // 1
}

impl Meeting {
    pub const LEN: usize = 8       // meeting_id
        + 32                        // host
        + 1                         // num_days
        + 8                         // start_date
        + 1                         // max_participants
        + 1                         // participant_count
        + (32 * MAX_PARTICIPANTS)   // participants
        + 1                         // submitted_count
        + 2                         // result_day (Option<u8>)
        + 2                         // result_slot (Option<u8>)
        + 2                         // result_score (Option<u8>)
        + 1                         // valid_overlap
        + 1                         // resolved
        + 1;                        // status
}

#[account]
pub struct SlotRecord {
    pub meeting_id: u64,            // 8
    pub owner: Pubkey,              // 32
    pub num_days: u8,               // 1
    pub slots: [u8; MAX_SLOTS],     // 56
    pub submitted: bool,            // 1
}

impl SlotRecord {
    pub const LEN: usize = 8       // meeting_id
        + 32                        // owner
        + 1                         // num_days
        + MAX_SLOTS                 // slots [u8; 56]
        + 1;                        // submitted
}

// ── Enums ───────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum MeetingStatus {
    Open,
    Locked,
    Computing,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    Meeting { meeting_id: u64 },
    SlotRecord { meeting_id: u64, owner: Pubkey },
}

fn derive_seeds_from_account_type(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::Meeting { meeting_id } => {
            vec![MEETING_SEED.to_vec(), meeting_id.to_le_bytes().to_vec()]
        }
        AccountType::SlotRecord { meeting_id, owner } => {
            vec![
                SLOT_RECORD_SEED.to_vec(),
                meeting_id.to_le_bytes().to_vec(),
                owner.to_bytes().to_vec(),
            ]
        }
    }
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum NullmeetError {
    #[msg("Cannot join your own meeting")]
    CannotJoinOwnMeeting,
    #[msg("Meeting is full")]
    MeetingFull,
    #[msg("Slots already submitted")]
    AlreadySubmitted,
    #[msg("All participants must submit slots first")]
    SlotsNotSubmitted,
    #[msg("Invalid day count (must be 1-7)")]
    InvalidDayCount,
    #[msg("Invalid participant count (must be 2-10)")]
    InvalidParticipantCount,
    #[msg("Meeting is not open for joining")]
    MeetingNotOpen,
    #[msg("Only the host can perform this action")]
    NotHost,
    #[msg("Need at least 2 participants to lock")]
    NotEnoughParticipants,
    #[msg("Already joined this meeting")]
    AlreadyJoined,
    #[msg("Invalid slot count for the configured days")]
    InvalidSlotCount,
    #[msg("Preference score must be 0-4")]
    InvalidPreference,
    #[msg("Invalid number of remaining accounts")]
    InvalidAccountCount,
    #[msg("Invalid slot record PDA")]
    InvalidSlotRecord,
}
