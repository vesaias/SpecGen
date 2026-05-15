import { describe, expect, it } from "vitest";
import { renderItemMarkdown } from "../../src/exporter/markdownItemRenderers.js";
import type {
  BackendSpecItem,
  EventSpecItem,
  FrontendSpecItem,
  HandlerSpecItem,
} from "../../src/spec/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const backendItem: BackendSpecItem = {
  id: "get-orders",
  type: "backend",
  title: "GET /orders",
  method: "GET",
  route: "/api/orders",
  controller: "OrdersController",
  summary: "Returns a list of orders",
  context: "Used by the dashboard page",
  parameters: [
    { name: "limit", location: "query", type: "number", required: false, description: "Max items" },
  ],
  requestBody: undefined,
  responses: [
    { status: 200, type: "OrderDto[]", description: "Success", responseExample: '[{"id":1}]' },
    { status: 401, description: "Unauthorized" },
  ],
  validationRules: [{ field: "limit", rule: "max:100", message: "Must be <= 100" }],
  orchestration: [{ step: 1, call: "OrderRepository.findAll()", description: "Fetch all orders" }],
  dependencies: ["OrderRepository"],
  sourceFiles: ["OrdersController.cs"],
  sourceHash: "abc123",
};

const frontendItem: FrontendSpecItem = {
  id: "page-dashboard",
  type: "frontend",
  title: "Dashboard",
  route: "/dashboard",
  context: "Main landing page after login",
  sections: [
    {
      id: "header",
      component: "HeaderComponent",
      elements: [{ tag: "h1", editable: false, source: "static" }],
    },
  ],
  state: [{ name: "orders", type: "Order[]", initialValue: "[]" }],
  actions: [
    {
      trigger: "onMount",
      method: "GET",
      endpoint: "/api/orders",
      onSuccess: "setOrders",
      onError: "showError",
    },
  ],
  navigation: [{ to: "/orders/:id", trigger: "rowClick", condition: "" }],
  apiCalls: [{ hook: "useOrders", type: "REST", method: "GET", endpoint: "/api/orders" }],
};

const eventItem: EventSpecItem = {
  id: "event-order-created",
  type: "event",
  title: "OrderCreated",
  summary: "Emitted when a new order is placed",
  context: "Triggered by checkout flow",
  payload: [
    { name: "orderId", type: "string", description: "The new order ID" },
    { name: "userId", type: "string", description: "The placing user" },
  ],
  payloadExample: '{"orderId":"123","userId":"u1"}',
  triggers: [{ service: "OrderService", method: "POST", endpoint: "/api/orders" }],
  handler: "OrderCreatedHandler",
  handlerDescription: "Sends confirmation email",
};

const handlerItem: HandlerSpecItem = {
  id: "handler-order-created",
  type: "handler",
  title: "OrderCreatedHandler",
  description: "Handles the OrderCreated domain event",
  listensTo: ["OrderCreated", "OrderUpdated"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderItemMarkdown — backend", () => {
  it("includes frontmatter with id, type, method, route", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain('id: "get-orders"');
    expect(md).toContain('type: "backend"');
    expect(md).toContain('method: "GET"');
    expect(md).toContain('route: "/api/orders"');
  });

  it("includes H1 title", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain("# GET /orders");
  });

  it("includes Parameters table", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain("## Parameters");
    expect(md).toContain("| limit | query | number | no |");
  });

  it("includes Responses section", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain("### HTTP 200 (OrderDto[])");
    expect(md).toContain("### HTTP 401");
    expect(md).toContain('[{"id":1}]');
  });

  it("includes Orchestration and Dependencies", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain("## Orchestration");
    expect(md).toContain("OrderRepository.findAll()");
    expect(md).toContain("## Dependencies");
    expect(md).toContain("- OrderRepository");
  });

  it("includes Validation rules", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).toContain("## Validation rules");
    expect(md).toContain("| limit | max:100 | Must be <= 100 |");
  });
});

describe("renderItemMarkdown — frontend", () => {
  it("includes frontmatter with route", () => {
    const md = renderItemMarkdown(frontendItem);
    expect(md).toContain('route: "/dashboard"');
  });

  it("includes Sections and State", () => {
    const md = renderItemMarkdown(frontendItem);
    expect(md).toContain("## Sections");
    expect(md).toContain("HeaderComponent");
    expect(md).toContain("## State");
    expect(md).toContain("| orders | Order[] |");
  });

  it("includes Actions and Navigation", () => {
    const md = renderItemMarkdown(frontendItem);
    expect(md).toContain("## Actions");
    expect(md).toContain("onMount");
    expect(md).toContain("## Navigation");
    expect(md).toContain("/orders/:id");
  });
});

describe("renderItemMarkdown — event", () => {
  it("includes summary blockquote", () => {
    const md = renderItemMarkdown(eventItem);
    expect(md).toContain("> Emitted when a new order is placed");
  });

  it("includes Payload table and example", () => {
    const md = renderItemMarkdown(eventItem);
    expect(md).toContain("## Payload");
    expect(md).toContain("| orderId | string |");
    expect(md).toContain("```json");
    expect(md).toContain('{"orderId":"123"');
  });

  it("includes Handler reference", () => {
    const md = renderItemMarkdown(eventItem);
    expect(md).toContain("## Handler");
    expect(md).toContain("`OrderCreatedHandler`");
  });
});

describe("renderItemMarkdown — handler", () => {
  it("includes description and listensTo", () => {
    const md = renderItemMarkdown(handlerItem);
    expect(md).toContain("Handles the OrderCreated domain event");
    expect(md).toContain("## Listens to");
    expect(md).toContain("`OrderCreated`");
    expect(md).toContain("`OrderUpdated`");
  });
});

describe("renderItemMarkdown — blocks (notes)", () => {
  it("appends ## Notes section when blocks present", () => {
    const item = {
      ...backendItem,
      blocks: [
        {
          id: "b1",
          type: "code" as const,
          content: "SELECT * FROM orders",
          meta: { language: "sql" },
        },
      ],
    };
    const md = renderItemMarkdown(item);
    expect(md).toContain("## Notes");
    expect(md).toContain("```sql");
    expect(md).toContain("SELECT * FROM orders");
  });

  it("omits ## Notes section when no blocks", () => {
    const md = renderItemMarkdown(backendItem);
    expect(md).not.toContain("## Notes");
  });
});
