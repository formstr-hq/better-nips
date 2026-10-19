import type { Event } from "nostr-tools";
import { validateEvent, verifyEvent } from "nostr-tools";
import { z } from "zod";
import {
  DELETION_KIND,
  NIP_KIND,
  parseNipCoordinate,
  type ParsedDeletionEvent,
  type ParsedNipEvent,
} from "./types";

const hex64 = /^[0-9a-f]{64}$/;
const hex128 = /^[0-9a-f]{128}$/;
const MAX_FUTURE_SKEW_SECONDS = 24 * 60 * 60;
const postgresText = z.string().refine((value) => !value.includes("\0"), {
  message: "NUL characters cannot be indexed in PostgreSQL",
});
const boundedText = postgresText.max(1_000_000);

export const nostrEventSchema = z.object({
  id: z.string().regex(hex64),
  pubkey: z.string().regex(hex64),
  created_at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  kind: z.number().int().min(0).max(65_535),
  tags: z.array(z.array(postgresText.max(4096)).min(1).max(32)).max(4096),
  content: boundedText,
  sig: z.string().regex(hex128),
});

function verifiedEvent(input: unknown): Event | null {
  try {
    const parsed = nostrEventSchema.safeParse(input);
    if (!parsed.success) return null;
    const event: Event = parsed.data;
    if (event.created_at > Math.floor(Date.now() / 1000) + MAX_FUTURE_SKEW_SECONDS) return null;
    if (!validateEvent(event) || !verifyEvent(event)) return null;
    return event;
  } catch {
    return null;
  }
}

function firstTag(event: Event, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function summarizeMarkdown(content: string, limit = 200): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.replace(/^#+\s*/, "").slice(0, limit);
}

export function parseVerifiedNip(input: unknown): ParsedNipEvent | null {
  const event = verifiedEvent(input);
  if (!event || event.kind !== NIP_KIND) return null;

  const identifier = firstTag(event, "d");
  if (identifier === undefined) return null;
  const title = firstTag(event, "title")?.trim() || identifier || "Untitled NIP";

  const coordinate = `${NIP_KIND}:${event.pubkey}:${identifier}`;
  const parsedCoordinate = parseNipCoordinate(coordinate);
  if (!parsedCoordinate) return null;

  const definedKinds = event.tags.flatMap((tag) => {
    if (tag[0] !== "k" || !/^\d+$/.test(tag[1] ?? "")) return [];
    const kind = Number(tag[1]);
    if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65_535) return [];
    return [{ kind, name: tag[2] ?? "" }];
  });

  return {
    ...parsedCoordinate,
    event,
    title,
    summary: summarizeMarkdown(event.content),
    definedKinds,
  };
}

export function parseVerifiedDeletion(input: unknown): ParsedDeletionEvent | null {
  const event = verifiedEvent(input);
  if (!event || event.kind !== DELETION_KIND) return null;

  const seen = new Set<string>();
  const references: ParsedDeletionEvent["references"] = [];
  for (const tag of event.tags) {
    const value = tag[1];
    if (!value) continue;

    if (tag[0] === "e" && hex64.test(value)) {
      const key = `event:${value}`;
      if (!seen.has(key)) references.push({ type: "event", value });
      seen.add(key);
    } else if (tag[0] === "a" && parseNipCoordinate(value)) {
      const key = `coordinate:${value}`;
      if (!seen.has(key)) references.push({ type: "coordinate", value });
      seen.add(key);
    }
  }

  return references.length === 0 ? null : { event, references };
}
