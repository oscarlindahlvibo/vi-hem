import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { RichEditor } from "../../../src/modules/personal-workspace/editor/RichEditor";
import { InkContext } from "../../../src/modules/personal-workspace/handwriting/InkPaper";
import type {
  Note,
  Stroke,
} from "../../../src/modules/personal-workspace/types";
import { newNote } from "../../../src/modules/personal-workspace/types";
import {
  records,
  removeLocal,
} from "../../../src/modules/personal-workspace/services/local";
import {
  saveDraft,
  saveInk,
} from "../../../src/modules/personal-workspace/services/repository";
import { printableNote } from "../../../src/modules/personal-workspace/services/export";
import "../../../src/index.css";
import "../../../src/modules/personal-workspace/workspace.css";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  page = "33333333-3333-4333-8333-333333333333";
const original: Note = {
  ...newNote(owner),
  id,
  title: "Handskriftsprov",
  mode: "mixed",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Text ovanför handskriften." }],
      },
      { type: "ink", attrs: { pageId: page, paper: "lined" } },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Text under handskriften." }],
      },
    ],
  },
};
const seed: Stroke = {
  id: "44444444-4444-4444-8444-444444444444",
  note_id: id,
  page_id: page,
  stroke: {
    points: [
      { x: 460, y: 140, p: 0.6 },
      { x: 480, y: 150, p: 0.7 },
    ],
    color: "#172b49",
    width: 3,
    tool: "pen",
  },
  deleted: false,
  revision: 1,
};
const wait = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
function check(ok: unknown, message: string) {
  if (!ok) throw Error(message);
}
export function InkQA() {
  const [note, setNote] = useState(original),
    [strokes, setStrokes] = useState<Stroke[]>([seed]),
    [generation, setGeneration] = useState(0),
    [inkOnly, setInkOnly] = useState(false),
    [report, setReport] = useState(
      "Redo. Testerna använder endast lokal testdata.",
    ),
    [busy, setBusy] = useState(false);
  const editor = useRef<Editor | null>(null),
    latest = useRef({ note, strokes }),
    writes = useRef(Promise.resolve());
  latest.current = { note, strokes };
  const persist = (next: Note) => {
    latest.current.note = next;
    setNote(next);
    writes.current = writes.current.then(() => saveDraft(next)).then(() => {});
  };
  function change(changes: Stroke[]) {
    const next = [
      ...latest.current.strokes.filter(
        (s) => !changes.some((c) => c.id === s.id),
      ),
      ...changes,
    ];
    latest.current.strokes = next;
    setStrokes(next);
    writes.current = writes.current.then(async () => {
      for (const s of changes) await saveInk(owner, s);
    });
  }
  async function reopen() {
    await writes.current;
    const drafts = await records("notes", owner),
      ink = await records("ink", owner);
    const saved = drafts.find((x) => "note" in x && x.note.id === id);
    if (saved && "note" in saved) setNote(saved.note);
    setStrokes(
      ink
        .filter((x) => "value" in x && x.value.note_id === id)
        .map((x) => ("value" in x ? x.value : seed)),
    );
    setGeneration((n) => n + 1);
    await wait();
  }
  async function tests() {
    setBusy(true);
    setReport("Kör realistiska PointerEvent-/SVG-/IndexedDB-prov…");
    const passed: string[] = [];
    try {
      await writes.current;
      for (const d of await records("notes", owner))
        if ("note" in d && d.note.id === id) await removeLocal("notes", d.key);
      for (const d of await records("ink", owner))
        if ("value" in d && d.value.note_id === id)
          await removeLocal("ink", d.key);
      latest.current = { note: original, strokes: [seed] };
      setNote(original);
      setStrokes([seed]);
      setInkOnly(false);
      setGeneration((n) => n + 1);
      await saveDraft(original);
      await saveInk(owner, seed);
      await wait();
      await wait();
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Hela sidan")!
        .click();
      await wait();
      const ed = editor.current!;
      let transactions = 0;
      const track = ({
        transaction,
      }: {
        transaction: { docChanged: boolean };
      }) => {
        if (transaction.docChanged) transactions++;
      };
      ed.on("transaction", track);
      const svg = () => document.querySelector<SVGSVGElement>("svg.pw-paper")!,
        camera = () => svg().querySelector<SVGGElement>("[data-ink-camera]")!,
        bg = svg().querySelector("[data-ink-background]")!;
      check(
        svg() && !svg().closest('[contenteditable="true"]'),
        "Paper must have no editable ancestor",
      );
      check(
        !svg().querySelector("pattern"),
        "Background must not use pattern references",
      );
      function dispatch(
        type: string,
        pointerId: number,
        x: number,
        y: number,
        pointerType = "pen",
      ) {
        const m = camera().getScreenCTM()!;
        const event = new PointerEvent(type, {
          pointerId,
          pointerType,
          clientX: m.a * x + m.c * y + m.e,
          clientY: m.b * x + m.d * y + m.f,
          pressure: 0.6,
          buttons: type === "pointerup" ? 0 : 1,
          bubbles: true,
          cancelable: true,
        });
        svg().dispatchEvent(event);
      }
      const count = () =>
        latest.current.strokes.filter((s) => !s.deleted).length;
      const before = count();
      dispatch("pointerdown", 10, 120, 160);
      dispatch("pointermove", 10, 130, 170);
      await wait();
      check(
        !!svg().querySelector("[data-ink-preview]"),
        "Stroke preview must be immediate",
      );
      dispatch("pointerup", 10, 140, 180);
      await wait();
      check(count() === before + 1, "Finished stroke persists");
      check(
        bg === svg().querySelector("[data-ink-background]"),
        "Paper DOM remains stable during drawing",
      );
      check(
        transactions === 0,
        "Pen events must not cause Tiptap document transactions",
      );
      passed.push("pen, preview, stable paper, zero editor transactions");
      for (let row = 0; row < 3; row++) {
        const pointer = 1000 + row;
        dispatch("pointerdown", pointer, 160, 100 + row * 48);
        for (let x = 0; x < 12; x++)
          dispatch(
            "pointermove",
            pointer,
            160 + x * 8,
            100 + row * 48 + (x % 2) * 14,
          );
        dispatch("pointerup", pointer, 256, 100 + row * 48);
        await wait();
        check(
          bg === svg().querySelector("[data-ink-background]"),
          "Lined paper stays during multi-line writing",
        );
      }
      passed.push("continuous multi-line pen writing");
      const saved = count();
      dispatch("pointerdown", 11, 120, 160);
      dispatch("pointermove", 11, 150, 180);
      dispatch("pointercancel", 11, 150, 180);
      await wait();
      check(
        count() === saved && !svg().querySelector("[data-ink-preview]"),
        "pointercancel discards unfinished stroke",
      );
      dispatch("pointerdown", 12, 120, 160);
      dispatch("lostpointercapture", 12, 120, 160);
      await wait();
      check(count() === saved, "lost capture cancels");
      passed.push("cancel and lost capture");
      const transform = camera().getAttribute("transform");
      dispatch("pointerdown", 13, 150, 220);
      dispatch("pointerdown", 21, 200, 250, "touch");
      dispatch("pointermove", 21, 230, 280, "touch");
      dispatch("pointermove", 13, 165, 230);
      dispatch("pointerup", 13, 170, 240);
      dispatch("pointerup", 21, 230, 280, "touch");
      await wait();
      check(count() === saved + 1, "Palm must not steal live pen");
      check(
        camera().getAttribute("transform") === transform,
        "Palm must not pan",
      );
      passed.push("pen priority over palm contact");
      function touch(type: string, pointerId: number, x: number, y: number) {
        const m = svg().getScreenCTM()!;
        svg().dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType: "touch",
            clientX: m.a * x + m.c * y + m.e,
            clientY: m.b * x + m.d * y + m.f,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      touch("pointerdown", 30, 100, 100);
      touch("pointermove", 30, 125, 135);
      await wait();
      check(
        camera().getAttribute("transform") !== transform,
        "One finger pans",
      );
      touch("pointerdown", 31, 220, 135);
      touch("pointermove", 31, 290, 160);
      await wait();
      const pinched = camera().getAttribute("transform");
      touch("pointerup", 31, 290, 160);
      touch("pointerup", 30, 125, 135);
      await wait();
      check(
        pinched !== transform && count() === saved + 1,
        "Two fingers zoom without ink",
      );
      passed.push("finger pan and two-finger pinch");
      function input(label: string, value: string) {
        const el = document.querySelector<HTMLInputElement>(
          'input[aria-label="' + label + '"]',
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Hela sidan")!
        .click();
      await wait();
      for (const z of [50, 100, 200, 300]) {
        input("Dokumentzoom", String(z));
        await wait();
        const n = count();
        const rect = svg().getBoundingClientRect(),
          m = camera().getScreenCTM()!.inverse();
        const sx = rect.left + rect.width / 2,
          sy = rect.top + rect.height / 2;
        const at = {
          x: m.a * sx + m.c * sy + m.e,
          y: m.b * sx + m.d * sy + m.f,
        };
        dispatch("pointerdown", 40 + z, at.x, at.y);
        dispatch("pointerup", 40 + z, at.x + 2, at.y + 2);
        await wait();
        const last = latest.current.strokes[latest.current.strokes.length - 1];
        check(
          count() === n + 1 &&
            Math.abs(last.stroke.points[0].x - at.x) < 0.01 &&
            Math.abs(last.stroke.points[0].y - at.y) < 0.01,
          "CTM pen alignment at " + z + "%",
        );
      }
      check(
        bg === svg().querySelector("[data-ink-background]"),
        "Zoom preserves paper DOM",
      );
      const viewport = svg().parentElement!,
        center = svg().getBoundingClientRect();
      const beforeWheel = camera().getAttribute("transform");
      const wheel = new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey: true,
        clientX: center.left + center.width / 2,
        clientY: center.top + center.height / 2,
        bubbles: true,
        cancelable: true,
      });
      viewport.dispatchEvent(wheel);
      await wait();
      check(
        wheel.defaultPrevented &&
          camera().getAttribute("transform") !== beforeWheel,
        "Document wheel zoom prevents page zoom",
      );
      viewport.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "0",
          bubbles: true,
          cancelable: true,
        }),
      );
      await wait();
      check(
        Math.abs(camera().getScreenCTM()!.a - svg().getScreenCTM()!.a) < 0.001,
        "Keyboard 0 restores 100%",
      );
      passed.push("wheel and keyboard zoom");

      passed.push("CTM coordinates at 50/100/200/300%");
      const details =
        document.querySelector<HTMLDetailsElement>(".pw-paper-options")!;
      details.open = true;
      input("Linje- eller rutavstånd", "48");
      input("Linjefärg", "#56789a");
      input("Linjestyrka", "80");
      await wait();
      check(
        latest.current.note.content.content?.find((n) => n.type === "ink")
          ?.attrs?.spacing === 48,
        "Spacing persisted as node attribute",
      );
      check(
        svg()
          .querySelector("[data-ink-background] g")
          ?.getAttribute("stroke") === "#56789a",
        "Background uses saved line color",
      );
      details.open = false;
      input("Pennfärg", "#dc2626");
      await wait();
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Hela sidan")!
        .click();
      await wait();
      dispatch("pointerdown", 901, 180, 310);
      dispatch("pointermove", 901, 230, 320);
      dispatch("pointerup", 901, 260, 310);
      await wait();
      check(
        latest.current.strokes[latest.current.strokes.length - 1].stroke
          .color === "#dc2626" &&
          bg === svg().querySelector("[data-ink-background]"),
        "Pen color and more writing preserve paper",
      );
      passed.push("paper spacing/color/opacity saved in ink attributes");
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent === "Hela sidan")!
        .click();
      await wait();
      document
        .querySelector<HTMLButtonElement>('button[aria-label="Sudda streck"]')!
        .click();
      await wait();
      const n = count();
      dispatch("pointerdown", 90, 465, 142);
      dispatch("pointerup", 90, 465, 142);
      await wait();
      check(count() < n, "Eraser deletes existing vector");
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Ångra pennstreck"]',
        )!
        .click();
      await wait();
      check(count() === n, "Undo restores vector");
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Gör om pennstreck"]',
        )!
        .click();
      await wait();
      check(count() < n, "Redo reapplies delete");
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Ångra pennstreck"]',
        )!
        .click();
      await wait();
      passed.push("erase, undo and redo");
      const copy = printableNote(
        document.querySelector<HTMLElement>(".pw-rich-document")!,
      );
      check(
        copy.querySelector("[data-ink-slot] [data-ink-background]"),
        "Print restores paper in document order",
      );
      check(
        !copy.querySelector("[data-ink-camera]")?.hasAttribute("transform"),
        "Print removes camera zoom",
      );
      check(
        !copy.querySelector(".pw-ink-portal-host"),
        "Print has no overlay duplication",
      );
      passed.push("export layout retains background/vectors");
      ed.off("transaction", track);
      await writes.current;
      const normalize = (values: Stroke[]) =>
        JSON.stringify([...values].sort((a, b) => a.id.localeCompare(b.id)));
      const old = normalize(latest.current.strokes);
      await reopen();
      await wait();
      check(
        normalize(latest.current.strokes) === old,
        "Vector storage survives reopening",
      );
      check(
        editor.current?.getJSON().content?.find((n) => n.type === "ink")?.attrs
          ?.spacing === 48,
        "Paper settings survive reopening",
      );
      check(
        editor.current?.getText().includes("Text under handskriften."),
        "Combined text is preserved",
      );
      passed.push(
        "real IndexedDB save/reopen, legacy vectors and combined text",
      );
      setInkOnly(true);
      await wait();
      check(
        editor.current?.view.dom.getAttribute("contenteditable") === "false",
        "Handwriting mode disables text editor",
      );
      check(
        !svg().closest('[contenteditable="true"]'),
        "Isolated paper in handwriting mode",
      );
      passed.push("handwriting editor is not editable");
      setInkOnly(false);
      await wait();
      document.querySelector<HTMLButtonElement>(".pw-return-text")!.click();
      await wait();
      check(
        editor.current?.isEditable,
        "Explicit text button restores combined text editing",
      );
      passed.push("explicit keyboard reactivation for mixed documents");

      setReport(
        "PASS\n" +
          passed.join("\n") +
          "\nFysisk Apple Pencil/Scribble, Safari och Capacitor återstår.",
      );
    } catch (error) {
      setReport("FAIL: " + String(error) + "\nPassed: " + passed.join(", "));
    } finally {
      setBusy(false);
    }
  }
  if (!import.meta.env.DEV) throw Error("Local QA only");
  return (
    <main className="pw-root" style={{ padding: 18 }}>
      <h1>Handskrift · isolerat integrationsprov</h1>
      <p>
        Ingen produktionsdata eller backend används. Vektorlagring går till
        riktig IndexedDB.
      </p>
      <div className="flex flex-wrap gap-3 my-4">
        <button disabled={busy} onClick={() => void tests()}>
          Kör ritprov
        </button>
        <button onClick={() => setInkOnly((v) => !v)}>
          {inkOnly ? "Visa textverktyg" : "Handskriftsläge"}
        </button>
        <button onClick={() => void reopen()}>Öppna igen</button>
      </div>
      <pre role="status" style={{ whiteSpace: "pre-wrap" }}>
        {report}
      </pre>
      <InkContext.Provider
        value={{ noteId: id, strokes, change, preferencesKey: owner }}
      >
        <RichEditor
          key={generation}
          content={note.content}
          editorRef={editor}
          textTools={!inkOnly}
          onChange={(content, plain_text) =>
            persist({ ...latest.current.note, content, plain_text })
          }
          onRemind={() => {}}
        />
      </InkContext.Provider>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<InkQA />);
