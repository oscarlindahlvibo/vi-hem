-- Which agenda item the meeting leader currently has selected in
-- MeetingsPage.tsx (selectedAgendaId) previously lived only in that page's
-- own React state -- the TV screen (ScreenDisplayPage.tsx) had no way to
-- know which point was actually being discussed, so it showed every open
-- item at the same small size. Persist the selection so the screen can
-- render that one item large and readable.
ALTER TABLE public.vihem_meetings
  ADD COLUMN IF NOT EXISTS current_agenda_item_id uuid REFERENCES public.vihem_meeting_agenda_items(id) ON DELETE SET NULL;
