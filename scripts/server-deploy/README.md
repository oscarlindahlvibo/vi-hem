# Shared server deploy script

Server: `/home/vibo/deploy_multi_app.sh` with both Python helpers beside it. Run as `vibo` without sudo on the whole script. Privileged ownership/publication steps request sudo separately.

Repairs ownership only within build outputs, rejects escaping paths/symlinks and root-run npm. VI-HEM pulls main first, requires clean checkout, rejects downgrades and checks changed migrations/Edge Functions against installed backend. New backend dependencies must be installed separately. General migration/function sync preserves VI-HEM and its protected shared helpers.

VI-HEM uses restricted build/pinned app URL, provenance checks, backup, retained old chunks, index-last publication and HTTP checks with rollback. `--skip-vihem` leaves its frontend unchanged.

2026-10-11: syntax/server dry-run PASS; actual preflight on main 4d7846b + installed ledger/functions PASS; old checkout rejected. Local mocked-HTTP publisher tests: success, backup, old chunks and rollback PASS. Six files overwritten by earlier failed script runs restored from verified 585b822 package with backups. No database changes or general deployment performed. Original script saved as `deploy_multi_app.sh.before-vihem-fix-20261011T144528Z`.

Other apps retain existing deployment/migrations/restart behavior; their future changes are not verified by this patch. Preview: `--dry-run --skip-migrations --no-restart`.

Follow-up: nested Ekängen node_modules was also root-owned. Ownership preflight now covers each app's root dependency directory and nested Ekängen/Viborent dependencies before npm. Normal .bin symlinks are not followed by recursive ownership repair; symlinked dependency roots are rejected. Server dry-run identified exact failing directory; symlink-root rejection test and Bash syntax PASS. No deployment triggered by this patch.
