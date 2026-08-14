import type { Event } from "nostr-tools";
import { z } from "zod";

export const NIP_KIND = 30817 as const;
export const DELETION_KIND = 5 as const;
export const DEFAULT_INDEX_CAP = 10_000;

const hex64 = /^[0-9a-f]{64}$/;

export const nipCoordinateSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    const parsed = parseNipCoordinate(value);
    if (!parsed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected 30817:<lowercase 64-character pubkey>:<identifier>",
      });
    }
  });

export interface NipCoordinate {
  coordinate: string;
  kind: typeof NIP_KIND;
  pubkey: string;
  identifier: string;
}

export interface ParsedNipEvent extends NipCoordinate {
  event: Event;
  title: string;
  summary: string;
  definedKinds: Array<{ kind: number; name: string }>;
}

export type DeletionReference =
  | { type: "event"; value: string }
  | { type: "coordinate"; value: string };

export interface ParsedDeletionEvent {
  event: Event;
  references: DeletionReference[];
}

export interface OrderedEvent {
  id: string;
  created_at: number;
}

export interface DeletableVersion extends OrderedEvent {
  pubkey: string;
  coordinate: string;
}

export interface EffectiveDeletion extends OrderedEvent {
  pubkey: string;
  targetEventId?: string;
  targetCoordinate?: string;
}

export interface VersionDeletionState<T extends DeletableVersion> {
  version: T;
  deletedBy: string | null;
}

export function parseNipCoordinate(value: string): NipCoordinate | null {
  const firstColon = value.indexOf(":");
  const secondColon = value.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return null;

  const kind = Number(value.slice(0, firstColon));
  const kindValue = value.slice(0, firstColon);
  const pubkey = value.slice(firstColon + 1, secondColon);
  const identifier = value.slice(secondColon + 1);
  if (
    kindValue !== String(NIP_KIND) ||
    kind !== NIP_KIND ||
    !hex64.test(pubkey) ||
    identifier.includes("\0")
  ) {
    return null;
  }

  return { coordinate: value, kind, pubkey, identifier };
}

/** Negative means `left` is newer, matching NIP-01 query ordering. */
export function compareNip01(left: OrderedEvent, right: OrderedEvent): number {
  if (left.created_at !== right.created_at) {
    return left.created_at > right.created_at ? -1 : 1;
  }
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function latestNip01<T extends OrderedEvent>(events: readonly T[]): T | null {
  return events.length === 0 ? null : [...events].sort(compareNip01)[0];
}

/**
 * Applies NIP-09 without trusting relay-side deletion handling. `e` references
 * delete that exact same-author event; `a` references delete same-author
 * versions no newer than the request. Deletion requests are never candidates.
 */
export function applyNip09<T extends DeletableVersion>(
  versions: readonly T[],
  deletions: readonly EffectiveDeletion[],
): Array<VersionDeletionState<T>> {
  return versions.map((version) => {
    const matching = deletions.filter((deletion) => {
      if (deletion.pubkey !== version.pubkey) return false;
      if (deletion.targetEventId === version.id) return true;
      return (
        deletion.targetCoordinate === version.coordinate &&
        version.created_at <= deletion.created_at
      );
    });
    return { version, deletedBy: latestNip01(matching)?.id ?? null };
  });
}
