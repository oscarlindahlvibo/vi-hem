import type { Note, Stroke } from "../types";
export function exportPortable(note: Note, strokes: Stroke[]) {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: "vihem-personal-workspace",
          version: 1,
          note,
          strokes,
          exported_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    ],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download =
    (note.title || "Anteckning").replace(/[^\p{L}\p{N} _-]/gu, "") +
    ".vihem.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function printNote(title: string, element: HTMLElement) {
  const win = window.open("", "_blank");
  if (!win) throw Error("Tillåt popupfönster för PDF-export.");
  const heading = win.document.createElement("h1");
  heading.textContent = title || "Utan titel";
  win.document.title = title || "Anteckning";
  const style = win.document.createElement("style");
  style.textContent =
    "@page{size:A4;margin:16mm}body{font:12pt system-ui;color:#172b49}h1{font-size:24pt}h2{font-size:20pt}h3{font-size:16pt}svg{display:block;width:auto;height:auto;max-width:100%;max-height:205mm;break-inside:avoid;margin:12px 0}.pw-ink-node{break-inside:avoid}p{orphans:2;widows:2}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px}.pw-ink-tools,.pw-hint{display:none}blockquote{border-left:3px solid #ccc;padding-left:16px}ul[data-type=taskList]{list-style:none}pre{white-space:pre-wrap}img{max-width:100%}.pw-paper-scroll{overflow:visible}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}";
  win.document.head.append(style);
  const copy = element.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(
      ".pw-text-tools,.pw-ink-tools,.pw-hint,.ProseMirror-gapcursor",
    )
    .forEach((item) => item.remove());
  copy
    .querySelectorAll(".pw-paper")
    .forEach((item) => item.removeAttribute("style"));
  copy
    .querySelectorAll("[contenteditable]")
    .forEach((item) => item.removeAttribute("contenteditable"));
  win.document.body.append(heading, copy);
  const files = element.parentElement?.querySelectorAll(".pw-file");
  if (files?.length) {
    const label = win.document.createElement("h2");
    label.textContent = "Bilagor";
    const list = win.document.createElement("ul");
    files.forEach((file) => {
      const item = win.document.createElement("li");
      item.textContent = file.querySelector("button")?.textContent || "";
      list.append(item);
    });
    const hint = win.document.createElement("p");
    hint.textContent = "Originalfilerna bifogas inte i denna PDF.";
    win.document.body.append(label, list, hint);
  }
  void Promise.all(
    Array.from(win.document.images).map((image) =>
      image.decode().catch(() => {}),
    ),
  ).then(() => {
    win.focus();
    win.print();
  });
}
