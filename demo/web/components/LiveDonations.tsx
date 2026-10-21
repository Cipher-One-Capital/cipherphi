"use client";

import { useEffect, useState } from "react";
import { scValToNative } from "@stellar/stellar-sdk";
import { Tip } from "@/components/Tips";
import { BOT, POOL, TREASURY, explorer, formatAmount, rpcServer } from "@/lib/stellar";

type Donation = { id: string; hash: string; amount: bigint; at: number };

/** How often the ledger is asked for new donations. */
const POLL_MS = 6000;
/** How far back the strip looks on first load: about a day of ledgers. */
const LOOKBACK = 17_280;

/**
 * A strip under the testnet banner with the latest donation to the pool, read
 * from the pool's Contribution events on testnet and refreshed every few
 * seconds. Shows the amount, when, and a link to the transaction; never the
 * donor's address. The treasury's seed contribution is left out, since it is
 * not a donation, and so are the retired demo bot's gifts.
 */
export function LiveDonations() {
  const [donations, setDonations] = useState<Donation[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    const server = rpcServer();
    let cursor: string | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const filters = [{ type: "contract" as const, contractIds: [POOL] }];
        const first = cursor === undefined;
        const events = [];
        // The node scans a bounded window per call and returns a cursor to go
        // on from, sometimes with an empty page, so follow it to the latest ledger.
        for (let page = 0; page < 20; page++) {
          let res;
          if (cursor) {
            res = await server.getEvents({ filters, cursor, limit: 200 });
          } else {
            const { sequence } = await server.getLatestLedger();
            res = await server.getEvents({ filters, startLedger: Math.max(1, sequence - LOOKBACK), limit: 200 });
          }
          events.push(...res.events);
          cursor = res.cursor;
          if (cursorLedger(res.cursor) >= res.latestLedger) break;
        }
        const found: Donation[] = [];
        for (const e of events) {
          const [kind, contributor] = e.topic.map((t) => scValToNative(t));
          if (kind !== "contribution" || contributor === TREASURY || contributor === BOT) continue;
          const value = scValToNative(e.value) as { amount: bigint };
          found.push({
            id: e.id,
            hash: e.txHash,
            amount: value.amount,
            at: Date.parse(e.ledgerClosedAt),
          });
        }
        if (!stopped) {
          setDonations((prev) => {
            const seen = new Set((prev ?? []).map((d) => d.id));
            const added = found.filter((d) => !seen.has(d.id));
            if (!first && added.length) setFresh(added[added.length - 1].id);
            return [...(prev ?? []), ...added].slice(-50);
          });
        }
      } catch {
        // A missed poll is retried on the next tick; the strip keeps what it has.
        if (!stopped) setDonations((prev) => prev ?? []);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    poll();
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, []);

  if (donations === null) return null;
  const day = donations.filter((d) => now - d.at < 24 * 3600 * 1000);
  const latest = donations[donations.length - 1];

  return (
    <Tip id="live" block center>
      <div className="live" role="status" aria-label="Live donations">
        <span className="live-dot" aria-hidden="true" />
        <span className="live-label">Live</span>
        {latest ? (
          <>
            <span key={latest.id} className={latest.id === fresh ? "live-item fresh" : "live-item"}>
              <strong>{formatAmount(latest.amount)} USDC</strong>{" "}
              given to the zakat pool {ago(now - latest.at)}.{" "}
              <a href={explorer.tx(latest.hash)} target="_blank" rel="noreferrer">
                View<span className="sr-only"> this donation on Stellar Expert</span>
              </a>
            </span>
            <span className="live-count">
              {day.length} {day.length === 1 ? "donation" : "donations"} in the last 24 hours
            </span>
          </>
        ) : (
          <span className="live-item">No donations in the last 24 hours yet.</span>
        )}
      </div>
    </Tip>
  );
}

/** The ledger a getEvents cursor points at: the high 32 bits of its TOID. */
function cursorLedger(cursor: string): number {
  return Number(BigInt(cursor.split("-")[0]) >> 32n);
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}
