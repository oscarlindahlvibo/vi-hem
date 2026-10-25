import React, { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { supabase } from "../../../lib/supabase";
function ImageView({ node }: NodeViewProps) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const { data: a, error } = await supabase
          .from("vihem_personal_attachments")
          .select("storage_path,mime")
          .eq("id", node.attrs.attachmentId)
          .single();
        if (error || !a?.mime.startsWith("image/"))
          throw Error("Bilden saknas");
        const { data, error: e } = await supabase.storage
          .from("vihem-personal")
          .createSignedUrl(a.storage_path, 900);
        if (e) throw e;
        if (live) {
          setUrl(data.signedUrl);
          setError(false);
        }
      } catch {
        if (live) setError(true);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 840000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [node.attrs.attachmentId]);
  return (
    <NodeViewWrapper
      as="figure"
      className="pw-private-image"
      contentEditable={false}
    >
      {url && !error ? (
        <img
          src={url}
          alt={node.attrs.name || "Bifogad bild"}
          onError={() => setError(true)}
        />
      ) : (
        <p className="pw-hint">
          {error
            ? "Bilden kan inte hämtas. Kontrollera anslutningen och att bilagan finns kvar."
            : "Hämtar privat bild…"}
        </p>
      )}
      <figcaption>{node.attrs.name}</figcaption>
    </NodeViewWrapper>
  );
}
export const PrivateImage = Node.create({
  name: "privateImage",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { attachmentId: { default: null }, name: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "figure[data-private-image]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-private-image": "true" }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
