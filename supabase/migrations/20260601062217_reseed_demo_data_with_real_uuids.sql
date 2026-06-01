/*
  # Reseed demo data with real auth user IDs

  UUIDs from edge function:
  admin@demo.se        = 23ae8600-fab7-4d0d-890f-3a576ce51c9a
  personal@demo.se     = 66486f3e-15d7-46f6-983b-d85042684d82
  personal2@demo.se    = 46c28820-910e-4d24-9db8-d58c7d6adee0
  hyresgast@demo.se    = 3a1e7c59-7538-4d06-a756-7acf3624af0c
  hyresgast2@demo.se   = a684490c-66dd-4e63-af4a-823e5da67647
  hyresgast3@demo.se   = 5ec6ee46-1e33-4d05-baf2-3c03c1eaec39
  hyresgast4@demo.se   = 064322b7-14ab-4b0e-801b-e47f364e62b7
  hyresgast5@demo.se   = a34dc2c5-a3d0-4284-b75e-a3407c7be6e2
  personal3@demo.se    = fd57eb2b-ada5-4f13-a97d-52ffad784f75
*/

-- PROPERTIES
INSERT INTO properties (id, name, address, city, zip, description, emergency_info, contact_info) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Björkgatan 12', 'Björkgatan 12', 'Stockholm', '113 25',
   'Välskött fastighet i centrala Stockholm. Byggd 1965, renoverad 2010.',
   'Störningsjour: 08-123 456 78. Vattenläcka: Stäng av vatten i källaren.',
   '{"property_manager":"Erik Johansson","phone":"070-100 00 02","email":"erik@fastighetsdemo.se"}'),
  ('10000000-0000-0000-0000-000000000002', 'Ekvägen 5', 'Ekvägen 5', 'Göteborg', '411 38',
   'Trivsam fastighet med nyrenoverade lägenheter. God kollektivtrafik.',
   'Störningsjour: 031-123 456. Brand: Utrym via trapphus.',
   '{"property_manager":"Maja Svensson","phone":"070-100 00 03","email":"maja@fastighetsdemo.se"}')
ON CONFLICT (id) DO NOTHING;

-- APARTMENTS
INSERT INTO apartments (id, property_id, apartment_number, size, rooms, rent, floor, storage, parking, status) VALUES
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','1101',65,2,8500,1,'Förråd F1','','rented'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','1201',82,3,10500,2,'Förråd F2','P-plats 3','rented'),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','1202',55,2,7800,2,'','','rented'),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','1301',95,4,12000,3,'Förråd F4','P-plats 7','rented'),
  ('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','1302',42,1,6500,3,'','','vacant'),
  ('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','2101',73,3,9200,1,'Förråd B1','','rented'),
  ('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002','2102',58,2,8000,1,'','P-plats 2','rented'),
  ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000002','2201',88,3,11000,2,'Förråd B3','P-plats 5','rented'),
  ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000002','2202',45,1,7000,2,'','','vacant'),
  ('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','2301',110,4,13500,3,'Förråd B5','P-plats 8','renovation')
ON CONFLICT (id) DO NOTHING;

-- TENANCIES
INSERT INTO tenancies (id, tenant_id, apartment_id, property_id, start_date, monthly_rent, contact_person, status) VALUES
  ('30000000-0000-0000-0000-000000000001','3a1e7c59-7538-4d06-a756-7acf3624af0c','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2022-03-01',8500,'Erik Johansson','active'),
  ('30000000-0000-0000-0000-000000000002','a684490c-66dd-4e63-af4a-823e5da67647','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','2021-06-01',10500,'Erik Johansson','active'),
  ('30000000-0000-0000-0000-000000000003','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39','20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','2023-01-01',9200,'Maja Svensson','active'),
  ('30000000-0000-0000-0000-000000000004','064322b7-14ab-4b0e-801b-e47f364e62b7','20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002','2022-09-01',8000,'Maja Svensson','active'),
  ('30000000-0000-0000-0000-000000000005','a34dc2c5-a3d0-4284-b75e-a3407c7be6e2','20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000002','2020-11-01',11000,'Maja Svensson','active')
ON CONFLICT (id) DO NOTHING;

-- CUSTOMER PROJECTS
INSERT INTO customer_projects (id, name, customer_name, description, status) VALUES
  ('50000000-0000-0000-0000-000000000001','Renovering Storgatan 8','Storgatan Fastigheter AB','Totalrenovering av 3 lägenheter på Storgatan 8.','active'),
  ('50000000-0000-0000-0000-000000000002','Utemiljö Parkvägen','BRF Parkvägen','Upprustning av utemiljö inkl ny asfalt och plantering.','active')
ON CONFLICT (id) DO NOTHING;

-- MAINTENANCE REQUESTS
INSERT INTO maintenance_requests (id, tenant_id, property_id, apartment_id, title, description, category, priority, status, access_permission, assigned_to, created_at) VALUES
  ('40000000-0000-0000-0000-000000000001','3a1e7c59-7538-4d06-a756-7acf3624af0c','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Läckande kran i kök','Kranen i köket droppar ständigt och har gjort det i en vecka.','water','normal','assigned',true,'66486f3e-15d7-46f6-983b-d85042684d82',now()-interval '5 days'),
  ('40000000-0000-0000-0000-000000000002','a684490c-66dd-4e63-af4a-823e5da67647','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Trasig element i vardagsrum','Elementet i vardagsrummet värmer inte alls. Det är kallt i lägenheten.','heating','urgent','started',true,'66486f3e-15d7-46f6-983b-d85042684d82',now()-interval '3 days'),
  ('40000000-0000-0000-0000-000000000003','3a1e7c59-7538-4d06-a756-7acf3624af0c','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Lampa i hallen fungerar inte','Taklampan i hallen tänds inte. Byte av glödlampa hjälper inte.','electricity','low','received',false,NULL,now()-interval '1 day'),
  ('40000000-0000-0000-0000-000000000004','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000006','Diskmaskin startar inte','Diskmaskinen reagerar inte på knappar.','appliances','normal','waiting_material',true,'46c28820-910e-4d24-9db8-d58c7d6adee0',now()-interval '7 days'),
  ('40000000-0000-0000-0000-000000000005','064322b7-14ab-4b0e-801b-e47f364e62b7','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007','Dörren till förrådet går inte att låsa','Låset till förrådet verkar trasigt.','door_lock','normal','assigned',false,'46c28820-910e-4d24-9db8-d58c7d6adee0',now()-interval '2 days'),
  ('40000000-0000-0000-0000-000000000006','a34dc2c5-a3d0-4284-b75e-a3407c7be6e2','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000008','Ventilationsproblem i badrum','Ventilationen i badrummet låter konstigt.','ventilation','normal','received',true,NULL,now()-interval '4 days'),
  ('40000000-0000-0000-0000-000000000007','a684490c-66dd-4e63-af4a-823e5da67647','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Vattenläcka under diskbänk','Det rinner vatten under diskbänken.','water','urgent','done',true,'66486f3e-15d7-46f6-983b-d85042684d82',now()-interval '10 days'),
  ('40000000-0000-0000-0000-000000000008','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000006','Internet fungerar inte','Bredbandsanslutningen har inte fungerat sedan igår.','internet','normal','closed',false,NULL,now()-interval '14 days'),
  ('40000000-0000-0000-0000-000000000009','3a1e7c59-7538-4d06-a756-7acf3624af0c','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Knakande parkettgolv','Parkettgolvet i sovrummet knakar kraftigt.','other','low','received',true,NULL,now()-interval '6 hours'),
  ('40000000-0000-0000-0000-000000000010','064322b7-14ab-4b0e-801b-e47f364e62b7','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007','Skadedjur sett i köket','Jag har sett en kackerlacka i köket!','pests','urgent','assigned',true,'46c28820-910e-4d24-9db8-d58c7d6adee0',now()-interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- WORK ORDERS
INSERT INTO work_orders (id, title, description, category, priority, status, property_id, apartment_id, tenant_id, maintenance_request_id, assigned_to, created_by, due_date, created_at) VALUES
  ('60000000-0000-0000-0000-000000000001','Byt packning kökskran','Byta packning på kökskranen som droppar.','VVS','normal','assigned','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','3a1e7c59-7538-4d06-a756-7acf3624af0c','40000000-0000-0000-0000-000000000001','66486f3e-15d7-46f6-983b-d85042684d82','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+3,now()-interval '5 days'),
  ('60000000-0000-0000-0000-000000000002','Reparera element','Kontrollera och reparera element i vardagsrum.','Värme','urgent','started','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','a684490c-66dd-4e63-af4a-823e5da67647','40000000-0000-0000-0000-000000000002','66486f3e-15d7-46f6-983b-d85042684d82','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+1,now()-interval '3 days'),
  ('60000000-0000-0000-0000-000000000003','Byt diskmaskin','Diskmaskinen är trasig och behöver bytas ut.','Vitvaror','normal','waiting_material','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000006','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39','40000000-0000-0000-0000-000000000004','46c28820-910e-4d24-9db8-d58c7d6adee0','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+7,now()-interval '7 days'),
  ('60000000-0000-0000-0000-000000000004','Byte av förrådsås','Byta cylinderlås på förrådet.','Snickeri','normal','assigned','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007','064322b7-14ab-4b0e-801b-e47f364e62b7','40000000-0000-0000-0000-000000000005','46c28820-910e-4d24-9db8-d58c7d6adee0','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+2,now()-interval '2 days'),
  ('60000000-0000-0000-0000-000000000005','Snöröjning uppfart','Snöröjning och sandning av uppfart vid Björkgatan 12.','Snöröjning','normal','new','10000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL,'23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+1,now()-interval '1 day'),
  ('60000000-0000-0000-0000-000000000006','Måla trapphus','Måla om trapphuset i sin helhet. 3 våningar + källare.','Målning','low','new','10000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL,'23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+30,now()-interval '2 days'),
  ('60000000-0000-0000-0000-000000000007','Besiktning lgh 2201','Rutinbesiktning inför ny hyresgäst.','Besiktning','normal','completed','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000009',NULL,NULL,'46c28820-910e-4d24-9db8-d58c7d6adee0','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date-5,now()-interval '15 days'),
  ('60000000-0000-0000-0000-000000000008','Skadedjursbekämpning','Anlita extern bekämpningsfirma.','Övrigt','urgent','assigned','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007','064322b7-14ab-4b0e-801b-e47f364e62b7','40000000-0000-0000-0000-000000000010','46c28820-910e-4d24-9db8-d58c7d6adee0','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+1,now()-interval '1 day'),
  ('60000000-0000-0000-0000-000000000009','Service tvättstuga','Serva tvättmaskiner och torktumlare.','Fastighetsunderhåll','normal','paused','10000000-0000-0000-0000-000000000001',NULL,NULL,NULL,'66486f3e-15d7-46f6-983b-d85042684d82','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date+14,now()-interval '8 days'),
  ('60000000-0000-0000-0000-000000000010','Rensa dagvattenbrunnar','Rensa och spola dagvattenbrunnar inför höst.','Förebyggande underhåll','low','completed','10000000-0000-0000-0000-000000000002',NULL,NULL,NULL,'fd57eb2b-ada5-4f13-a97d-52ffad784f75','23ae8600-fab7-4d0d-890f-3a576ce51c9a',current_date-3,now()-interval '20 days')
ON CONFLICT (id) DO NOTHING;

-- TIME ENTRIES
INSERT INTO time_entries (id, user_id, work_order_id, property_id, category, start_time, end_time, break_minutes, total_minutes, comment, status) VALUES
  ('70000000-0000-0000-0000-000000000001','66486f3e-15d7-46f6-983b-d85042684d82','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','work_order',now()-interval '3 days'+interval '8 hours',now()-interval '3 days'+interval '11 hours',15,165,'Kontrollerade element, luftade och bytte ventil.','approved'),
  ('70000000-0000-0000-0000-000000000002','66486f3e-15d7-46f6-983b-d85042684d82','60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','work_order',now()-interval '2 days'+interval '9 hours',now()-interval '2 days'+interval '10 hours',0,60,'Mätte upp packningstorlek.','approved'),
  ('70000000-0000-0000-0000-000000000003','46c28820-910e-4d24-9db8-d58c7d6adee0','60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','work_order',now()-interval '5 days'+interval '8 hours',now()-interval '5 days'+interval '12 hours',30,210,'Demonterat gammal diskmaskin, väntar på ny.','approved'),
  ('70000000-0000-0000-0000-000000000004','46c28820-910e-4d24-9db8-d58c7d6adee0','60000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','work_order',now()-interval '1 days'+interval '13 hours',now()-interval '1 days'+interval '15 hours',0,120,'Beställt nytt cylinderlås.','submitted'),
  ('70000000-0000-0000-0000-000000000005','66486f3e-15d7-46f6-983b-d85042684d82',NULL,'10000000-0000-0000-0000-000000000001','general',now()-interval '1 days'+interval '7 hours',now()-interval '1 days'+interval '8 hours',0,60,'Morgonrond fastigheten.','submitted'),
  ('70000000-0000-0000-0000-000000000006','fd57eb2b-ada5-4f13-a97d-52ffad784f75','60000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','work_order',now()-interval '20 days'+interval '8 hours',now()-interval '20 days'+interval '16 hours',60,420,'Rensat alla dagvattenbrunnar runt fastigheten.','approved'),
  ('70000000-0000-0000-0000-000000000007','fd57eb2b-ada5-4f13-a97d-52ffad784f75','60000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000002','work_order',now()-interval '15 days'+interval '9 hours',now()-interval '15 days'+interval '12 hours',15,165,'Utförd besiktning, dokumenterat skador med foton.','approved'),
  ('70000000-0000-0000-0000-000000000008','66486f3e-15d7-46f6-983b-d85042684d82','60000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','work_order',now()-interval '6 days'+interval '8 hours',now()-interval '6 days'+interval '14 hours',45,315,'Servicerat 3 tvättmaskiner.','approved'),
  ('70000000-0000-0000-0000-000000000009','46c28820-910e-4d24-9db8-d58c7d6adee0',NULL,'10000000-0000-0000-0000-000000000002','admin',now()-interval '4 days'+interval '14 hours',now()-interval '4 days'+interval '16 hours',0,120,'Administrativt arbete, hyresgästkommunikation.','submitted'),
  ('70000000-0000-0000-0000-000000000010','66486f3e-15d7-46f6-983b-d85042684d82','60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','work_order',now()-interval '1 days'+interval '10 hours',now()-interval '1 days'+interval '13 hours',30,150,'Fortsatte med elementreparation.','draft'),
  ('70000000-0000-0000-0000-000000000011','fd57eb2b-ada5-4f13-a97d-52ffad784f75',NULL,NULL,'travel',now()-interval '10 days'+interval '7 hours',now()-interval '10 days'+interval '8 hours',0,60,'Inköp av material på bygghandeln.','approved'),
  ('70000000-0000-0000-0000-000000000012','46c28820-910e-4d24-9db8-d58c7d6adee0','60000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000002','work_order',now()-interval '23 hours',NULL,0,0,'Inkallad för skadedjursinspektion.','draft')
ON CONFLICT (id) DO NOTHING;

-- LAUNDRY ROOMS
INSERT INTO laundry_rooms (id, property_id, name, description, machines, max_bookings_per_tenant) VALUES
  ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Tvättstuga A – Björkgatan','Tvättstuga i källaren. 3 tvättmaskiner och 2 torktumlare.','[{"name":"Tvättmaskin 1"},{"name":"Tvättmaskin 2"},{"name":"Tvättmaskin 3"},{"name":"Torktumlare 1"},{"name":"Torktumlare 2"}]',3),
  ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Tvättstuga – Ekvägen','Tvättstuga på bottenplan. 2 tvättmaskiner och 1 torktumlare.','[{"name":"Tvättmaskin 1"},{"name":"Tvättmaskin 2"},{"name":"Torktumlare 1"}]',2)
ON CONFLICT (id) DO NOTHING;

-- LAUNDRY SLOTS (14 days)
DO $$
DECLARE
  slot_times time[][] := ARRAY[
    ARRAY['07:00'::time,'10:00'::time],
    ARRAY['10:00'::time,'13:00'::time],
    ARRAY['13:00'::time,'16:00'::time],
    ARRAY['16:00'::time,'19:00'::time],
    ARRAY['19:00'::time,'22:00'::time]
  ];
  d date;
  i int;
  room_id uuid;
BEGIN
  FOR room_id IN SELECT id FROM laundry_rooms LOOP
    FOR d IN SELECT generate_series(current_date, current_date+13, '1 day'::interval)::date LOOP
      FOR i IN 1..5 LOOP
        INSERT INTO laundry_slots (laundry_room_id, date, start_time, end_time, is_blocked)
        VALUES (room_id, d, slot_times[i][1], slot_times[i][2], false)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

-- NEWS
INSERT INTO news (id, title, content, target_type, status, published_at, created_by, created_at) VALUES
  ('90000000-0000-0000-0000-000000000001','Välkommen till FastighetsPortalen!','Vi är glada att kunna erbjuda er denna nya digitala portal för er boendekommunikation. Här kan ni anmäla fel, boka tvättider, läsa nyheter och mycket mer.','all','published',now()-interval '30 days','23ae8600-fab7-4d0d-890f-3a576ce51c9a',now()-interval '30 days'),
  ('90000000-0000-0000-0000-000000000002','Planerat vattenavstängning 15 juni','Tisdagen den 15 juni kommer varmvattnet att stängas av mellan kl 08:00–12:00 på Björkgatan 12 för underhållsarbete.','property','published',now()-interval '5 days','23ae8600-fab7-4d0d-890f-3a576ce51c9a',now()-interval '5 days'),
  ('90000000-0000-0000-0000-000000000003','Ny sopsortering från 1 juli','Från och med 1 juli inför vi förbättrad sopsortering med separata kärl för matavfall, plastförpackningar, papper, glas och restavfall.','all','published',now()-interval '2 days','23ae8600-fab7-4d0d-890f-3a576ce51c9a',now()-interval '2 days'),
  ('90000000-0000-0000-0000-000000000004','Service tvättstuga vecka 24','Tvättstugan på Björkgatan 12 är stängd måndag–tisdag v.24 för service av maskinerna.','property','published',now()-interval '10 days','23ae8600-fab7-4d0d-890f-3a576ce51c9a',now()-interval '10 days'),
  ('90000000-0000-0000-0000-000000000005','Sommaröppettider kundservice','Under juli månad har vi begränsade öppettider. Telefon bemannad mån–fre 09:00–14:00.','all','draft',NULL,'23ae8600-fab7-4d0d-890f-3a576ce51c9a',now())
ON CONFLICT (id) DO NOTHING;

-- DOCUMENTS
INSERT INTO documents (id, title, file_url, file_name, document_type, visibility, tenant_id, property_id, apartment_id, description, created_by) VALUES
  ('a0000000-0000-0000-0000-000000000001','Hyresavtal – Lars Andersson','','hyresavtal_lars.pdf','contract','tenant','3a1e7c59-7538-4d06-a756-7acf3624af0c','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Hyresavtal fr.o.m. 2022-03-01','23ae8600-fab7-4d0d-890f-3a576ce51c9a'),
  ('a0000000-0000-0000-0000-000000000002','Ordningsregler Björkgatan 12','','ordningsregler.pdf','rules','tenant',NULL,'10000000-0000-0000-0000-000000000001',NULL,'Fastighetsordning och husregler','23ae8600-fab7-4d0d-890f-3a576ce51c9a'),
  ('a0000000-0000-0000-0000-000000000003','Besiktningsprotokoll lgh 1101','','besiktning_1101.pdf','inspection','tenant','3a1e7c59-7538-4d06-a756-7acf3624af0c',NULL,'20000000-0000-0000-0000-000000000001','Inflyttningsbesiktning mars 2022','23ae8600-fab7-4d0d-890f-3a576ce51c9a'),
  ('a0000000-0000-0000-0000-000000000004','Ordningsregler Ekvägen 5','','ordningsregler_ekv.pdf','rules','tenant',NULL,'10000000-0000-0000-0000-000000000002',NULL,'Fastighetsordning och husregler','23ae8600-fab7-4d0d-890f-3a576ce51c9a')
ON CONFLICT (id) DO NOTHING;

-- CHAT THREADS
INSERT INTO chat_threads (id, tenant_id, assigned_to, subject, status, last_message_at) VALUES
  ('b0000000-0000-0000-0000-000000000001','3a1e7c59-7538-4d06-a756-7acf3624af0c','66486f3e-15d7-46f6-983b-d85042684d82','Fråga om parkering','open',now()-interval '2 days'),
  ('b0000000-0000-0000-0000-000000000002','a684490c-66dd-4e63-af4a-823e5da67647','66486f3e-15d7-46f6-983b-d85042684d82','Felanmälan element','open',now()-interval '1 day'),
  ('b0000000-0000-0000-0000-000000000003','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39',NULL,'Fråga om hyreshöjning','open',now()-interval '3 hours')
ON CONFLICT (id) DO NOTHING;

-- CHAT MESSAGES
INSERT INTO chat_messages (id, thread_id, sender_id, message, created_at) VALUES
  ('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','3a1e7c59-7538-4d06-a756-7acf3624af0c','Hej! Jag undrar om det finns möjlighet att hyra en parkeringsplats?',now()-interval '2 days'),
  ('c0000000-0000-0000-0000-000000000002','b0000000-0000-0000-0000-000000000001','66486f3e-15d7-46f6-983b-d85042684d82','Hej Lars! Tyvärr är alla platser uthyrda just nu, men jag sätter upp dig på väntelistan.',now()-interval '1 day 20 hours'),
  ('c0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000002','a684490c-66dd-4e63-af4a-823e5da67647','Hej! Har ni fått min felanmälan om elementet? Det är fortfarande kallt hemma hos mig.',now()-interval '1 day'),
  ('c0000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000002','66486f3e-15d7-46f6-983b-d85042684d82','Hej Karin! Ja vi har fått er anmälan. Jag jobbar på det nu och ska ha det klart senast imorgon.',now()-interval '23 hours'),
  ('c0000000-0000-0000-0000-000000000005','b0000000-0000-0000-0000-000000000003','5ec6ee46-1e33-4d05-baf2-3c03c1eaec39','Hej! Jag fick brev om hyreshöjning från nästa år. Kan ni förklara vad den baseras på?',now()-interval '3 hours')
ON CONFLICT (id) DO NOTHING;

-- NOTIFICATIONS
INSERT INTO notifications (user_id, title, message, type, created_at) VALUES
  ('3a1e7c59-7538-4d06-a756-7acf3624af0c','Felanmälan mottagen','Din felanmälan "Läckande kran i kök" har mottagits och tilldelats personal.','maintenance',now()-interval '5 days'),
  ('3a1e7c59-7538-4d06-a756-7acf3624af0c','Ny status på felanmälan','Felanmälan "Läckande kran i kök" har status: Tilldelad','maintenance',now()-interval '4 days'),
  ('a684490c-66dd-4e63-af4a-823e5da67647','Felanmälan mottagen','Din felanmälan "Trasig element i vardagsrum" är nu under arbete.','maintenance',now()-interval '3 days'),
  ('66486f3e-15d7-46f6-983b-d85042684d82','Ny felanmälan tilldelad','Du har tilldelats felanmälan "Knakande parkettgolv" från Lars Andersson.','maintenance',now()-interval '6 hours'),
  ('46c28820-910e-4d24-9db8-d58c7d6adee0','Akut felanmälan','Ny akut felanmälan: "Skadedjur sett i köket" från Sara Eriksson.','maintenance',now()-interval '1 day'),
  ('23ae8600-fab7-4d0d-890f-3a576ce51c9a','Tidrapport att godkänna','3 tidrapporter väntar på godkännande.','time_entry',now()-interval '12 hours')
ON CONFLICT DO NOTHING;
