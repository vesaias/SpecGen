import type {
  BackendSpecItem,
  Block,
  EventSpecItem,
  FrontendSpecItem,
  HandlerSpecItem,
} from "@specgen/core";
import { describe, expect, it } from "vitest";
import { renderItemAdf } from "../src/renderItemAdf.js";

describe("renderItemAdf", () => {
  it("wraps output in an AdfDoc with version 1", () => {
    const item: BackendSpecItem = {
      id: "x",
      type: "backend",
      title: "GET /x",
      method: "GET",
      route: "/x",
      controller: "X",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    expect(result.version).toBe(1);
    expect(result.type).toBe("doc");
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("emits an H1 with the item title", () => {
    const item: HandlerSpecItem = {
      id: "h",
      type: "handler",
      title: "MyHandler",
      description: "",
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const h1 = result.content[0];
    expect(h1?.type).toBe("heading");
    expect(h1?.attrs?.level).toBe(1);
    expect(h1?.content?.[0]?.text).toBe("MyHandler");
  });

  it("backend: emits summary blockquote, context heading+paragraph, parameters table", () => {
    const item: BackendSpecItem = {
      id: "x",
      type: "backend",
      title: "GET /x",
      method: "GET",
      route: "/x",
      controller: "X",
      summary: "Get a thing",
      context: "It does the thing.",
      parameters: [
        {
          name: "id",
          location: "path",
          type: "string",
          required: true,
          description: "the id",
        },
      ],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const types = result.content.map((n) => n.type);
    expect(types).toContain("blockquote");
    expect(types).toContain("heading");
    expect(types).toContain("table");
    const blockquote = result.content.find((n) => n.type === "blockquote");
    expect(blockquote?.content?.[0]?.type).toBe("paragraph");
  });

  it("backend: emits responses as expand+codeBlock per status", () => {
    const item: BackendSpecItem = {
      id: "x",
      type: "backend",
      title: "GET /x",
      method: "GET",
      route: "/x",
      controller: "X",
      summary: "",
      context: "",
      parameters: [],
      responses: [
        {
          status: 200,
          description: "ok",
          responseExample: '{"ok":true}',
        },
      ],
      validationRules: [],
      orchestration: [],
      dependencies: [],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const expand = result.content.find((n) => n.type === "expand");
    expect(expand).toBeDefined();
    expect(String(expand?.attrs?.title)).toContain("200");
    expect(expand?.content?.[0]?.type).toBe("codeBlock");
    expect(expand?.content?.[0]?.attrs).toEqual({ language: "json" });
  });

  it("backend: emits dependencies as bulletList", () => {
    const item: BackendSpecItem = {
      id: "x",
      type: "backend",
      title: "GET /x",
      method: "GET",
      route: "/x",
      controller: "X",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: ["ServiceA", "ServiceB"],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const list = result.content.find((n) => n.type === "bulletList");
    expect(list?.content?.length).toBe(2);
  });

  it("frontend: emits sections with H3 + element tables", () => {
    const item: FrontendSpecItem = {
      id: "p",
      type: "frontend",
      title: "Page",
      route: "/page",
      context: "",
      sections: [
        {
          id: "header",
          component: "Header",
          elements: [{ tag: "button", editable: true, source: "x.tsx", name: "Submit" }],
        },
      ],
      navigation: [],
      actions: [],
      state: [],
      apiCalls: [],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const h3 = result.content.find((n) => n.type === "heading" && n.attrs?.level === 3);
    expect(h3).toBeDefined();
    expect(h3?.content?.[0]?.text).toContain("header");
  });

  it("event: emits payloadExample as a JSON codeBlock", () => {
    const item: EventSpecItem = {
      id: "e",
      type: "event",
      title: "OrderPlaced",
      summary: "",
      context: "",
      payload: [],
      payloadExample: '{"id":1}',
      triggers: [],
      handler: "",
      handlerDescription: "",
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const code = result.content.find((n) => n.type === "codeBlock");
    expect(code).toBeDefined();
    expect(code?.attrs).toEqual({ language: "json" });
    expect(code?.content?.[0]?.text).toBe('{"id":1}');
  });

  it("handler: emits listensTo as bulletList of code-marked items", () => {
    const item: HandlerSpecItem = {
      id: "h",
      type: "handler",
      title: "MyHandler",
      description: "",
      listensTo: ["UserCreated"],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const list = result.content.find((n) => n.type === "bulletList");
    expect(list).toBeDefined();
    const firstItem = list?.content?.[0];
    const para = firstItem?.content?.[0];
    expect(para?.content?.[0]?.marks).toEqual([{ type: "code" }]);
  });

  it("adds Notes section with blocks when present", () => {
    const blocks: Block[] = [
      {
        id: "b1",
        type: "code",
        content: "x",
        meta: { language: "ts" },
      },
    ];
    const item: HandlerSpecItem & { blocks: Block[] } = {
      id: "h",
      type: "handler",
      title: "H",
      description: "",
      blocks,
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const notesHeading = result.content.find(
      (n) => n.type === "heading" && n.attrs?.level === 2 && n.content?.[0]?.text === "Notes",
    );
    expect(notesHeading).toBeDefined();
    const codeBlock = result.content.find((n) => n.type === "codeBlock");
    expect(codeBlock).toBeDefined();
  });

  it("stub mode: drops link marks pointing at #fragment", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see other",
              marks: [{ type: "link", attrs: { href: "#other" } }],
            },
          ],
        },
      ],
    });
    const item: HandlerSpecItem & { blocks: Block[] } = {
      id: "h",
      type: "handler",
      title: "H",
      description: "",
      blocks: [{ id: "b1", type: "richtext", content: tiptap }],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    const allText = JSON.stringify(result);
    // No link mark anywhere in the output (text "see other" is preserved).
    expect(allText).not.toContain('{"type":"link"');
    expect(allText).toContain("see other");
  });

  it("resolve mode: rewrites #fragment to the resolved URL", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see other",
              marks: [{ type: "link", attrs: { href: "#other-id" } }],
            },
          ],
        },
      ],
    });
    const item: HandlerSpecItem & { blocks: Block[] } = {
      id: "h",
      type: "handler",
      title: "H",
      description: "",
      blocks: [{ id: "b1", type: "richtext", content: tiptap }],
    };
    const result = renderItemAdf(item, {
      stubLinks: false,
      resolveItemUrl: (id) =>
        id === "other-id" ? "https://acme.atlassian.net/wiki/spaces/X/pages/42" : null,
    });
    const allText = JSON.stringify(result);
    expect(allText).toContain('"href":"https://acme.atlassian.net/wiki/spaces/X/pages/42"');
  });

  it("resolve mode: drops link when resolver returns null", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ghost",
              marks: [{ type: "link", attrs: { href: "#missing" } }],
            },
          ],
        },
      ],
    });
    const item: HandlerSpecItem & { blocks: Block[] } = {
      id: "h",
      type: "handler",
      title: "H",
      description: "",
      blocks: [{ id: "b1", type: "richtext", content: tiptap }],
    };
    const result = renderItemAdf(item, {
      stubLinks: false,
      resolveItemUrl: () => null,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('"link"');
    // Text is still there.
    expect(json).toContain("ghost");
  });

  it("preserves absolute http(s) link marks in stub mode", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "ext",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    });
    const item: HandlerSpecItem & { blocks: Block[] } = {
      id: "h",
      type: "handler",
      title: "H",
      description: "",
      blocks: [{ id: "b1", type: "richtext", content: tiptap }],
    };
    const result = renderItemAdf(item, { stubLinks: true });
    expect(JSON.stringify(result)).toContain('"href":"https://example.com"');
  });
});
