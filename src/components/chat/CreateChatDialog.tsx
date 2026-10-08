import type { Dispatch, SetStateAction } from "react";
import { Avatar, Button, Input, Modal } from "../ui";
type Person = { id: string; name: string; role: string };
type Props = {
  open: boolean;
  onClose: () => void;
  staff: boolean;
  busy: boolean;
  kind: string;
  setKind: (kind: string) => void;
  recipients: string[];
  setRecipients: Dispatch<SetStateAction<string[]>>;
  peopleSearch: string;
  setPeopleSearch: (query: string) => void;
  filteredPeople: Person[];
  title: string;
  setTitle: (title: string) => void;
  create: () => Promise<void>;
};
export function CreateChatDialog({
  open,
  onClose,
  staff,
  busy,
  kind,
  setKind,
  recipients,
  setRecipients,
  peopleSearch,
  setPeopleSearch,
  filteredPeople,
  title,
  setTitle,
  create,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={staff ? "Ny chatt" : "Fastighetskontoret"}
    >
      <div className="space-y-4">
        {kind === "group" && (
          <p className="text-xs text-slate-500">
            Inbjudna deltagare kan se varandras namn och gruppens meddelanden.
          </p>
        )}
        {staff && (
          <>
            <div className="flex flex-wrap gap-2">
              {[
                ["direct", "Personal"],
                ["tenant_support", "Hyresgäst"],
                ["group", "Grupp"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  disabled={busy}
                  variant={kind === value ? "primary" : "secondary"}
                  onClick={() => {
                    setKind(value);
                    setRecipients([]);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Input
              label="Sök person"
              value={peopleSearch}
              onChange={(e) => setPeopleSearch(e.target.value)}
            />
            <div className="max-h-60 overflow-y-auto">
              {filteredPeople.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg p-3 hover:bg-slate-50"
                >
                  <input
                    type={kind === "group" ? "checkbox" : "radio"}
                    checked={recipients.includes(p.id)}
                    onChange={() =>
                      setRecipients((ids) =>
                        kind !== "group"
                          ? [p.id]
                          : ids.includes(p.id)
                            ? ids.filter((id) => id !== p.id)
                            : [...ids, p.id],
                      )
                    }
                  />
                  <Avatar size="sm" name={p.name} />
                  <span>
                    {p.name}
                    <small className="ml-2 text-slate-400">
                      {p.role === "tenant" ? "Hyresgäst" : "Personal"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {(kind === "group" || !staff) && (
          <Input
            label={kind === "group" ? "Gruppnamn" : "Ämne (valfritt)"}
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <Button
          loading={busy}
          disabled={
            staff && (!recipients.length || (kind === "group" && !title.trim()))
          }
          onClick={() => void create()}
        >
          Öppna chatt
        </Button>
      </div>
    </Modal>
  );
}
