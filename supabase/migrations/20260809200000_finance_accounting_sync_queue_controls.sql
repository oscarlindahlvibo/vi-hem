-- Manual controls for the accounting sync queue until provider adapters are connected.

CREATE OR REPLACE FUNCTION public.vihem_update_accounting_sync_queue_status(
  target_queue_id uuid,
  target_status text,
  target_external_id text DEFAULT '',
  target_error_message text DEFAULT ''
)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queue_record public.vihem_accounting_sync_queue%ROWTYPE;
BEGIN
  IF target_status NOT IN ('queued', 'processing', 'synced', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Ogiltig status för bokföringssynk.';
  END IF;

  SELECT *
  INTO queue_record
  FROM public.vihem_accounting_sync_queue
  WHERE id = target_queue_id
  FOR UPDATE;

  IF queue_record.id IS NULL THEN
    RAISE EXCEPTION 'Köposten hittades inte.';
  END IF;

  IF public.vihem_get_my_role() <> 'superadmin'
    AND NOT public.vihem_user_has_company_access(queue_record.company_id, 'bookkeeper') THEN
    RAISE EXCEPTION 'Saknar behörighet att hantera bokföringskön.';
  END IF;

  UPDATE public.vihem_accounting_sync_queue
  SET
    status = target_status,
    external_id = CASE
      WHEN target_external_id <> '' THEN target_external_id
      ELSE external_id
    END,
    error_message = CASE
      WHEN target_status = 'failed' THEN COALESCE(NULLIF(target_error_message, ''), 'Manuellt markerad som misslyckad')
      WHEN target_status IN ('queued', 'processing', 'synced', 'cancelled') THEN ''
      ELSE error_message
    END,
    attempts = CASE
      WHEN target_status = 'processing' THEN attempts + 1
      ELSE attempts
    END,
    last_attempt_at = CASE
      WHEN target_status IN ('processing', 'failed', 'synced') THEN now()
      ELSE last_attempt_at
    END,
    synced_at = CASE
      WHEN target_status = 'synced' THEN now()
      WHEN target_status = 'queued' THEN NULL
      ELSE synced_at
    END,
    updated_at = now()
  WHERE id = target_queue_id
  RETURNING * INTO queue_record;

  IF queue_record.entity_type = 'invoice' THEN
    UPDATE public.vihem_invoices
    SET accounting_status = CASE
      WHEN target_status = 'synced' THEN 'synced'
      WHEN target_status = 'failed' THEN 'failed'
      WHEN target_status IN ('queued', 'processing') THEN 'pending'
      ELSE accounting_status
    END
    WHERE id = queue_record.entity_id;
  END IF;

  RETURN queue_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.vihem_retry_accounting_sync_queue(target_queue_id uuid)
RETURNS public.vihem_accounting_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.vihem_update_accounting_sync_queue_status(
    target_queue_id,
    'queued',
    '',
    ''
  );
END;
$$;
