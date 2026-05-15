import { describe, expect, it } from "vitest";
import { pathForItem } from "../../src/exporter/treePath.js";
import type { TreeNode } from "../../src/spec/types.js";

describe("pathForItem", () => {
  const tree: TreeNode[] = [
    {
      id: "backend",
      type: "folder",
      label: "Backend",
      children: [
        {
          id: "customers",
          type: "folder",
          label: "Customers",
          children: [
            { id: "get-customer", type: "backend" as const },
            { id: "post-customer", type: "backend" as const },
          ],
        },
        {
          id: "orders",
          type: "folder",
          label: "Orders",
          children: [{ id: "get-order", type: "backend" as const }],
        },
      ],
    },
    {
      id: "frontend",
      type: "folder",
      label: "Frontend",
      children: [{ id: "customer-detail", type: "frontend" as const }],
    },
  ];

  it("resolves doubly-nested items to folder/subfolder/<id>.md", () => {
    expect(pathForItem(tree, "get-customer")).toBe("backend/customers/get-customer.md");
    expect(pathForItem(tree, "post-customer")).toBe("backend/customers/post-customer.md");
  });

  it("resolves single-nested items correctly", () => {
    expect(pathForItem(tree, "get-order")).toBe("backend/orders/get-order.md");
  });

  it("resolves single-folder items correctly", () => {
    expect(pathForItem(tree, "customer-detail")).toBe("frontend/customer-detail.md");
  });

  it("falls back to root for orphan items not present in tree", () => {
    expect(pathForItem(tree, "orphan-id")).toBe("orphan-id.md");
  });

  it("slugifies folder labels with spaces and capitals", () => {
    const labeled: TreeNode[] = [
      {
        id: "x",
        type: "folder",
        label: "My Big Section",
        children: [{ id: "inside", type: "backend" as const }],
      },
    ];
    expect(pathForItem(labeled, "inside")).toBe("my-big-section/inside.md");
  });

  it("handles empty tree (all items are orphans)", () => {
    expect(pathForItem([], "lone-item")).toBe("lone-item.md");
  });

  it("falls back to root when id matches a folder node (folders are not items)", () => {
    // The "backend" id is a folder — should not be returned as an item path
    expect(pathForItem(tree, "backend")).toBe("backend.md");
  });
});
