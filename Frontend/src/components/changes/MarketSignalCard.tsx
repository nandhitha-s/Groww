import { ChangeCard } from './ChangeCard';
import type { MarketSignalSummary } from '../../types/marketState';

interface MarketSignalCardProps {
  signal: MarketSignalSummary;
  linkTo?: string;
  linkState?: unknown;
}

/**
 * Phase 6C: renders exactly one ephemeral Market Signal. Deliberately reuses
 * the same `ChangeCard` presentation as a real meaningful change (same
 * severity badge, same typography) since the "Market Signals" section
 * heading is what actually distinguishes it from "Needs your attention" --
 * not a second, competing card design (Step 11: fix the wiring, don't
 * invent another component if reusing the existing one is straightforward).
 *
 * No old_value/new_value here (there is no "since you last checked"
 * comparison for a signal) -- passed as null, which ChangeCard already
 * renders as a neutral "activity" icon rather than an up/down arrow.
 */
export function MarketSignalCard({ signal, linkTo, linkState }: MarketSignalCardProps) {
  return (
    <ChangeCard
      change={{
        stock_id: signal.stock_id,
        symbol: signal.symbol,
        type: signal.type,
        severity: signal.severity,
        title: signal.title,
        description: signal.description,
        old_value: null,
        new_value: null,
      }}
      linkTo={linkTo}
      linkState={linkState}
    />
  );
}
