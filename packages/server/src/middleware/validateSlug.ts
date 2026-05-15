import type { RequestHandler } from "express";
import { isValidSlug } from "../services/slugify.js";
import { httpError } from "./errorHandler.js";

/**
 * Express middleware that 400s the request if the named path param doesn't pass the slug pattern.
 * Use for any path param that flows into filesystem joins or sqlite queries.
 */
export function validateSlug(paramName: string): RequestHandler {
  return (req, _res, next) => {
    const value = req.params[paramName];
    if (typeof value !== "string" || !isValidSlug(value)) {
      next(httpError(400, `Invalid ${paramName}: must match [a-z0-9][a-z0-9-]*`));
      return;
    }
    next();
  };
}
