// Event kinds and label conventions this client speaks.

/** Community-authored NIP (NostrHub "NIPs on Nostr" spec). Addressable. */
export const KIND_NIP = 30817;
/** NIP-32 label event — NostrHub's approval mechanism. */
export const KIND_APPROVAL = 1985;
/** NIP-02 contact list — the source of "following" and web-of-trust. */
export const KIND_CONTACTS = 3;
/** NIP-01 profile metadata. */
export const KIND_PROFILE = 0;
/** NIP-65 relay list metadata — the user's own read/write relays. */
export const KIND_RELAY_LIST = 10002;
/** NIP-25 reaction ("like" / emoji). */
export const KIND_REACTION = 7;
/** NIP-22 comment — used for threaded discussion on a NIP (addressable root). */
export const KIND_COMMENT = 1111;
/** NIP-09 deletion request — used to retract a reaction. */
export const KIND_DELETE = 5;
/** NIP-57 zap request (signed, sent to the LNURL callback — never published). */
export const KIND_ZAP_REQUEST = 9734;
/** NIP-57 zap receipt (published by the recipient's LNURL server on payment). */
export const KIND_ZAP_RECEIPT = 9735;
/** NIP-89 handler information — an app advertising the kinds it can open. Addressable. */
export const KIND_HANDLER_INFO = 31990;
/** NIP-89 handler recommendation — a user vouching for handlers per kind. Addressable (d = kind). */
export const KIND_HANDLER_RECOMMENDATION = 31989;

/** NIP-32 label namespace ("L") used by NostrHub approvals. */
export const LABEL_NAMESPACE = "nostrhub";
/** NIP-32 label value ("l") for an approval. */
export const LABEL_APPROVE = "approve";
/** NIP-32 label value ("l") for a disapproval — a public objection to a NIP. */
export const LABEL_DISAPPROVE = "disapprove";

/** Provenance tag we stamp on events we publish. */
export const CLIENT_NAME = "better-nips";

/** Display wordmark — the NIPs surface of the pollerama family. */
export const APP_NAME = "NIPs by Pollerama";
/** One-line description shown under the wordmark. */
export const APP_TAGLINE = "Community NIPs, surfaced by trust";
/** App URL — surfaced to remote signers on the NIP-46 consent screen. */
export const APP_URL = "https://github.com/formstr-hq/better-nips";

/** Sister app (pollerama) — where author/approver profiles are deep-linked. */
export const POLLERAMA_URL = "https://pollerama.fun";

/** Relays we read from / publish to by default (user-overridable in Settings). */
export const RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
];

export const SEARCH_RELAYS = ["wss://relay.nostr.band"];

/**
 * Aggregator relay that mirrors NostrHub NIPs **and** their approvals. Always
 * appended to the user's relay set (even a customized one) because author-less
 * approval reads only reach `user relays ∪ gossip pool` — without a relay that
 * holds everyone's approvals, global counts (e.g. arthurfranca's) never load.
 */
export const AGGREGATOR_RELAY = "wss://relay.ditto.pub";

// No cap on the web-of-trust set: every direct follow and every discovered
// 2nd-degree account is included. `local-relay`'s SyncEngine outbox-partitions
// the author set across relays (each author → only the relays they write to),
// so even a large trust graph is split per relay rather than sent wholesale.
// The whole point of this client is a social-graph surface, not a curated
// canon — so we don't trim it.
