/**
 * Presentation-only formatting -- never mutates or rounds the underlying
 * value used for logic/comparisons, only the string shown to the user.
 */

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

export function formatCurrency(value: number | string | null | undefined): string {
  const num = toNumber(value);
  return num === null ? '--' : currencyFormatter.format(num);
}

export function formatSignedCurrency(value: number | string | null | undefined): string {
  const num = toNumber(value);
  if (num === null) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}${currencyFormatter.format(Math.abs(num))}`;
}

export function formatPercent(value: number | string | null | undefined): string {
  const num = toNumber(value);
  if (num === null) return '--';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
}

/** Indian lakh/crore-style compact notation, matching the rupee-denominated data. */
export function formatCompactVolume(value: number | null | undefined): string {
  const num = toNumber(value);
  if (num === null) return '--';
  const abs = Math.abs(num);
  if (abs >= 1e7) return `${(num / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(num / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return String(num);
}

export type ChangeDirection = 'up' | 'down' | 'flat';

export function changeDirection(value: number | string | null | undefined): ChangeDirection {
  const num = toNumber(value);
  if (num === null || num === 0) return 'flat';
  return num > 0 ? 'up' : 'down';
}
