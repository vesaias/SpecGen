import { InputRule, Node, mergeAttributes } from "@tiptap/core";
import type { Command, CommandProps } from "@tiptap/core";

/**
 * Tiptap nodes for a collapsible `<details><summary>...</summary>...</details>`
 * block. Used by the AI enrichment prompts and the slash command menu to fold
 * long JSON examples (e.g. response bodies) under a one-line summary inside an
 * orchestration step.
 *
 * Three nodes:
 *   - `details`         — wrapper, attrs: { open: boolean }
 *   - `detailsSummary`  — inline-only, renders to <summary>
 *   - `detailsContent`  — block+, renders to <div data-details-content>
 *
 * Insertion patterns:
 *   1. Toolbar button (see TiptapEditor.tsx)
 *   2. In-editor input rule: typing `/details ` at the start of an empty paragraph
 *      replaces that paragraph with an empty details block (placeholder summary
 *      + empty content paragraph).
 *   3. Block-level SlashCommandMenu "Collapsible" item — inserts a richtext
 *      block whose document IS a details node.
 */
export const Details = Node.create({
  name: "details",
  group: "block",
  content: "detailsSummary detailsContent",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element) => element.hasAttribute("open"),
        renderHTML: (attributes) => (attributes.open ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands(): any {
    return {
      setDetails:
        (): Command =>
        ({ commands }: CommandProps) => {
          return commands.wrapIn(this.name);
        },
      toggleDetails:
        (): Command =>
        ({ commands }: CommandProps) => {
          return commands.toggleWrap(this.name);
        },
    };
  },

  /**
   * Input rule: at the start of an empty paragraph, typing `/details ` (note
   * trailing space) replaces it with an empty details block. The rule uses a
   * custom handler — not textblockTypeInputRule — because we need to insert a
   * multi-node structure, not just retype the current block.
   */
  addInputRules() {
    return [
      new InputRule({
        find: /^\/details\s$/,
        handler: ({ state, range, chain }) => {
          const $from = state.doc.resolve(range.from);
          // Only fire at the very start of a paragraph so we don't eat text
          // the user has already typed mid-line.
          if ($from.parent.type.name !== "paragraph") return null;
          if ($from.parentOffset !== 0) return null;
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .insertContent({
              type: "details",
              attrs: { open: true },
              content: [
                { type: "detailsSummary", content: [{ type: "text", text: "Details" }] },
                { type: "detailsContent", content: [{ type: "paragraph" }] },
              ],
            })
            .run();
          return null;
        },
      }),
    ];
  },
});

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  group: "block",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },
});

export const DetailsContent = Node.create({
  name: "detailsContent",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-details-content]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-details-content": "" }), 0];
  },
});
