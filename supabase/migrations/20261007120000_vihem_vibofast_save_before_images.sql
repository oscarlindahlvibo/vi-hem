BEGIN;

create or replace function public.vihem_vibofast_save_advert(p_source_id uuid,p_payload jsonb,p_published boolean,p_revision bigint,p_ready_from date default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare new_revision bigint;
begin
 if not public.vihem_vibofast_is_editor() then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.vihem_apartments a join public.vihem_properties pr on pr.id=a.property_id
   join vihem_vibofast_private.site_content c on c.organisation_id=a.organisation_id and c.organisation_id=pr.organisation_id
   where a.id=p_source_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Images can be added after saving. Public listings already exclude adverts without effective images.
 if p_revision=0 then
   insert into vihem_vibofast_private.adverts(source_id,payload,published,ready_from)
   values(p_source_id,p_payload,p_published,p_ready_from) on conflict do nothing returning revision into new_revision;
 else
   update vihem_vibofast_private.adverts set payload=p_payload,published=p_published,ready_from=p_ready_from,revision=revision+1,updated_at=now()
   where source_id=p_source_id and revision=p_revision returning revision into new_revision;
 end if;
 if not found then raise exception 'Annonsen har ändrats. Ladda om innan du sparar.'; end if;
 return new_revision;
end;
$$;

COMMIT;
