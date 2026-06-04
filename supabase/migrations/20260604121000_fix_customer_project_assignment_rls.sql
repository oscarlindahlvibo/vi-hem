CREATE OR REPLACE FUNCTION is_assigned_to_customer_project(project_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_assignments pa
    WHERE pa.project_id = is_assigned_to_customer_project.project_id
      AND pa.user_id = is_assigned_to_customer_project.user_id
  );
$$;

DROP POLICY IF EXISTS "Org users can read enabled customer projects" ON customer_projects;
CREATE POLICY "Org users can read enabled customer projects"
  ON customer_projects FOR SELECT
  TO authenticated
  USING (
    organisation_id = get_my_org_id()
    AND is_customer_projects_enabled(organisation_id)
    AND (
      get_my_role() = 'admin'
      OR project_manager_id = auth.uid()
      OR is_assigned_to_customer_project(customer_projects.id, auth.uid())
    )
  );
