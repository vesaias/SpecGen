import { z } from "zod";

export const profileManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase, digits, hyphens; must start with [a-z0-9]"),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+/, "must start with semver"),
  extends: z.string().nullable().default(null),
  audience: z.array(z.string()).default([]),
  supports_generators: z.array(z.string()).min(1),
  supports_item_types: z.array(z.string()).min(1),
  ai: z
    .object({
      default_model: z.string().default("claude-haiku-4-5"),
      default_temperature: z.number().min(0).max(2).default(0.2),
      default_max_tokens: z.number().int().positive().default(8000),
      default_concurrency: z.number().int().positive().default(3),
    })
    .default({}),
  output: z
    .object({
      language: z.string().default("en"),
      block_types_allowlist: z.array(z.string()).nullable().default(null),
    })
    .default({}),
  keywords: z.array(z.string()).default([]),
  author: z.string().optional(),
  license: z.string().default("MIT"),
});

export type ProfileManifest = z.infer<typeof profileManifestSchema>;
