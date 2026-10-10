-- Synthetic fixtures only, called inside a transaction that is always rolled back.
INSERT INTO vihem_organisations(id,name,slug,customer_projects_enabled) VALUES
(md5('p9-org-a')::uuid,'Hotfix QA A','hotfix-qa-a',true),(md5('p9-org-b')::uuid,'Hotfix QA B','hotfix-qa-b',true);
INSERT INTO auth.users(id,aud,role,email) SELECT md5('p9-'||v)::uuid,'authenticated','authenticated',v||'@hotfix.invalid' FROM unnest(ARRAY['admin','staff','tenant','screen','superadmin','inactive','foreign']) v;
INSERT INTO vihem_profiles(id,name,email,role,organisation_id,active)
SELECT md5('p9-'||v)::uuid,v,v||'@hotfix.invalid',CASE WHEN v IN ('inactive','foreign') THEN 'admin' ELSE v END,
md5(CASE WHEN v='foreign' THEN 'p9-org-b' ELSE 'p9-org-a' END)::uuid,v<>'inactive' FROM unnest(ARRAY['admin','staff','tenant','screen','superadmin','inactive','foreign']) v;
INSERT INTO vihem_module_registry(module_key,name,category) VALUES ('fleet_management','Fleet','staff'),('inventory_management','Inventory','staff') ON CONFLICT(module_key) DO NOTHING;
INSERT INTO vihem_organisation_modules(organisation_id,module_key,enabled) SELECT md5('p9-org-'||o)::uuid,m,true FROM unnest(ARRAY['a','b']) o CROSS JOIN unnest(ARRAY['fleet_management','inventory_management']) m;
INSERT INTO vihem_work_orders(id,organisation_id,title) SELECT md5('p9-order-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic order '||o FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_work_order_comments(id,work_order_id,user_id,comment,internal) SELECT md5('p9-comment-'||o)::uuid,md5('p9-order-'||o)::uuid,md5('p9-admin')::uuid,'Synthetic internal',true FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_fleet_vehicles(id,organisation_id,name,asset_type) SELECT md5('p9-vehicle-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic asset '||o,'van' FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_inventory_locations(id,organisation_id,name,type) SELECT md5('p9-location-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic location '||o,'warehouse' FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_inventory_stock_items(id,organisation_id,name,unit,purchase_price) SELECT md5('p9-item-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic article '||o,'st',12.5 FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_inventory_balances(organisation_id,item_id,location_id,quantity) SELECT md5('p9-org-'||o)::uuid,md5('p9-item-'||o)::uuid,md5('p9-location-'||o)::uuid,20 FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_properties(id,organisation_id,name) SELECT md5('p9-property-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic property '||o FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_apartments(id,organisation_id,property_id,apartment_number) SELECT md5('p9-apartment-'||o)::uuid,md5('p9-org-'||o)::uuid,md5('p9-property-'||o)::uuid,'1001' FROM unnest(ARRAY['a','b']) o;
INSERT INTO vihem_customer_projects(id,organisation_id,title) SELECT md5('p9-project-'||o)::uuid,md5('p9-org-'||o)::uuid,'Synthetic project '||o FROM unnest(ARRAY['a','b']) o;
