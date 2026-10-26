import React from "react";
import { type JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import UniqueID from "@tiptap/extension-unique-id";
import { TableKit } from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Minus,
  Table,
  PenLine,
  Undo2,
  Redo2,
  BellPlus,
  Link,
} from "lucide-react";
import { insertInk } from "./commands";
import { PrivateImage } from "./PrivateImage";
import { Ink, InkPortalHost } from "./InkNode";
export function RichEditor({
  content,
  onChange,
  onRemind,
  editorRef,
  initialBlock,
  readOnly = false,
  textTools = true,
}: {
  content: JSONContent;
  readOnly?: boolean;
  textTools?: boolean;
  onChange: (content: JSONContent, text: string) => void;
  onRemind: (text: string, blockId?: string) => void;
  initialBlock?: string;
  editorRef?: React.MutableRefObject<ReturnType<typeof useEditor> | null>;
}) {
  const [host, setHost] = React.useState<HTMLDivElement | null>(null);
  const [inkActive, setInkActive] = React.useState(false);
  const editor = useEditor({
    editable: !readOnly && textTools,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          protocols: ["https", "http", "mailto"],
          autolink: true,
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      TableKit,
      UniqueID.configure({
        types: [
          "paragraph",
          "heading",
          "listItem",
          "taskItem",
          "blockquote",
          "ink",
          "privateImage",
        ],
      }),
      Ink,
      PrivateImage,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getJSON(), editor.getText()),
    editorProps: {
      attributes: { class: "pw-prose", "aria-label": "Anteckningens innehåll" },
      handleDOMEvents: {
        drop: (_v, e) => {
          if (e.dataTransfer?.files.length) return true;
          return false;
        },
      },
    },
  });
  React.useEffect(() => {
    editor?.setEditable(!readOnly && textTools && !inkActive, false);
    if (!textTools || inkActive) editor?.commands.blur();
  }, [editor, readOnly, textTools, inkActive]);
  React.useEffect(() => {
    if (editor && initialBlock) {
      const element = editor.view.dom.querySelector(
        '[data-id="' + CSS.escape(initialBlock) + '"]',
      );
      element?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  }, [editor, initialBlock]);
  if (editorRef) editorRef.current = editor;
  if (!editor) return null;
  function inkTarget(target: EventTarget | null) {
    return target instanceof Element && !!target.closest("[data-ink-surface]");
  }
  function enterInk() {
    if (editor?.isEditable) {
      editor.setEditable(false, false);
      editor.commands.blur();
    }
    setInkActive(true);
  }
  function enterText() {
    if (!readOnly && textTools) {
      editor?.setEditable(true, false);
      setInkActive(false);
    }
  }
  const actions = [
    ["Fetstil", Bold, () => editor.chain().focus().toggleBold().run(), "bold"],
    [
      "Kursiv",
      Italic,
      () => editor.chain().focus().toggleItalic().run(),
      "italic",
    ],
    [
      "Understrykning",
      Underline,
      () => editor.chain().focus().toggleUnderline().run(),
      "underline",
    ],
    [
      "Överstrykning",
      Strikethrough,
      () => editor.chain().focus().toggleStrike().run(),
      "strike",
    ],
    [
      "Punktlista",
      List,
      () => editor.chain().focus().toggleBulletList().run(),
      "bulletList",
    ],
    [
      "Numrerad lista",
      ListOrdered,
      () => editor.chain().focus().toggleOrderedList().run(),
      "orderedList",
    ],
    [
      "Checklista",
      ListChecks,
      () => editor.chain().focus().toggleTaskList().run(),
      "taskList",
    ],
    [
      "Citat",
      Quote,
      () => editor.chain().focus().toggleBlockquote().run(),
      "blockquote",
    ],
    [
      "Kodblock",
      Code2,
      () => editor.chain().focus().toggleCodeBlock().run(),
      "codeBlock",
    ],
  ] as const;
  return (
    <InkPortalHost.Provider value={host}>
      <div
        className="pw-rich-document"
        data-writing-mode={textTools ? "mixed" : "ink"}
        onPointerOverCapture={(e) => {
          if (e.pointerType === "pen" && inkTarget(e.target)) enterInk();
        }}
        onPointerDownCapture={(e) => {
          if (inkTarget(e.target)) enterInk();
          else enterText();
        }}
      >
        {textTools && (
          <button
            type="button"
            className="pw-return-text"
            aria-pressed={!inkActive}
            disabled={readOnly}
            onClick={() => {
              enterText();
              editor?.commands.focus();
            }}
          >
            Textredigering
          </button>
        )}
        {textTools && (
          <fieldset
            disabled={readOnly}
            className="pw-text-tools"
            role="toolbar"
            aria-label="Textverktyg"
          >
            <select
              aria-label="Textformat"
              value={
                editor.isActive("heading", { level: 1 })
                  ? "1"
                  : editor.isActive("heading", { level: 2 })
                    ? "2"
                    : editor.isActive("heading", { level: 3 })
                      ? "3"
                      : "p"
              }
              onChange={(e) =>
                e.target.value === "p"
                  ? editor.chain().focus().setParagraph().run()
                  : editor
                      .chain()
                      .focus()
                      .toggleHeading({
                        level: Number(e.target.value) as 1 | 2 | 3,
                      })
                      .run()
              }
            >
              <option value="p">Brödtext</option>
              <option value="1">Rubrik 1</option>
              <option value="2">Rubrik 2</option>
              <option value="3">Rubrik 3</option>
            </select>
            {actions.map(([label, Icon, action, name]) => (
              <button
                key={name}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={editor.isActive(name)}
                onClick={action}
              >
                <Icon size={17} />
              </button>
            ))}
            <input
              type="color"
              aria-label="Textfärg"
              onChange={(e) =>
                editor.chain().focus().setColor(e.target.value).run()
              }
            />
            <button
              type="button"
              aria-label="Markera text med färg"
              aria-pressed={editor.isActive("highlight")}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .toggleHighlight({ color: "#fef08a" })
                  .run()
              }
            >
              A̲
            </button>
            <button
              type="button"
              aria-label="Infoga länk"
              onClick={() => {
                const url = window.prompt("Länk (https://…)");
                if (url && /^(https?:|mailto:)/i.test(url))
                  editor.chain().focus().setLink({ href: url }).run();
              }}
            >
              <Link size={17} />
            </button>
            <button
              type="button"
              aria-label="Infoga tabell"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              <Table size={17} />
            </button>
            <button
              type="button"
              aria-label="Infoga avdelare"
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
            >
              <Minus size={17} />
            </button>
            <button
              type="button"
              aria-label="Infoga handskriven sektion"
              onClick={() => insertInk(editor)}
            >
              <PenLine size={17} />
            </button>
            <button
              type="button"
              aria-label="Skapa påminnelse av markerad text"
              onClick={() =>
                onRemind(
                  editor.state.doc
                    .textBetween(
                      editor.state.selection.from,
                      editor.state.selection.to,
                      " ",
                    )
                    .slice(0, 500),
                  editor.state.selection.$from.parent.attrs.id as
                    | string
                    | undefined,
                )
              }
            >
              <BellPlus size={17} />
            </button>
            <button
              type="button"
              aria-label="Ångra"
              disabled={!editor.can().undo()}
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 size={17} />
            </button>
            <button
              type="button"
              aria-label="Gör om"
              disabled={!editor.can().redo()}
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 size={17} />
            </button>
          </fieldset>
        )}
        <EditorContent editor={editor} />
        <div ref={setHost} className="pw-ink-portal-host" />
      </div>
    </InkPortalHost.Provider>
  );
}
