import { NextResponse } from "next/server";
import { decodeNipAddress } from "../../../src/nostr/coordinates";
import { enqueueNipCoordinateIfCapacity } from "../../../src/server/queue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8192) return NextResponse.json({ error: "Request too large" }, { status: 413 });

  let coordinate: unknown;
  try {
    const body = await request.text();
    if (body.length > 8192) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    coordinate = JSON.parse(body).coordinate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof coordinate !== "string") {
    return NextResponse.json({ error: "Missing coordinate" }, { status: 400 });
  }
  const address = decodeNipAddress(coordinate);
  if (!address) return NextResponse.json({ error: "Invalid NIP coordinate" }, { status: 400 });

  try {
    const queued = await enqueueNipCoordinateIfCapacity(address.coordinate);
    return NextResponse.json({ queued }, { status: queued ? 202 : 200 });
  } catch (error) {
    console.error("Failed to queue NIP indexing", error);
    return NextResponse.json({ queued: false }, { status: 503 });
  }
}
