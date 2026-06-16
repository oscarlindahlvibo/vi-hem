# VI-HEM shared Supabase deployment rules

VI-HEM can run against a Supabase instance shared with other apps. Keep these
rules in the deployment script so app resources do not collide.

## Production migration filtering

Do not run local/demo-only migrations in production. Also skip migrations that
only create legacy unprefixed shared resources now replaced by VI-HEM-prefixed
resources. The list is maintained in:

```text
supabase/production-migration-skip.txt
```

Those migrations either create/clean up known demo users with fixed
UUIDs/passwords, or create old unprefixed storage resources that the app no
longer uses.

## Edge functions

Deploy only app-prefixed VI-HEM functions:

```text
vihem-admin-reset-password
vihem-admin-send-password-reset
vihem-admin-update-user
vihem-create-user
vihem-export-short-stay-ical
vihem-sync-short-stay-ical
```

Local/demo tooling lives outside `supabase/functions`:

```text
supabase/local-functions/vihem-setup-demo-users
```

Do not copy or deploy `supabase/local-functions` in production.

## Storage buckets

Frontend uploads use app-prefixed buckets:

```text
vihem-inspection-photos
vihem-work-order-attachments
```

The migration `20260616090000_vihem_namespace_shared_resources.sql` creates the
buckets and policies, and removes old unprefixed VI-HEM buckets if they exist.

## Auth and roles

Supabase `auth.users` is the shared identity table. Supabase must generate user
UUIDs. VI-HEM permissions live in VI-HEM tables (`vihem_profiles`,
`vihem_organisations`, etc.). Other apps must not reuse VI-HEM table names for
their own profiles, roles or admin lists.

For new VI-HEM database helpers, use the `vihem_` prefix. This migration adds:

```text
vihem_get_my_role()
vihem_get_my_org_id()
vihem_is_admin()
vihem_is_staff()
```

## Frontend environment

Build with only public browser-safe values:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend builds.
