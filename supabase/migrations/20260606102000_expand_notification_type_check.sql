ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (
    type IN (
      'info',
      'maintenance',
      'work_order',
      'chat',
      'message',
      'laundry',
      'news',
      'announcement',
      'document',
      'termination',
      'time_entry',
      'absence'
    )
  );
