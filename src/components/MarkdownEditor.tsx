/**
 * MarkdownEditor.tsx — Editor Markdown para el contexto descriptivo de cada votación.
 *
 * Idéntico al editor de notas de VerificASO (`aso-portal`):
 * - MDXEditor con toggle nativo vista rica ↔ código fuente Markdown (`diffSourcePlugin` + `DiffSourceToggleWrapper`).
 * - Sincroniza el valor con un `<input type="hidden">` para integrarse con `FormData`.
 * - Expone `window.__mdEditors[id] = { setValue }` para precargar texto al editar una votación existente.
 */
import { useEffect, useRef, useState } from "react";
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  markdownShortcutPlugin,
  diffSourcePlugin,
  DiffSourceToggleWrapper,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  ListsToggle,
  Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";

interface Props {
  name: string;
  id: string;
  initial?: string;
}

export default function MarkdownEditor({ name, id, initial = "" }: Props) {
  const [value, setValue] = useState(initial);
  const editorRef = useRef<MDXEditorMethods>(null);

  useEffect(() => {
    const w = window as unknown as {
      __mdEditors?: Record<string, { setValue: (v: string) => void }>;
    };
    w.__mdEditors = w.__mdEditors || {};
    w.__mdEditors[id] = {
      setValue: (v: string) => {
        setValue(v ?? "");
        editorRef.current?.setMarkdown(v ?? "");
      },
    };
    return () => {
      if (w.__mdEditors) delete w.__mdEditors[id];
    };
  }, [id]);

  return (
    <div className="mdx-editor">
      <input type="hidden" name={name} id={id} value={value} readOnly />
      <MDXEditor
        ref={editorRef}
        markdown={value}
        onChange={setValue}
        contentEditableClassName="mdx-content"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin({ imageUploadHandler: null }),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: "rich-text" }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper options={["rich-text", "source"]}>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertImage />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
}
