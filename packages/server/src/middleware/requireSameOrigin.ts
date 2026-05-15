import type { RequestHandler } from "express";
import { httpError } from "./errorHandler.js";

/**
 * Reject cross-origin state-changing requests. Belt-and-braces against
 * DNS-rebinding / malicious local-page attacks while SpecGen has no auth.
 *
 * - Only checks PUT/POST/PATCH/DELETE
 * - If no Origin header present, allow (CLI / curl)
 * - If Origin present, must equal `<req.protocol>://<req.headers.host>`
 */
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("Origin");
  if (!origin) return next();
  const expected = `${req.protocol}://${req.headers.host}`;
  if (origin === expected) return next();
  return next(httpError(403, `Cross-origin ${req.method} blocked`));
};
