"use client";

import { useMemo } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { findStellarWallet } from "@/lib/privy/stellar-wallet";
import { privySigner } from "@/lib/signing/privy";
import { type Session, SessionContext } from "./session";

/**
 * The Privy session: an email address, an embedded wallet Privy custodies, and
 * a key that signs hashes on request. No seed phrase is shown at any point.
 */
export function PrivySessionProvider({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#101820" },
        // Stellar wallets are created explicitly through /extended-chains.
        // These are off so signing in does not mint EVM or Solana wallets.
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <CurrentSession>{children}</CurrentSession>
    </PrivyProvider>
  );
}

function CurrentSession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();

  const address = findStellarWallet(user)?.address ?? null;
  const label = user?.email?.address ?? "Signed in";

  const value = useMemo<Session>(
    () => ({
      ready,
      connected: authenticated,
      address,
      label,
      connect: async () => login(),
      disconnect: () => logout(),
      createWallet: async () => {
        await createWallet({ chainType: "stellar" });
      },
      signer: address ? privySigner(address, signRawHash) : null,
    }),
    [ready, authenticated, address, label, login, logout, createWallet, signRawHash],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
