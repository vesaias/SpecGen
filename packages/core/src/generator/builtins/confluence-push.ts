/**
 * confluence-push — Streaming generator wrapper around the
 * `@specgen/connector-confluence` push service.
 *
 * This generator is a thin shell: it accepts a pre-built
 * `ConfluencePushService` (via `ctx.options.confluencePushService`) plus the
 * push config (project id, space key, optional parent page id), drives the
 * service's async-generator `pushIterable()`, and forwards each progress
 * event as a `GeneratorEvent` so the RunWorker → RunEventBroker → SSE
 * pipeline can stream them to the webapp's ProgressDrawer.
 *
 * The "service is built by the server" indirection is deliberate:
 *
 *   - Core can't import `@specgen/connector-confluence` directly (the
 *     connector depends on core, so doing so would create a cycle).
 *   - The connector needs a Confluence client (which holds credentials from
 *     the encrypted TokenStore) and a page-map repository (which is server-
 *     only SQLite code). Neither belongs in `GeneratorContext`.
 *
 * The server route at `POST /api/v0/projects/:slug/confluence/push` builds
 * the service eagerly (so it can fail fast with 4xx if config / credentials
 * are missing) and stuffs it onto the run's `options` map. Generator
 * options are `Record<string, unknown>` and are passed in-process — there's
 * no serialization step that would choke on class instances.
 *
 * Stats: this generator does not modify the local Spec. It reports
 * itemsCreated/itemsUpdated/itemsRemoved counts that mirror the Confluence
 * push result so the run row shows meaningful numbers in the dashboard.
 * `aiCalls` and `aiCostUsdTotal` stay zero — no AI is involved.
 */

import { emptyRunSummary } from "../../run/RunSummary.js";
import type { GeneratorContext, GeneratorEvent, GeneratorPlugin } from "../Generator.js";

/**
 * Minimal shape the generator needs from the connector. We mirror just the
 * methods we call here instead of `import type` from `@specgen/connector-
 * confluence` because doing the latter creates a peer-dep declaration burden
 * on core for a package that's only ever wired in by the server. The server
 * passes a real `ConfluencePushService` — structurally compatible.
 */
export interface ConfluencePushIterableService {
  pushIterable(
    spec: unknown,
    cfg: {
      projectId: string;
      spaceKey: string;
      parentPageId?: string;
      onProgress?: (msg: string) => void;
    },
  ): AsyncIterable<
    | { type: "progress"; message: string }
    | { type: "done"; result: { created: number; updated: number; archived: number } }
  >;
}

export interface ConfluencePushOpts {
  /**
   * The push service to drive. Built by the server route handler from
   * project credentials + the page-map repo. Required.
   */
  confluencePushService: ConfluencePushIterableService;
  /** Project id, threaded through to the page-map repository. Required. */
  projectId: string;
  /** Confluence space key (e.g. "DEMO"). Required. */
  spaceKey: string;
  /** Optional parent page id — applied to newly-created pages only. */
  parentPageId?: string;
}

function isConfluencePushOpts(value: unknown): value is ConfluencePushOpts {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    !!o.confluencePushService &&
    typeof (o.confluencePushService as { pushIterable?: unknown }).pushIterable === "function" &&
    typeof o.projectId === "string" &&
    typeof o.spaceKey === "string" &&
    (o.parentPageId === undefined || typeof o.parentPageId === "string")
  );
}

export const confluencePushGenerator: GeneratorPlugin = {
  id: "confluence-push",
  name: "Push to Confluence",
  description:
    "Two-pass sync of the project's spec items to a Confluence Cloud space, streaming per-page progress.",
  supports_profiles: "*",
  supports_parsers: "*",
  // confluence-push does not produce SpecItems — it pushes existing ones to a
  // foreign system. The empty list is a marker that the run is read-only on
  // the local spec.
  produces_item_types: [],

  async *run(ctx: GeneratorContext): AsyncIterable<GeneratorEvent> {
    const opts = ctx.options;
    if (!isConfluencePushOpts(opts)) {
      yield {
        type: "error",
        error: new Error(
          "confluence-push requires options.confluencePushService + options.projectId + options.spaceKey — wire it through the server's /confluence/push route",
        ),
      };
      yield { type: "done", stats: emptyRunSummary() };
      return;
    }

    let created = 0;
    let updated = 0;
    let archived = 0;

    try {
      for await (const ev of opts.confluencePushService.pushIterable(ctx.spec, {
        projectId: opts.projectId,
        spaceKey: opts.spaceKey,
        parentPageId: opts.parentPageId,
      })) {
        if (ev.type === "progress") {
          yield { type: "progress", message: ev.message };
        } else if (ev.type === "done") {
          created = ev.result.created;
          updated = ev.result.updated;
          archived = ev.result.archived;
        }
      }
    } catch (err) {
      yield { type: "error", error: err as Error };
      yield {
        type: "done",
        stats: {
          ...emptyRunSummary(),
          itemsCreated: created,
          itemsUpdated: updated,
          itemsRemoved: archived,
        },
      };
      return;
    }

    yield {
      type: "progress",
      message: `Confluence push complete — ${created} created, ${updated} updated, ${archived} archived`,
    };
    yield {
      type: "done",
      stats: {
        itemsCreated: created,
        itemsUpdated: updated,
        itemsRemoved: archived,
        warnings: 0,
        aiCalls: [],
        aiCostUsdTotal: 0,
      },
    };
  },
};
