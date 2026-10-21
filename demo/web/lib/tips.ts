/**
 * The first-run tips, in the order a visitor meets them. Each says what the
 * thing is and why the demo shows it. Only tips whose target is on screen take
 * part; the earliest unseen one is shown. `after` holds a tip back until
 * another has been seen, for targets that are on screen from the start.
 */
export const TIPS: readonly { id: string; title: string; body: string; after?: string }[] = [
  {
    id: "start",
    title: "Start here",
    body: "Creates a throwaway test wallet in this browser tab. A real donor signs in with an email instead; the demo skips that so anyone can try it in seconds.",
  },
  {
    id: "setup",
    title: "Setting you up",
    body: "Opens a Stellar testnet account for you and funds it with 10 test USDC. The demo pays every network fee, so you never touch crypto. Pilot donors bring their own USDC.",
  },
  {
    id: "balance",
    title: "Your test balance",
    body: "Read live from the ledger, not from this page. Test USDC has no value, so you can give it away freely.",
  },
  {
    id: "give",
    title: "Give your zakat",
    body: "Sends 5 USDC to the zakat pool contract. From here the contract decides what happens to it, not CipherPhi. Takes up to 30 seconds on testnet.",
  },
  {
    id: "split",
    title: "Where your zakat went",
    body: "The contract divided your gift across the eight zakat categories of Qur'an 9:60 the moment it arrived. These numbers come from the record the contract wrote, so nobody can edit them afterwards.",
  },
  {
    id: "split-note",
    title: "Placeholder percentages",
    body: "The demo uses made-up percentages. In the pilot, the Foundation's Shariah authority sets them, and donors do not choose them.",
  },
  {
    id: "live",
    after: "split",
    title: "Live donations",
    body: "Shows each donation to the pool as it lands on testnet, yours included.",
  },
  {
    id: "roles",
    title: "Two keys for every payout",
    body: "A payout needs a distributor to send it and 2 of 3 eligibility signers to approve it. Neither side can move funds alone. In this demo one server holds both; in the pilot, separate people do.",
  },
  {
    id: "release",
    title: "Pay a partner, with approval",
    body: "Sends 1 USDC from the share for the poor to a vetted partner organisation, with 2 of 3 approvals attached. The contract checks every signature before any money moves.",
  },
  {
    id: "refuse",
    title: "Now try to cheat",
    body: "Sends the same payout with no approvals. The demo shows this so you can watch the contract refuse it, on the public ledger.",
  },
  {
    id: "paid",
    title: "Paid",
    body: "Approved, so the contract paid. The approval fingerprint ties this payout to the exact approval that allowed it.",
  },
  {
    id: "refused",
    title: "Refused",
    body: "No approvals, so the contract said no and nothing moved. The failed attempt is public too: that is the proof the rule is enforced, not just promised.",
  },
  {
    id: "receipt",
    title: "Check it yourself",
    body: "Your receipt links every step to Stellar Expert, a public explorer CipherPhi does not run. You do not have to trust this page.",
  },
  {
    id: "verify",
    title: "Verify the system",
    body: "The contract code hash rebuilds from the published source. Matching it proves the pool runs the code it claims to.",
  },
];

export type TipId = string;
