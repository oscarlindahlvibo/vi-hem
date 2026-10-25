import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
/** Revalidate at transport time: a queued push may outlive a snooze/cancellation. */
export async function personalReminderPush(
  db: SupabaseClient,
  notification: { id: string; user_id: string; link: string | null },
) {
  if (!notification.link?.startsWith("personal-workspace/reminders/"))
    return null;
  const id = notification.link.split("/")[2];
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) return { skip: true, message: "" };
  const { data: r, error } = await db
    .from("vihem_personal_reminders")
    .select(
      "id,owner_id,title,due_at,note_id,preview,completed_at,cancelled_at",
    )
    .eq("id", id)
    .eq("owner_id", notification.user_id)
    .maybeSingle();
  if (error) throw error;
  if (
    !r ||
    r.completed_at ||
    r.cancelled_at ||
    Date.parse(r.due_at) > Date.now()
  )
    return { skip: true, message: "" };
  const { data: d, error: deliveryError } = await db
    .from("vihem_personal_reminder_deliveries")
    .select("id")
    .eq("reminder_id", id)
    .eq("notification_id", notification.id)
    .eq("due_at", r.due_at)
    .maybeSingle();
  if (deliveryError) throw deliveryError;
  if (!d) return { skip: true, message: "" };
  const { data: p, error: profileError } = await db
    .from("vihem_profiles")
    .select("active,role")
    .eq("id", notification.user_id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!p?.active || !["staff", "admin", "superadmin"].includes(p.role))
    return { skip: true, message: "" };
  if (r.note_id) {
    const { data: n, error: noteError } = await db
      .from("vihem_personal_notes")
      .select("deleted_at")
      .eq("id", r.note_id)
      .eq("owner_id", notification.user_id)
      .maybeSingle();
    if (noteError) throw noteError;
    if (!n || n.deleted_at) return { skip: true, message: "" };
  }
  return {
    skip: false,
    message: r.preview ? r.title : "Du har en personlig påminnelse.",
  };
}
