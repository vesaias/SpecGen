import { ulid as makeUlid } from "ulid";

export function ulid(): string {
  return makeUlid();
}
