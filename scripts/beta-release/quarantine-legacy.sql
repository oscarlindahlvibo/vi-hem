-- Approval required. Temporary beta privacy quarantine, no file/row deletion.
-- Install after premium migrations; service-role recovery/copy remains possible.
BEGIN;
UPDATE storage.buckets SET public=false WHERE id IN
 ('vihem-chat-attachments','vihem-inspection-photos','vihem-work-order-attachments','vihem-fleet-images','vihem-fleet-documents');
DROP POLICY IF EXISTS vihem_beta_legacy_quarantine ON storage.objects;
CREATE POLICY vihem_beta_legacy_quarantine ON storage.objects AS RESTRICTIVE
 FOR ALL TO public
 USING (bucket_id NOT IN ('vihem-chat-attachments','vihem-inspection-photos','vihem-work-order-attachments','vihem-fleet-images','vihem-fleet-documents'))
 WITH CHECK (bucket_id NOT IN ('vihem-chat-attachments','vihem-inspection-photos','vihem-work-order-attachments','vihem-fleet-images','vihem-fleet-documents'));
COMMIT;
-- Do not remove this policy until permission-checked reads and reference migration
-- have been verified. Rolling back frontend must not reopen public access.
