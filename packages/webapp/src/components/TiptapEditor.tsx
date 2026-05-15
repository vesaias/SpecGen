import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef } from "react";
import { Details, DetailsContent, DetailsSummary } from "./extensions/detailsExtension";

const lowlight = createLowlight(common);

interface Props {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  editable?: boolean;
}

function TBBtn({
  active,
  onClick,
  title,
  children,
}: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
        active
          ? "bg-stone-100 dark:bg-stone-800 text-brand-600 dark:text-brand-300"
          : "text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

export default function TiptapEditor({
  content,
  onChange,
  placeholder = "Type / for commands...",
  editable = true,
}: Props) {
  const suppressUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ["http", "https", "mailto"],
        validate: (href) => /^(https?:\/\/|mailto:|#|\/)/.test(href),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Details,
      DetailsSummary,
      DetailsContent,
    ],
    content: content
      ? (() => {
          try {
            return JSON.parse(content);
          } catch {
            return undefined;
          }
        })()
      : undefined,
    editable,
    onUpdate: ({ editor }) => {
      if (suppressUpdate.current) return;
      onChange(JSON.stringify(editor.getJSON()));
    },
  });

  // Only sync content when a DIFFERENT item is loaded (content prop changes).
  // Toggling edit/view mode should NOT overwrite the editor — it already has the right content.
  const lastSyncedContent = useRef(content);
  useEffect(() => {
    if (!editor) return;
    if (content === lastSyncedContent.current) return; // Same content, skip (handles edit toggle)
    lastSyncedContent.current = content;
    if (!content) return;
    try {
      const parsed = JSON.parse(content);
      suppressUpdate.current = true;
      editor.commands.setContent(parsed);
      requestAnimationFrame(() => {
        suppressUpdate.current = false;
      });
    } catch {}
  }, [content, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div
      className={`tiptap-editor prose prose-sm dark:prose-invert max-w-none ${
        editable
          ? "border border-stone-200 dark:border-stone-800 rounded-lg focus-within:border-brand-500 dark:focus-within:border-brand-400 transition-colors"
          : ""
      }`}
    >
      {editable && (
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/50 rounded-t-lg flex-wrap">
          <TBBtn
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <span className="font-bold">B</span>
          </TBBtn>
          <TBBtn
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <span className="italic">I</span>
          </TBBtn>
          <TBBtn
            active={editor.isActive("code")}
            onClick={() => editor.chain().focus().toggleCode().run()}
            title="Inline Code"
          >
            <span className="font-mono text-xs">&lt;/&gt;</span>
          </TBBtn>
          <TBBtn
            active={editor.isActive("link")}
            onClick={() => {
              const url = window.prompt("URL:");
              if (url) editor.chain().focus().setLink({ href: url }).run();
              else editor.chain().focus().unsetLink().run();
            }}
            title="Link"
          >
            <span className="text-xs">🔗</span>
          </TBBtn>
          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5" />
          <TBBtn
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title="Heading 2"
          >
            <span className="text-xs font-bold">H2</span>
          </TBBtn>
          <TBBtn
            active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title="Heading 3"
          >
            <span className="text-xs font-bold">H3</span>
          </TBBtn>
          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5" />
          <TBBtn
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title="Bullet List"
          >
            <span className="text-xs">•</span>
          </TBBtn>
          <TBBtn
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title="Numbered List"
          >
            <span className="text-xs">1.</span>
          </TBBtn>
          <TBBtn
            active={false}
            onClick={() => {
              if (editor.isActive("listItem")) {
                // Try to nest under item above
                if (!editor.chain().focus().sinkListItem("listItem").run()) {
                  // Can't sink — already first item, no-op
                }
              } else {
                // Not in a list — wrap current line in bullet list
                editor.chain().focus().toggleBulletList().run();
              }
            }}
            title="Indent"
          >
            <span className="text-xs">→</span>
          </TBBtn>
          <TBBtn
            active={false}
            onClick={() => {
              if (editor.isActive("listItem")) {
                // Try to lift one level
                if (!editor.chain().focus().liftListItem("listItem").run()) {
                  // At root level — unwrap from list entirely
                  if (editor.isActive("bulletList"))
                    editor.chain().focus().toggleBulletList().run();
                  else if (editor.isActive("orderedList"))
                    editor.chain().focus().toggleOrderedList().run();
                }
              }
            }}
            title="Outdent"
          >
            <span className="text-xs">←</span>
          </TBBtn>
          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700 mx-0.5" />
          <TBBtn
            active={false}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title="Code Block"
          >
            <span className="text-[10px] font-mono">{"{}"}</span>
          </TBBtn>
          <TBBtn
            active={false}
            onClick={() => {
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "details",
                  attrs: { open: true },
                  content: [
                    { type: "detailsSummary", content: [{ type: "text", text: "Details" }] },
                    { type: "detailsContent", content: [{ type: "paragraph" }] },
                  ],
                })
                .run();
            }}
            title="Collapsible"
          >
            <span className="text-xs">▸</span>
          </TBBtn>
          <TBBtn
            active={false}
            onClick={() => {
              editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
            }}
            title="Table"
          >
            <span className="text-xs">▦</span>
          </TBBtn>
        </div>
      )}
      <div className={editable ? "px-3 py-2 min-h-[40px]" : ""}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
