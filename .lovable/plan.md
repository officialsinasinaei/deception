# Real-Time PvP Matchmaking

Replace the fake "vs bot" flow with true PvP: two humans looking for a match at the same moment are paired immediately, no skill filter, fastest-first.

## Approach

Use Lovable Cloud (managed Supabase) for anonymous accounts, a shared queue, matches, and realtime updates. No Elo/brackets — first-come-first-served.

```text
Player A → /match ──► sign in anon ──► claim oldest waiter?
                                       │
                        ┌── found B ───┤             ┌── found A ──┐
                        ▼              │             ▼             │
                 create match row      │      wait for match row  │
                 delete both queue     │      (realtime insert)   │
                 rows atomically       │                          │
                        └──────────────┴──── both go /play?matchId ┘
```

If no waiter exists, insert self into `queue` and subscribe to realtime for a `matches` row referencing you. Bot fallback only if no pairing within 15 s (keeps solo play alive if the queue is empty).

## Data model

Enable Lovable Cloud, then add three tables:

- **`profiles`** (`user_id` PK → `auth.users`, `avatar_id`, `created_at`). Auto-created on first sign-in via trigger.
- **`match_queue`** (`user_id` PK, `avatar_id`, `enqueued_at`). Single row per waiter.
- **`matches`** (`id` PK, `player_a`, `player_b`, `painting_id`, `phase` enum `camouflage|hunt|ended`, `winner`, `created_at`, plus JSONB columns `a_figures`, `b_figures`, `a_findings`, `b_findings`, `a_ready`, `b_ready`, `a_left`, `b_left`).

Pairing is an atomic RPC `claim_or_enqueue(p_avatar_id)` (SECURITY DEFINER):

1. `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` on the oldest queue row that isn't the caller.
2. If found: delete both rows, insert `matches` with random painting, return `{ matched: true, match_id }`.
3. If none: upsert self into queue, return `{ matched: false }`.

Second RPC `cancel_queue()` clears the caller's queue row on unmount.

Add realtime replication on `match_queue` and `matches`. RLS: users can read only rows where they are `player_a` or `player_b`; queue rows readable only by owner; all writes go through the RPCs.

Grants: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated`, same on `match_queue`, `SELECT` on `profiles` for authenticated.

## Client changes

- **Auth bootstrap** in `src/start.ts` (or a root effect): `supabase.auth.signInAnonymously()` if no session. Persist avatar id to `profiles.avatar_id` on change.
- **`src/game/matchmaking.ts`** (new): `findMatch(avatarId)` → calls `claim_or_enqueue`; if not matched, opens a realtime channel on `matches` filtered by `player_b=eq.<uid>` and resolves when the row appears. Returns `{ matchId, role: "a" | "b", paintingId }`. Also exposes `cancelMatch()`.
- **`src/routes/match.tsx`**: replace timeout with `findMatch`. Show "Seeking a rival painter…" until resolved, then navigate to `/play?matchId=...&role=a`. 15 s soft-timeout → offer bot fallback button (keeps demo usable when queue is empty).
- **`src/routes/play.tsx`**: accept `matchId` + `role` search params. Two branches:
  - **PvP branch**: subscribe to the match row; write your `x_figures` JSON + a base64 PNG of each paint layer at "Ready"; when both `a_ready` and `b_ready` are true, transition to hunt with the opponent's figures rendered from their payload. Findings: click on opponent figure updates `x_findings[i] = true`; when opponent's found-count for you hits 3 you lose. Winner = first to 3 finds. `x_left = true` on unmount / tab close → opponent auto-wins.
  - **Bot branch** (existing code) stays for the fallback path.
- **Presence / abandonment**: `beforeunload` and route cleanup call `cancelMatch()` or set `x_left`. If opponent's `x_left` flips true mid-match, current player wins immediately.

## Technical details

- Paint layer sync: `canvas.toDataURL("image/png")` (~30–60 KB per figure × 3) stored in `a_figures` JSONB. Received side rebuilds `HTMLCanvasElement`s via `Image` load. Not streamed during painting — only sent once at Ready to keep updates small.
- Realtime channel per match: `supabase.channel(`match:${id}`).on("postgres_changes", { table: "matches", filter: `id=eq.${id}` }, ...)`.
- Idempotent RPC: uses `pg_advisory_xact_lock(hashtext('mm'))` so two simultaneous callers can't both claim the same waiter.
- Anonymous auth must be enabled on the Supabase project (done via Lovable Cloud dashboard toggle — noted in the follow-up message).
- `payEntry()` (coin cost) is deducted only after match confirmed, not while queueing.

## Out of scope for this step

- Chat / emotes
- Reconnect after refresh (current match is abandoned on reload)
- Region routing (single global queue)
- Rating / MMR (explicitly excluded by the GDD)

## Files touched

- new: `supabase/migrations/<ts>_pvp_matchmaking.sql`, `src/game/matchmaking.ts`
- edit: `src/routes/match.tsx`, `src/routes/play.tsx`, `src/start.ts` (or `src/routes/__root.tsx`) for anon sign-in, `src/routes/index.tsx` (avatar → profile sync)
