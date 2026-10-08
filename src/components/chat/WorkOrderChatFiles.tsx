import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
export function WorkOrderChatFiles({ workOrderId }: { workOrderId: string }) {
  const [files, setFiles] = useState<
      { id: string; name: string; path: string }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void supabase
      .from("vihem_chat_workorder_files")
      .select("id,name,path")
      .eq("work_order_id", workOrderId)
      .then(({ data }) => {
        if (live) setFiles(data || []);
      });
    return () => {
      live = false;
    };
  }, [workOrderId]);
  async function download(path: string, name: string) {
    setError("");
    const { data, error } = await supabase.storage
      .from("vihem-chat-workorder-private")
      .download(path);
    if (error || !data) {
      setError("Bilagan kunde inte hämtas.");
      return;
    }
    const url = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return files.length ? (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase text-slate-500">
        Bilagor från chatt
      </p>
      {files.map((f) => (
        <button
          key={f.id}
          className="block rounded-lg border px-3 py-2 text-sm text-blue-700"
          onClick={() => void download(f.path, f.name)}
        >
          {f.name}
        </button>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  ) : null;
}
