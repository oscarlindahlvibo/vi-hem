/*
  # Meetings locked status and action priority
*/

ALTER TABLE public.vihem_meetings
  DROP CONSTRAINT IF EXISTS vihem_meetings_status_check;

ALTER TABLE public.vihem_meetings
  ADD CONSTRAINT vihem_meetings_status_check
  CHECK (status IN ('draft', 'planned', 'in_progress', 'completed', 'locked', 'cancelled'));

ALTER TABLE public.vihem_meeting_action_items
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

ALTER TABLE public.vihem_meeting_action_items
  DROP CONSTRAINT IF EXISTS vihem_meeting_action_items_priority_check;

ALTER TABLE public.vihem_meeting_action_items
  ADD CONSTRAINT vihem_meeting_action_items_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

NOTIFY pgrst, 'reload schema';
