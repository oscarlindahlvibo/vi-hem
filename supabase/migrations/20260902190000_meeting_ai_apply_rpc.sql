-- Meetings rebuild, Phase 1 -- atomic AI-suggestion apply.
--
-- The ONLY path that ever moves an AI suggestion from approved to
-- applied. Never called directly by client UPDATE -- frontend calls this
-- RPC, which:
--   1. Checks the caller's meeting.ai.apply permission.
--   2. Re-reads the CURRENT target row's updated_at and compares it to
--      target_snapshot.updated_at captured at analysis time.
--   3. On mismatch: sets status='conflict', changes nothing else, returns
--      the conflict so the UI can offer re-analyze / adjust / reject.
--   4. On match: performs the adapter-specific write and the status
--      transition to 'applied' in the SAME transaction, then writes
--      vihem_audit_events linking the meeting, the suggestion and the
--      created/changed record.
-- Adapters implemented in Phase 1: create_work_order, update_work_order,
-- add_purchase_item, update_customer_project (restricted field set --
-- status/priority/description only, no financial fields). Anything else
-- returns status='integration_unavailable' and changes nothing.

CREATE OR REPLACE FUNCTION public.apply_meeting_ai_suggestion(p_suggestion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion record;
  v_meeting record;
  v_org uuid;
  v_authorized boolean;
  v_current_updated_at timestamptz;
  v_snapshot_updated_at timestamptz;
  v_result_id uuid;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_suggestion FROM vihem_ai_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF v_suggestion IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;

  v_org := v_suggestion.organisation_id;

  IF v_suggestion.source_type = 'meeting' THEN
    SELECT * INTO v_meeting FROM vihem_meetings WHERE id = v_suggestion.source_id;
  END IF;

  v_authorized := (
    vihem_get_my_role() = 'superadmin'
    OR (v_org = vihem_get_my_org_id() AND (
      vihem_get_my_role() = 'admin'
      OR vihem_has_permission(auth.uid(), 'meeting.ai.apply')
    ))
  );

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to apply AI suggestions';
  END IF;

  IF v_suggestion.status NOT IN ('pending','approved') THEN
    RETURN jsonb_build_object('status', v_suggestion.status, 'error', 'Suggestion is not in an applicable state');
  END IF;

  v_payload := v_suggestion.payload;

  -- Conflict check: compare current target row's updated_at to the value
  -- captured in target_snapshot at analysis time. No snapshot recorded
  -- (e.g. a create-type suggestion with no pre-existing target) skips
  -- this check.
  IF v_suggestion.target_id IS NOT NULL AND v_suggestion.target_snapshot ? 'updated_at' THEN
    v_snapshot_updated_at := (v_suggestion.target_snapshot->>'updated_at')::timestamptz;
    v_current_updated_at := CASE v_suggestion.target_type
      WHEN 'work_order' THEN (SELECT updated_at FROM vihem_work_orders WHERE id = v_suggestion.target_id)
      WHEN 'customer_project' THEN (SELECT updated_at FROM vihem_customer_projects WHERE id = v_suggestion.target_id)
      ELSE NULL
    END;

    IF v_current_updated_at IS NULL THEN
      UPDATE vihem_ai_suggestions SET status = 'conflict', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_suggestion_id;
      RETURN jsonb_build_object('status', 'conflict', 'reason', 'target_missing');
    END IF;

    IF v_current_updated_at <> v_snapshot_updated_at THEN
      UPDATE vihem_ai_suggestions SET status = 'conflict', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_suggestion_id;
      RETURN jsonb_build_object('status', 'conflict', 'reason', 'target_changed', 'current_updated_at', v_current_updated_at, 'snapshot_updated_at', v_snapshot_updated_at);
    END IF;
  END IF;

  UPDATE vihem_ai_suggestions SET status = 'applying' WHERE id = p_suggestion_id;

  CASE v_suggestion.suggestion_type
    WHEN 'create_work_order' THEN
      INSERT INTO vihem_work_orders (organisation_id, title, description, category, priority, status, customer_project_id, created_by)
      VALUES (
        v_org,
        COALESCE(v_payload->>'title', 'Från möte'),
        COALESCE(v_payload->>'description', ''),
        COALESCE(v_payload->>'category', ''),
        COALESCE(v_payload->>'priority', 'normal'),
        'new',
        NULLIF(v_payload->>'customer_project_id', '')::uuid,
        auth.uid()
      )
      RETURNING id INTO v_result_id;

    WHEN 'update_work_order' THEN
      IF v_suggestion.target_id IS NULL THEN
        UPDATE vihem_ai_suggestions SET status = 'failed' WHERE id = p_suggestion_id;
        RETURN jsonb_build_object('status', 'failed', 'reason', 'no_target');
      END IF;
      UPDATE vihem_work_orders SET
        status = COALESCE(v_payload->>'status', status),
        priority = COALESCE(v_payload->>'priority', priority),
        description = COALESCE(v_payload->>'description', description)
      WHERE id = v_suggestion.target_id;
      v_result_id := v_suggestion.target_id;

    WHEN 'add_purchase_item' THEN
      INSERT INTO vihem_purchase_items (organisation_id, store_name, item_name, quantity, notes, priority, status, created_by)
      VALUES (
        v_org,
        COALESCE(v_payload->>'store_name', ''),
        COALESCE(v_payload->>'item_name', 'Från möte'),
        COALESCE(v_payload->>'quantity', ''),
        COALESCE(v_payload->>'notes', ''),
        COALESCE(v_payload->>'priority', 'normal'),
        'open',
        auth.uid()
      )
      RETURNING id INTO v_result_id;

    WHEN 'update_customer_project' THEN
      IF v_suggestion.target_id IS NULL THEN
        UPDATE vihem_ai_suggestions SET status = 'failed' WHERE id = p_suggestion_id;
        RETURN jsonb_build_object('status', 'failed', 'reason', 'no_target');
      END IF;
      -- Deliberately restricted field set -- no financial columns.
      UPDATE vihem_customer_projects SET
        status = COALESCE(v_payload->>'status', status),
        priority = COALESCE(v_payload->>'priority', priority),
        description = COALESCE(v_payload->>'description', description)
      WHERE id = v_suggestion.target_id;
      v_result_id := v_suggestion.target_id;

    ELSE
      UPDATE vihem_ai_suggestions SET status = 'integration_unavailable', reviewed_by = auth.uid(), reviewed_at = now() WHERE id = p_suggestion_id;
      RETURN jsonb_build_object('status', 'integration_unavailable');
  END CASE;

  UPDATE vihem_ai_suggestions SET status = 'applied', reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now() WHERE id = p_suggestion_id;

  INSERT INTO vihem_audit_events (organisation_id, actor_id, event_type, entity_type, entity_id, summary, metadata)
  VALUES (
    v_org, auth.uid(), 'ai_suggestion_applied', v_suggestion.suggestion_type, v_result_id,
    'AI-förslag godkänt och tillämpat: ' || v_suggestion.suggestion_type,
    jsonb_build_object('suggestion_id', p_suggestion_id, 'meeting_id', v_suggestion.source_id, 'target_type', v_suggestion.target_type, 'target_id', v_result_id)
  );

  RETURN jsonb_build_object('status', 'applied', 'result_id', v_result_id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_meeting_ai_suggestion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_meeting_ai_suggestion(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
