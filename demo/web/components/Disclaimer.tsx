"use client";

import { useEffect, useRef } from "react";

const SEEN = "cipherphi-demo:disclaimer";

/**
 * Shown once per browser, on whichever page a visitor opens first. A native
 * modal dialog, so focus stays inside it and Escape closes it. Closing it any
 * way counts as read; the banner above every page repeats the short version.
 */
export function Disclaimer() {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN) === "1";
    } catch {}
    if (!seen) ref.current?.showModal();
  }, []);

  const remember = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {}
  };

  return (
    <dialog ref={ref} className="disclaimer" aria-labelledby="disclaimer-title" onClose={remember}>
      <h2 id="disclaimer-title">For testing only</h2>
      <p>This is a demo on Stellar testnet, a public network for testing.</p>
      <ul>
        <li>Nothing here moves real money. Every amount is testnet USDC, which has no value.</li>
        <li>Never send real funds to any address shown here.</li>
        <li>
          The contracts are unaudited. One server holds every demo key, which separate parties
          hold in the pilot.
        </li>
        <li>No personal data is written on chain.</li>
      </ul>
      <form method="dialog">
        <button className="btn" autoFocus>
          I understand
        </button>
      </form>
    </dialog>
  );
}
