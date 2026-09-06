/**
 * Make bid: +10 + bid
 * Miss: −|tricks − bid|
 */
export function scoreHand(bid: number, tricks: number): number {
  if (bid === tricks) {
    return 10 + bid;
  }
  return -Math.abs(tricks - bid);
}

export function applyHandScores(
  bids: Record<string, number>,
  tricks: Record<string, number>,
  currentTotals: Record<string, number>,
): { deltas: Record<string, number>; totals: Record<string, number> } {
  const deltas: Record<string, number> = {};
  const totals: Record<string, number> = { ...currentTotals };
  for (const id of Object.keys(bids)) {
    const delta = scoreHand(bids[id]!, tricks[id] ?? 0);
    deltas[id] = delta;
    totals[id] = (totals[id] ?? 0) + delta;
  }
  return { deltas, totals };
}

/** Highest score wins; ties returned as multiple ids. */
export function winnersFromTotals(totals: Record<string, number>): string[] {
  const entries = Object.entries(totals);
  if (entries.length === 0) return [];
  const max = Math.max(...entries.map(([, s]) => s));
  return entries.filter(([, s]) => s === max).map(([id]) => id);
}
