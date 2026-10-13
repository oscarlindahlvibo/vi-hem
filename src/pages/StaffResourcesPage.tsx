import { ResourceWorkspace } from "../components/resources/ResourceWorkspace";
import { PageHeader } from "../components/ui";
export function StaffResourcesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Material & utrustning"
        subtitle="Planera arbetet, hämta material och förboka utrustning."
      />
      <ResourceWorkspace />
    </div>
  );
}
