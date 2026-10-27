import { useState } from "react";
import { Button, Input, Modal, Select } from "../../../components/ui";
export interface Field {
  key: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
}
export function SnowForm({
  title,
  fields,
  initial,
  onSave,
  onClose,
  busy,
}: {
  title: string;
  fields: Field[];
  initial?: Record<string, string>;
  onSave: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void;
  busy: boolean;
}) {
  const [values, setValues] = useState(initial || {}),
    [error, setError] = useState("");
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
      size="lg"
      mobileFullscreen
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Avbryt
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setError("");
              if (fields.some((f) => f.required && !values[f.key]?.trim())) {
                setError("Fyll i de obligatoriska uppgifterna.");
                return;
              }
              void onSave(values)
                .then(onClose)
                .catch((e) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : typeof e === "object" && e && "message" in e
                        ? String(e.message)
                        : "Ändringen kunde inte bekräftas.",
                  ),
                );
            }}
          >
            Spara
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {fields.map((f) =>
          f.options ? (
            <Select
              key={f.key}
              label={f.label}
              value={values[f.key] || ""}
              options={f.options}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            />
          ) : (
            <Input
              key={f.key}
              label={f.label}
              type={f.type || "text"}
              value={values[f.key] || ""}
              required={f.required}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            />
          ),
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
