CREATE OR REPLACE FUNCTION populate_maintenance_request_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tenant_scope record;
  tenant_org uuid;
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    SELECT t.property_id, t.apartment_id, t.organisation_id
    INTO tenant_scope
    FROM tenancies t
    WHERE t.tenant_id = NEW.tenant_id
      AND t.status = 'active'
    ORDER BY t.start_date DESC
    LIMIT 1;

    SELECT p.organisation_id
    INTO tenant_org
    FROM profiles p
    WHERE p.id = NEW.tenant_id;

    NEW.property_id := COALESCE(NEW.property_id, tenant_scope.property_id);
    NEW.apartment_id := COALESCE(NEW.apartment_id, tenant_scope.apartment_id);
    NEW.organisation_id := COALESCE(NEW.organisation_id, tenant_scope.organisation_id, tenant_org);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS populate_maintenance_request_scope_trigger ON maintenance_requests;
CREATE TRIGGER populate_maintenance_request_scope_trigger
  BEFORE INSERT OR UPDATE OF tenant_id, property_id, apartment_id, organisation_id
  ON maintenance_requests
  FOR EACH ROW
  EXECUTE FUNCTION populate_maintenance_request_scope();

WITH active_tenancies AS (
  SELECT DISTINCT ON (tenant_id)
    tenant_id,
    property_id,
    apartment_id,
    organisation_id
  FROM tenancies
  WHERE status = 'active'
  ORDER BY tenant_id, start_date DESC
)
UPDATE maintenance_requests mr
SET
  property_id = COALESCE(mr.property_id, at.property_id),
  apartment_id = COALESCE(mr.apartment_id, at.apartment_id),
  organisation_id = COALESCE(mr.organisation_id, at.organisation_id, p.organisation_id)
FROM active_tenancies at
JOIN profiles p ON p.id = at.tenant_id
WHERE mr.tenant_id = at.tenant_id
  AND (mr.property_id IS NULL OR mr.apartment_id IS NULL OR mr.organisation_id IS NULL);

UPDATE maintenance_requests mr
SET organisation_id = p.organisation_id
FROM profiles p
WHERE mr.tenant_id = p.id
  AND mr.organisation_id IS NULL
  AND p.organisation_id IS NOT NULL;

DROP POLICY IF EXISTS "Tenant can insert own maintenance requests" ON maintenance_requests;
CREATE POLICY "Tenant can insert own maintenance requests"
  ON maintenance_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = auth.uid()
    AND organisation_id = get_my_org_id()
    AND (
      property_id IS NULL
      OR property_id IN (
        SELECT property_id
        FROM tenancies
        WHERE tenant_id = auth.uid()
          AND status = 'active'
      )
    )
    AND (
      apartment_id IS NULL
      OR apartment_id IN (
        SELECT apartment_id
        FROM tenancies
        WHERE tenant_id = auth.uid()
          AND status = 'active'
      )
    )
  );
