"use client";

import { LocalSessionProvider } from "@/lib/wallet/local-session";
import { PrivySessionProvider } from "@/lib/wallet/privy-session";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Privy when an app ID is configured. Without one, a development build falls
 * back to a test key held in the tab, and so does a production build that
 * opts in with `NEXT_PUBLIC_DEMO_LOCAL_WALLET=1`, which the page then labels
 * as such. Otherwise a production build says plainly what is missing.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  if (appId) return <PrivySessionProvider appId={appId}>{children}</PrivySessionProvider>;
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_LOCAL_WALLET === "1") {
    return <LocalSessionProvider>{children}</LocalSessionProvider>;
  }
  return (
    <main className="shell">
      <h1>Missing configuration</h1>
      <p>
        <code>NEXT_PUBLIC_PRIVY_APP_ID</code> is not set for this deployment, so email sign-in
        cannot start.
      </p>
    </main>
  );
}
