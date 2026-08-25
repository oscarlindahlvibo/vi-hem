-- Dokument (registreringsbevis, försäkringsbrev, leasingavtal, protokoll m.m.)
-- lagras inline som jsonb på fordonet, samma mönster som vihem_work_orders.attachments
-- och vihem_fleet_damage_reports.photos, i stället för en separat vihem_documents-koppling.
alter table public.vihem_fleet_vehicles
  add column if not exists documents jsonb not null default '[]'::jsonb;
