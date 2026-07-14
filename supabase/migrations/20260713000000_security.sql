-- Defense in depth on top of the participant-only RLS UPDATE policy.
-- RLS already restricts updates to match participants; this trigger additionally:
--   1. prevents a participant from editing the OPPONENT's columns (a_* vs b_*),
--   2. only allows `winner` to be set to the caller, and only when that
--      caller's own `*_findings` are all true (i.e. they actually won),
--   3. leaves the legitimate opponent-left `phase='ended'` path (no winner) intact.
CREATE OR REPLACE FUNCTION public.matches_guard_winner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  my_findings jsonb;
  all_found boolean;
BEGIN
  IF me IS NULL OR (me <> NEW.player_a AND me <> NEW.player_b) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  -- A participant may only modify their own columns.
  IF me = NEW.player_a THEN
    IF NEW.b_ready <> OLD.b_ready
       OR NEW.b_findings IS DISTINCT FROM OLD.b_findings
       OR NEW.b_left <> OLD.b_left
       OR NEW.b_figures IS DISTINCT FROM OLD.b_figures THEN
      RAISE EXCEPTION 'cannot modify opponent columns';
    END IF;
  ELSE
    IF NEW.a_ready <> OLD.a_ready
       OR NEW.a_findings IS DISTINCT FROM OLD.a_findings
       OR NEW.a_left <> OLD.a_left
       OR NEW.a_figures IS DISTINCT FROM OLD.a_figures THEN
      RAISE EXCEPTION 'cannot modify opponent columns';
    END IF;
  END IF;

  -- winner may only be set by the caller, and only if they actually found
  -- all three of the opponent's figures.
  IF NEW.winner IS NOT NULL
     AND (OLD.winner IS NULL OR NEW.winner IS DISTINCT FROM OLD.winner) THEN
    IF me = NEW.player_a THEN
      my_findings := NEW.a_findings;
    ELSE
      my_findings := NEW.b_findings;
    END IF;
    SELECT bool_and(value::boolean) INTO all_found FROM jsonb_array_elements(my_findings);
    IF NEW.winner <> me OR NOT COALESCE(all_found, false) THEN
      RAISE EXCEPTION 'invalid winner declaration';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS matches_guard_winner ON public.matches;
CREATE TRIGGER matches_guard_winner
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.matches_guard_winner();

-- Speeds up the `claim_or_enqueue` queue scan (ORDER BY enqueued_at ASC).
CREATE INDEX IF NOT EXISTS match_queue_enqueued_at_idx
  ON public.match_queue(enqueued_at);
