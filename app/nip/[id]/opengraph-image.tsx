import { ImageResponse } from "next/og";
import { decodeNipAddress } from "../../../src/nostr/coordinates";
import { APP_NAME, APP_TAGLINE } from "../../../src/nostr/constants";
import { getIndexedNip } from "../../../src/server/repository";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({ params }: { params: Promise<{ id: string }> }) {
  const address = decodeNipAddress((await params).id);
  const state = address ? await getIndexedNip(address.coordinate).catch(() => null) : null;
  const title = state?.status === "active" ? state.title : APP_NAME;
  const summary = state?.status === "active" ? state.summary : APP_TAGLINE;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        color: "#e9ecf3",
        background: "linear-gradient(145deg, #000 20%, #191e28)",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ color: "#e0a23b", fontSize: 34, fontWeight: 700 }}>{APP_NAME}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 68, lineHeight: 1.05, fontWeight: 700 }}>{title.slice(0, 100)}</div>
        <div style={{ color: "#9aa3b5", fontSize: 30, lineHeight: 1.3 }}>{summary.slice(0, 180)}</div>
      </div>
    </div>,
    size,
  );
}
