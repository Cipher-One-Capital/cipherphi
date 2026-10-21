"use client";

import { createContext, useContext } from "react";
import type { Signer } from "@/lib/signing/signer";

/**
 * Everything the page knows about whose wallet it is working with. The page is
 * written against this and nothing else, so every Privy call stays in
 * `privy-session.tsx` and `lib/signing/privy.ts`.
 */
export type Session = {
  /** The wallet layer has started and restored whatever it remembers. */
  ready: boolean;
  /** Somebody is signed in. */
  connected: boolean;
  /** The Stellar account, once the embedded wallet exists. */
  address: string | null;
  /** The signed-in email address. Shown on the page, never sent on chain. */
  label: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Create the embedded Stellar wallet, if there is none yet. */
  createWallet: () => Promise<void>;
  signer: Signer | null;
  /** True when a test key in this tab stands in for Privy's email sign-in. */
  local?: boolean;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a wallet provider.");
  return session;
}
