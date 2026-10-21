/**
 * Credits to two decimal places, rounded down, so a balance just under a
 * whole credit doesn't show as the whole credit.
 */
export function formatCredits(credits: number): string {
  return (Math.floor(credits * 100) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}
