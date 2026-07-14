
-- Phase enum
DO $$ BEGIN
  CREATE TYPE public.match_phase AS ENUM ('camouflage', 'hunt', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Queue: one row per waiting painter.
CREATE TABLE IF NOT EXISTS public.match_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_id integer NOT NULL DEFAULT 0,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_queue TO authenticated;
GRANT ALL ON public.match_queue TO service_role;

ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "queue owner reads"
  ON public.match_queue FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "queue owner deletes"
  ON public.match_queue FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
-- Inserts/updates flow through the SECURITY DEFINER RPC only.

-- Matches: one row per paired duel.
CREATE TABLE IF NOT EXISTS public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  avatar_a integer NOT NULL DEFAULT 0,
  avatar_b integer NOT NULL DEFAULT 0,
  painting_id text NOT NULL,
  phase public.match_phase NOT NULL DEFAULT 'camouflage',
  a_figures jsonb,
  b_figures jsonb,
  a_findings jsonb NOT NULL DEFAULT '[false,false,false]'::jsonb,
  b_findings jsonb NOT NULL DEFAULT '[false,false,false]'::jsonb,
  a_ready boolean NOT NULL DEFAULT false,
  b_ready boolean NOT NULL DEFAULT false,
  a_left boolean NOT NULL DEFAULT false,
  b_left boolean NOT NULL DEFAULT false,
  winner uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_player_a_idx ON public.matches(player_a);
CREATE INDEX IF NOT EXISTS matches_player_b_idx ON public.matches(player_b);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participants read match"
  ON public.matches FOR SELECT TO authenticated
  USING (auth.uid() = player_a OR auth.uid() = player_b);
CREATE POLICY "participants update match"
  ON public.matches FOR UPDATE TO authenticated
  USING (auth.uid() = player_a OR auth.uid() = player_b)
  WITH CHECK (auth.uid() = player_a OR auth.uid() = player_b);
-- Inserts only happen via SECURITY DEFINER RPC.

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.matches_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS matches_touch_updated_at ON public.matches;
CREATE TRIGGER matches_touch_updated_at
BEFORE UPDATE ON public.matches
FOR EACH ROW EXECUTE FUNCTION public.matches_touch_updated_at();

-- Atomic pairing RPC.
CREATE OR REPLACE FUNCTION public.claim_or_enqueue(p_avatar_id integer, p_painting_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  waiter record;
  new_match_id uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Serialize matchmaking so two callers can't claim the same waiter.
  PERFORM pg_advisory_xact_lock(hashtext('cod:matchmaking'));

  -- Try to grab the oldest waiter that isn't us.
  SELECT user_id, avatar_id
    INTO waiter
  FROM public.match_queue
  WHERE user_id <> me
  ORDER BY enqueued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF waiter.user_id IS NOT NULL THEN
    -- Pair them. The waiter is player_a (they've been searching longer), we are player_b.
    DELETE FROM public.match_queue WHERE user_id IN (waiter.user_id, me);

    INSERT INTO public.matches (player_a, player_b, avatar_a, avatar_b, painting_id)
    VALUES (waiter.user_id, me, waiter.avatar_id, p_avatar_id, p_painting_id)
    RETURNING id INTO new_match_id;

    RETURN jsonb_build_object(
      'matched', true,
      'match_id', new_match_id,
      'role', 'b',
      'opponent', waiter.user_id,
      'painting_id', p_painting_id
    );
  END IF;

  -- No waiter: enqueue self (upsert so re-calls are idempotent).
  INSERT INTO public.match_queue (user_id, avatar_id, enqueued_at)
  VALUES (me, p_avatar_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET avatar_id = EXCLUDED.avatar_id,
        enqueued_at = now();

  RETURN jsonb_build_object('matched', false);
END $$;

GRANT EXECUTE ON FUNCTION public.claim_or_enqueue(integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;
  DELETE FROM public.match_queue WHERE user_id = me;
END $$;

GRANT EXECUTE ON FUNCTION public.cancel_queue() TO authenticated;

-- Realtime replication
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_queue;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER TABLE public.matches REPLICA IDENTITY FULL;
ALTER TABLE public.match_queue REPLICA IDENTITY FULL;
