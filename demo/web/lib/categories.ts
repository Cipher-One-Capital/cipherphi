/**
 * The eight zakat categories of Qur'an 9:60, in the contract's order. The
 * index is the `Category` discriminant the pool uses on chain.
 *
 * `share` is the demo split compiled into the contract, in basis points. It is
 * a placeholder for a testnet demonstration, not the Swiss Zakat Foundation's
 * allocation, and it has not been validated by its Shariah authority.
 */
export const CATEGORIES = [
  { name: "The poor", arabic: "al-fuqarāʾ", share: 3000 },
  { name: "The needy", arabic: "al-masākīn", share: 2000 },
  { name: "Zakat administration", arabic: "al-ʿāmilīn ʿalayhā", share: 1000 },
  { name: "Reconciling hearts", arabic: "al-muʾallafati qulūbuhum", share: 500 },
  { name: "Freeing captives", arabic: "fī al-riqāb", share: 500 },
  { name: "Relief of debt", arabic: "al-ghārimīn", share: 1500 },
  { name: "In the cause of God", arabic: "fī sabīl Allāh", share: 1000 },
  { name: "The wayfarer", arabic: "ibn al-sabīl", share: 500 },
] as const;

/** "the share for the poor": how copy names the category a payout comes from. */
export const shareFor = (category: number) => `the share for ${CATEGORIES[category].name.toLowerCase()}`;
