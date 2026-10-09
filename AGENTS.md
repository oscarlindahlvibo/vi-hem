# VI-HEM development

For UI work, read `docs/premium/designsystem.md`, `docs/premium/PLAN.md` and `docs/premium/kontrollpunkter.md` before changing shared controls or module layouts.

- Reuse `src/components/ui.tsx`, `DialogSurface` and the shared `Avatar`; use central semantic tokens. Preserve VI-HEM's identity, permissions and business workflows.
- Review each changed list/detail/form/dialog at relevant mobile, iPad and desktop widths. Shared CSS and a passing build do not establish module completion. Record actual tests and unverified scenarios.
- Do not expose profile photos or chat attachments through public buckets. Preserve older references until a verified migration is ready.
- Keep UI work on a separate branch. Fetch and review remote changes before pushing; other developers work on main. Production deployment is manual and must not be inferred from a branch push.
- Preserve a clear checkpoint for the ongoing system-wide premium project. Do not mark the whole project complete after improving only reference views.
