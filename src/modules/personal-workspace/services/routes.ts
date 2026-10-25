/** Safe cold-start/hash routing; data access is independently enforced by RLS. */
export function workspacePath(hash: string): string | null {
  const path = hash.replace(/^#\/?/, "");
  const uuid =
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  return new RegExp(
    "^personal-workspace(?:/(?:notes|reminders)(?:/" +
      uuid +
      "(?:/" +
      uuid +
      ")?)?)?$",
  ).test(path)
    ? path
    : null;
}
export function workspaceStart(hash: string, role: string): string {
  return (
    (["staff", "admin", "superadmin"].includes(role) && workspacePath(hash)) ||
    (role === "superadmin" ? "admin-organisations" : "dashboard")
  );
}
