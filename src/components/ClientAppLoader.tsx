"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { InitialNipData } from "../nostr/initialNip";
import { parseNip } from "../nostr/nips";
import { APP_NAME, APP_TAGLINE } from "../nostr/constants";
import { BrandMark } from "./BrandMark";
import { NipDocument } from "./NipDocument";

type BrowserApp = ComponentType<{ initialNip?: InitialNipData }>;

function PublicHeader() {
  return (
    <header className="topbar">
      <a className="brand" href="/" title={APP_TAGLINE}>
        <BrandMark />
        <span className="brand-text">
          <span className="brand-name">{APP_NAME}</span>
          <span className="brand-sub">{APP_TAGLINE}</span>
        </span>
      </a>
      <span className="btn">Connect</span>
    </header>
  );
}

function NipFallback({ initialNip }: { initialNip?: InitialNipData }) {
  const nip = initialNip ? parseNip(initialNip.event) : null;
  return (
    <div className="app">
      <PublicHeader />
      <main className="content">
        {nip ? (
          <article className="nip-page">
            <div className="nip-page-nav">
              <a className="back-link" href="/">
                &larr; Back to NIPs
              </a>
            </div>
            <NipDocument nip={nip} />
          </article>
        ) : (
          <div className="nip-page">
            <a className="back-link" href="/">
              &larr; Back to NIPs
            </a>
            <div className="card skeleton" aria-label="Loading NIP">
              <div className="sk-row" />
              <div className="sk-title" />
              <div className="sk-line" />
              <div className="sk-line short" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AppFallback() {
  return (
    <div className="app">
      <PublicHeader />
      <main className="content">
        <div className="card skeleton" aria-label="Loading NIPs">
          <div className="sk-row" />
          <div className="sk-title" />
          <div className="sk-line" />
        </div>
      </main>
    </div>
  );
}

export function ClientAppLoader({
  initialNip,
  nipRoute = false,
}: {
  initialNip?: InitialNipData;
  nipRoute?: boolean;
}) {
  const [BrowserApp, setBrowserApp] = useState<BrowserApp | null>(null);

  useEffect(() => {
    let active = true;
    void import("../App").then((module) => {
      if (active) setBrowserApp(() => module.default);
    });
    return () => {
      active = false;
    };
  }, []);

  if (BrowserApp) return <BrowserApp initialNip={initialNip} />;
  return nipRoute ? <NipFallback initialNip={initialNip} /> : <AppFallback />;
}
