import { useState } from "react";
import { Package } from "lucide-react";
import { Button, Modal } from "../ui";
import { ResourceWorkspace } from "./ResourceWorkspace";
export function WorkOrderResources({ workOrderId }: { workOrderId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 py-4">
        <div className="flex items-start gap-3">
          <Package size={20} className="mt-1 shrink-0 text-blue-600" />
          <div>
            <h3 className="font-semibold">Material & utrustning</h3>
            <p className="mt-1 text-sm text-slate-500">
              Hämta material, boka maskiner och följ orderns uttag.
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Öppna arbetsuttag
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Arbetsorderns material & utrustning"
        size="xl"
        mobileFullscreen
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Stäng
          </Button>
        }
      >
        <ResourceWorkspace key={workOrderId} workOrderId={workOrderId} />
      </Modal>
    </>
  );
}
