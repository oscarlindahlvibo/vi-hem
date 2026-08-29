-- Möten V2: TV-skärmens mötesvy prenumererar på postgres_changes för dessa
-- fyra tabeller (samma mönster som redan används i CalendarPage.tsx) så att
-- dagordningens fritext, beslut, uppgifter och AI-sammanfattning uppdateras
-- på skärmen inom någon sekund istället för att vänta på nästa 60s-poll.
--
-- postgres_changes kräver att tabellen är medlem i publikationen
-- supabase_realtime, oavsett klientkod. Ingen tabell i databasen var
-- medlem av den publikationen alls (verifierat lokalt) -- lägger bara till
-- de fyra tabeller den här funktionen faktiskt behöver, skrivet
-- idempotent så migrationen är säker att köra om.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vihem_meeting_agenda_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vihem_meeting_agenda_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vihem_meeting_decisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vihem_meeting_decisions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vihem_meeting_action_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vihem_meeting_action_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'vihem_ai_suggestions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vihem_ai_suggestions;
  END IF;
END $$;
