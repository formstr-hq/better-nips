import type { MetadataRoute } from "next";
import { canonicalNaddr } from "../src/nostr/coordinates";
import { getServerEnv } from "../src/server/env";
import { listIndexedNips } from "../src/server/repository";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const env = getServerEnv();
    const rows = await listIndexedNips(env.MAX_INDEXED_NIPS);
    return [
      { url: env.SITE_URL, changeFrequency: "daily", priority: 1 },
      ...rows.map((row) => ({
        url: new URL(`/nip/${canonicalNaddr(row.pubkey, row.identifier)}`, env.SITE_URL).href,
        lastModified: row.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    console.error("Failed to build sitemap", error);
    const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
    return [{ url: siteUrl, changeFrequency: "daily", priority: 1 }];
  }
}
