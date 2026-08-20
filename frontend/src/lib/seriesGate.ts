/** Drop stale K-line fetches when the user clicks through the watchlist fast. */

export function createSeriesGate() {
  let gen = 0;
  return {
    begin(): number {
      gen += 1;
      return gen;
    },
    isCurrent(mine: number): boolean {
      return mine === gen;
    },
    take<T>(mine: number, snap: T): T | null {
      return mine === gen ? snap : null;
    },
  };
}
