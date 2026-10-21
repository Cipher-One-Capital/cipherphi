"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { privySigner } from "@/lib/signing/privy";
import { type Session, SessionContext } from "./session";

const STORE = "cipherphi-demo-local-key";

/**
 * A throwaway testnet key in this tab's session storage, in place of Privy,
 * for when no Privy app is configured. It goes through the same `privySigner`
 * the real session uses, so the hash-sign-attach path is the production one.
 * The page says when it is in use; see `app/providers.tsx` for when it is
 * mounted.
 */
export function LocalSessionProvider({ children }: { children: React.ReactNode }) {
  // False while prerendering on the server, true in the browser.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [chosen, setKp] = useState<Keypair | null | undefined>(undefined);
  const kp = chosen !== undefined ? chosen : ready ? restore() : null;

  const value = useMemo<Session>(
    () => ({
      ready,
      connected: kp !== null,
      address: kp?.publicKey() ?? null,
      label: "test key in this tab",
      local: true,
      connect: async () => {
        const fresh = Keypair.random();
        try {
          sessionStorage.setItem(STORE, fresh.secret());
        } catch {}
        setKp(fresh);
      },
      disconnect: async () => {
        try {
          sessionStorage.removeItem(STORE);
        } catch {}
        setKp(null);
      },
      createWallet: async () => {},
      signer: kp
        ? privySigner(kp.publicKey(), async ({ hash }) => ({
            signature: `0x${kp.sign(Buffer.from(hash.slice(2), "hex")).toString("hex")}`,
          }))
        : null,
    }),
    [ready, kp],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function restore(): Keypair | null {
  try {
    const secret = sessionStorage.getItem(STORE);
    return secret ? Keypair.fromSecret(secret) : null;
  } catch {
    return null;
  }
}
