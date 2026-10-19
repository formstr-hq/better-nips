import type { Metadata } from "next";
import { ClientAppLoader } from "../../src/components/ClientAppLoader";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}): Promise<Metadata> {
  const path = (await params).path ?? [];
  const privateRoute = ["settings", "notifications", "new", "edit"].includes(path[0] ?? "");
  return privateRoute
    ? { robots: { index: false, follow: false } }
    : { alternates: { canonical: "/" } };
}

export default function AppPage() {
  return <ClientAppLoader />;
}
