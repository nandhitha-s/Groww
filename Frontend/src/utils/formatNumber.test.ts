import { describe, expect, it } from 'vitest';
import {
  changeDirection,
  formatCompactVolume,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
} from './formatNumber';

describe('formatCurrency', () => {
  it('formats a numeric string as INR currency', () => {
    expect(formatCurrency('1322.0')).toBe('₹1,322.00');
  });

  it('formats a plain number', () => {
    expect(formatCurrency(1322)).toBe('₹1,322.00');
  });

  it('returns a placeholder for null/undefined without inventing a value', () => {
    expect(formatCurrency(null)).toBe('--');
    expect(formatCurrency(undefined)).toBe('--');
  });
});

describe('formatSignedCurrency', () => {
  it('prefixes a positive value with +', () => {
    expect(formatSignedCurrency('19.5')).toBe('+₹19.50');
  });

  it('prefixes a negative value with -', () => {
    expect(formatSignedCurrency('-22.5')).toBe('-₹22.50');
  });

  it('has no sign for zero', () => {
    expect(formatSignedCurrency('0')).toBe('₹0.00');
  });
});

describe('formatPercent', () => {
  it('formats a positive percent with +', () => {
    expect(formatPercent('1.5')).toBe('+1.50%');
  });

  it('formats a negative percent with -', () => {
    expect(formatPercent('-1.734')).toBe('-1.73%');
  });
});

describe('formatCompactVolume', () => {
  it('uses Cr for values >= 1 crore', () => {
    expect(formatCompactVolume(12537650)).toBe('1.25Cr');
  });

  it('uses L for values >= 1 lakh', () => {
    expect(formatCompactVolume(1234567)).toBe('12.35L');
  });

  it('uses K for values >= 1 thousand', () => {
    expect(formatCompactVolume(1500)).toBe('1.5K');
  });

  it('returns the plain number below 1 thousand', () => {
    expect(formatCompactVolume(176)).toBe('176');
  });
});

describe('changeDirection', () => {
  it('is up for a positive change', () => {
    expect(changeDirection('19.5')).toBe('up');
  });

  it('is down for a negative change', () => {
    expect(changeDirection('-22.5')).toBe('down');
  });

  it('is flat for zero or missing change', () => {
    expect(changeDirection('0')).toBe('flat');
    expect(changeDirection(null)).toBe('flat');
    expect(changeDirection(undefined)).toBe('flat');
  });
});
