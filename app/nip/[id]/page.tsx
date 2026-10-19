import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ClientAppLoader } from "../../../src/components/ClientAppLoader";
import { decodeNipAddress } from "../../../src/nostr/coordinates";
import type { InitialNipData } from "../../../src/nostr/initialNip";
import { enqueueNipCoordinateIfCapacity } from "../../../src/server/queue";
import { getIndexedNip, type IndexedNipState } from "../../../src/server/repository";

export const dynamic = "force-dynamic";

const loadState = cache(async (coordinate: string): Promise<IndexedNipState> => {
  try {
    return await getIndexedNip(coordinate);
  } catch (error) {
    console.error("Failed to read the NIP index", error);
    return { status: "missing" };
  }
});

function description(summary: string, content: string): string {
  const value = summary.trim() || content.replace(/\s+/g, " ").trim();
  return value.slice(0, 160) || "A community-authored Nostr implementation proposal.";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const address = decodeNipAddress((await params).id);
  if (!address) return { title: "Invalid NIP", robots: { index: false, follow: false } };
  const canonical = `/nip/${address.canonicalId}`;
  const state = await loadState(address.coordinate);
  if (state.status !== "active") {
    return {
      title: "NIP",
      alternates: { canonical },
      robots: { index: false, follow: true },
    };
  }
  const summary = description(state.summary, state.event.content);
  const publishedTime = new Date(state.event.created_at * 1000).toISOString();
  const image = `${canonical}/opengraph-image`;
  return {
    title: state.title,
    description: summary,
    alternates: { canonical },
    authors: [{ name: state.event.pubkey }],
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: state.title,
      description: summary,
      url: canonical,
      publishedTime,
      modifiedTime: state.updatedAt.toISOString(),
      authors: [state.event.pubkey],
      images: [image],
    },
    twitter: { card: "summary_large_image", title: state.title, description: summary, images: [image] },
  };
}

export default async function NipRoute({ params }: { params: Promise<{ id: string }> }) {
  const address = decodeNipAddress((await params).id);
  if (!address) notFound();

  const state = await loadState(address.coordinate);
  if (state.status !== "active") {
    after(async () => {
      try {
        await enqueueNipCoordinateIfCapacity(address.coordinate);
      } catch (error) {
        console.error("Failed to enqueue lazy NIP indexing", error);
      }
    });
  }
  if (state.status === "deleted") notFound();

  const initialNip: InitialNipData | undefined =
    state.status === "active"
      ? { coordinate: address.coordinate, canonicalId: address.canonicalId, event: state.event }
      : undefined;
  const jsonLd =
    state.status === "active"
      ? {
          "@context": "https://schema.org",
          "@type": "TechArticle",
          headline: state.title,
          description: description(state.summary, state.event.content),
          datePublished: new Date(state.event.created_at * 1000).toISOString(),
          dateModified: state.updatedAt.toISOString(),
          mainEntityOfPage: new URL(`/nip/${address.canonicalId}`, process.env.SITE_URL ?? "http://localhost:3000").href,
          author: { "@type": "Person", name: state.event.pubkey },
        }
      : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}
      <ClientAppLoader initialNip={initialNip} nipRoute />
    </>
  );
}
