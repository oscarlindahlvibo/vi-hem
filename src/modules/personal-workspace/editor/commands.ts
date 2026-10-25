import type { Editor } from "@tiptap/core";
/** Insert a block without replacing selected text, then reveal its pen toolbar. */
export function insertInk(editor: Editor, at?: number) {
  const pageId = crypto.randomUUID();
  const position =
    at ??
    (editor.state.selection.$to.depth
      ? editor.state.selection.$to.after()
      : editor.state.doc.content.size);
  editor
    .chain()
    .focus()
    .insertContentAt(position, [
      { type: "ink", attrs: { pageId, paper: "lined" } },
      { type: "paragraph" },
    ])
    .run();
  requestAnimationFrame(() => {
    editor.view.dom
      .querySelector('[data-ink-page="' + pageId + '"]')
      ?.scrollIntoView({ block: "start" });
  });
}
