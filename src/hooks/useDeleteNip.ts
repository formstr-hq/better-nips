import { useCallback, useState } from "react";
import type { EventTemplate } from "nostr-tools";
import { dataLayer, signer } from "../nostr/bootstrap";
import { KIND_DELETE, KIND_NIP } from "../nostr/constants";
import { toast } from "../lib/toast";
import type { Nip } from "../nostr/nips";

/**
 * Publish a NIP-09 deletion request (kind 5) for a NIP you authored. Because a
 * NIP is addressable, the request carries both the addressable coordinate (`a`)
 * — so relays drop every version, past and future — and the specific event id
 * (`e`) as a fallback for relays that only honour id-scoped deletions. Relays
 * only accept deletions signed by the original author, so this no-ops for
 * anyone else.
 */
export function useDeleteNip(onNeedsAuth?: () => void) {
  const [deleting, setDeleting] = useState(false);

  const remove = useCallback(
    async (nip: Nip): Promise<boolean> => {
      const me = signer.getActiveAccount()?.pubkey;
      if (!signer.getActiveSigner() || !me) {
        toast.error("Re-authenticate to delete this NIP.");
        onNeedsAuth?.();
        return false;
      }
      if (nip.pubkey !== me) {
        toast.error("You can only delete NIPs you authored.");
        return false;
      }
      setDeleting(true);
      try {
        const del: EventTemplate = {
          kind: KIND_DELETE,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["a", nip.address],
            ["e", nip.id],
            ["k", String(KIND_NIP)],
          ],
        };
        const { result } = await dataLayer.publish(del);
        if (result.accepted > 0) {
          toast.success(`Deletion requested on ${result.accepted}/${result.total} relays.`);
          return true;
        }
        toast.error("Signed but no relay accepted the deletion. Try again.");
        return false;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete NIP.");
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [onNeedsAuth],
  );

  return { remove, deleting };
}
