import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfluenceClient } from "../src/ConfluenceClient.js";

const origFetch = globalThis.fetch;

describe("ConfluenceClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("strips trailing slashes from baseUrl", () => {
    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net///",
      email: "x@y",
      apiToken: "tok",
    });
    expect(c.baseUrl).toBe("https://acme.atlassian.net");
  });

  it("sends Basic auth + Accept/Content-Type headers and joins /wiki path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ id: "sp1", key: "DEMO" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "bot@x",
      apiToken: "tok",
    });
    const space = await c.findSpace("DEMO");
    expect(space).toEqual({ id: "sp1", key: "DEMO" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [url, init] = call;
    expect(url).toBe("https://acme.atlassian.net/wiki/api/v2/spaces?keys=DEMO&limit=1");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("bot@x:tok").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Accept).toBe("application/json");
  });

  it("throws when findSpace returns no results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "x@y",
      apiToken: "t",
    });
    await expect(c.findSpace("MISSING")).rejects.toThrow(/Confluence space not found: MISSING/);
  });

  it("throws with method + path + status + body on non-2xx", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 403 })) as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "x@y",
      apiToken: "t",
    });
    await expect(c.findSpace("DEMO")).rejects.toThrow(/Confluence GET .* → 403: nope/);
  });

  it("createPage POSTs an atlas_doc_format body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "p1", version: { number: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "x@y",
      apiToken: "t",
    });
    const r = await c.createPage({
      spaceId: "sp1",
      title: "Hi",
      adfBody: { version: 1, type: "doc", content: [] },
    });
    expect(r).toEqual({ id: "p1", version: { number: 1 } });
    const createCall = fetchMock.mock.calls[0];
    if (!createCall) throw new Error("fetch not called");
    const init = createCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.body.representation).toBe("atlas_doc_format");
    expect(typeof body.body.value).toBe("string");
    expect(JSON.parse(body.body.value)).toEqual({
      version: 1,
      type: "doc",
      content: [],
    });
  });

  it("updatePage bumps version+1 and PUTs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "p1", version: { number: 5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "x@y",
      apiToken: "t",
    });
    await c.updatePage({
      id: "p1",
      version: 4,
      title: "Hi",
      adfBody: { version: 1, type: "doc", content: [] },
    });
    const updateCall = fetchMock.mock.calls[0];
    if (!updateCall) throw new Error("fetch not called");
    const init = updateCall[1] as RequestInit;
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.version.number).toBe(5);
  });

  it("archivePage calls DELETE and tolerates 204 No Content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const c = new ConfluenceClient({
      baseUrl: "https://acme.atlassian.net",
      email: "x@y",
      apiToken: "t",
    });
    await c.archivePage("p1");
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [url, init] = call;
    expect(url).toBe("https://acme.atlassian.net/wiki/api/v2/pages/p1");
    expect((init as RequestInit).method).toBe("DELETE");
  });
});
