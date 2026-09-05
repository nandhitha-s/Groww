import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { HistoricalCandle } from '../../types/marketData';
import { formatCurrency } from '../../utils/formatNumber';
import styles from './PriceChart.module.css';

interface PriceChartProps {
  candles: HistoricalCandle[];
}

const VIEW_W = 640;
const VIEW_H = 300;
const MARGIN_LEFT = 56;
const MARGIN_BOTTOM = 28;
const MARGIN_TOP = 14;
const MARGIN_RIGHT = 12;
const PLOT_W = VIEW_W - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_H = VIEW_H - MARGIN_TOP - MARGIN_BOTTOM;
const X_TICK_FRACTIONS = [0, 1 / 3, 2 / 3, 1];
const Y_TICK_FRACTIONS = [0, 0.5, 1];

function formatAxisPrice(value: number): string {
  const digits = value >= 1000 ? 0 : 2;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatAxisDate(iso: string, spanMs: number): string {
  const date = new Date(iso);
  if (spanMs <= 2 * 24 * 60 * 60 * 1000) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTooltipDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A smoothed line through every point, using a quadratic curve to the
 * midpoint between each pair -- gives a clean, professional-looking line
 * without any charting library. */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x},${p0.y} ${midX},${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

/**
 * A small, dependency-free line/area chart for one stock's price history
 * (Phase 8), with labeled axes. Deliberately not a general-purpose charting
 * component -- just enough to render real candle closes clearly, with a
 * hover tooltip. Real data only: an empty candle list renders a message,
 * never a fabricated line.
 */
export function PriceChart({ candles }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const closes = candles.map((c) => Number(c.close));
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const n = closes.length;
    const points = closes.map((value, i) => ({
      x: n <= 1 ? MARGIN_LEFT + PLOT_W / 2 : MARGIN_LEFT + (i / (n - 1)) * PLOT_W,
      y: MARGIN_TOP + (1 - (value - min) / range) * PLOT_H,
    }));
    const lineD = buildSmoothPath(points);
    const areaD =
      points.length > 0
        ? `${lineD} L${VIEW_W - MARGIN_RIGHT},${VIEW_H - MARGIN_BOTTOM} L${MARGIN_LEFT},${VIEW_H - MARGIN_BOTTOM} Z`
        : '';
    const positive = closes.length > 0 && closes[closes.length - 1] >= closes[0];

    const spanMs =
      candles.length > 1
        ? new Date(candles[candles.length - 1].timestamp).getTime() - new Date(candles[0].timestamp).getTime()
        : 0;

    const yTicks = Y_TICK_FRACTIONS.map((f) => ({
      y: MARGIN_TOP + f * PLOT_H,
      label: formatAxisPrice(max - f * range),
    }));

    const xTickIndices = Array.from(
      new Set(X_TICK_FRACTIONS.map((f) => Math.round(f * (n - 1)))),
    ).filter((i) => i >= 0 && i < n);
    const xTicks = xTickIndices.map((i) => ({
      x: points[i].x,
      label: formatAxisDate(candles[i].timestamp, spanMs),
    }));

    return { points, lineD, areaD, positive, yTicks, xTicks };
  }, [candles]);

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (chart.points.length === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xFraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const plotFraction = Math.min(
      1,
      Math.max(0, (xFraction * VIEW_W - MARGIN_LEFT) / PLOT_W),
    );
    setHoverIndex(Math.round(plotFraction * (chart.points.length - 1)));
  }

  if (candles.length === 0) {
    return <div className={styles.empty}>No price history available.</div>;
  }

  const hoveredPoint = hoverIndex !== null ? chart.points[hoverIndex] : null;
  const hoveredCandle = hoverIndex !== null ? candles[hoverIndex] : null;
  const lineColor = chart.positive ? 'var(--color-success-500)' : 'var(--color-danger-500)';
  const gradientId = chart.positive ? 'priceChartUp' : 'priceChartDown';

  let tooltipTransform = 'translate(-50%, -100%)';
  if (hoveredPoint) {
    const xFraction = hoveredPoint.x / VIEW_W;
    if (xFraction > 0.8) tooltipTransform = 'translate(-100%, -100%)';
    else if (xFraction < 0.15) tooltipTransform = 'translate(0, -100%)';
  }

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <svg className={styles.svg} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {chart.yTicks.map((tick) => (
          <line
            key={tick.y}
            x1={MARGIN_LEFT}
            x2={VIEW_W - MARGIN_RIGHT}
            y1={tick.y}
            y2={tick.y}
            className={styles.gridLine}
          />
        ))}

        {chart.areaD && <path d={chart.areaD} fill={`url(#${gradientId})`} stroke="none" />}
        <path d={chart.lineD} fill="none" stroke={lineColor} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />

        {/* Axis lines */}
        <line
          x1={MARGIN_LEFT}
          x2={MARGIN_LEFT}
          y1={MARGIN_TOP}
          y2={VIEW_H - MARGIN_BOTTOM}
          className={styles.axisLine}
        />
        <line
          x1={MARGIN_LEFT}
          x2={VIEW_W - MARGIN_RIGHT}
          y1={VIEW_H - MARGIN_BOTTOM}
          y2={VIEW_H - MARGIN_BOTTOM}
          className={styles.axisLine}
        />

        {hoveredPoint && (
          <line
            x1={hoveredPoint.x}
            x2={hoveredPoint.x}
            y1={MARGIN_TOP}
            y2={VIEW_H - MARGIN_BOTTOM}
            className={styles.hoverLine}
          />
        )}
        {hoveredPoint && (
          <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={4} fill={lineColor} stroke="var(--color-surface)" strokeWidth={2} />
        )}
      </svg>

      {chart.yTicks.map((tick) => (
        <span
          key={tick.y}
          className={styles.yLabel}
          style={{ top: `${(tick.y / VIEW_H) * 100}%`, transform: 'translateY(-50%)' }}
        >
          {tick.label}
        </span>
      ))}

      {chart.xTicks.map((tick, i) => (
        <span
          key={tick.x}
          className={styles.xLabel}
          style={{
            left: `${(tick.x / VIEW_W) * 100}%`,
            top: `${((VIEW_H - MARGIN_BOTTOM + 8) / VIEW_H) * 100}%`,
            transform:
              i === 0
                ? 'translateX(0)'
                : i === chart.xTicks.length - 1
                  ? 'translateX(-100%)'
                  : 'translateX(-50%)',
          }}
        >
          {tick.label}
        </span>
      ))}

      {hoveredPoint && hoveredCandle && (
        <div
          className={styles.tooltip}
          style={{
            left: `${(hoveredPoint.x / VIEW_W) * 100}%`,
            top: `${(hoveredPoint.y / VIEW_H) * 100}%`,
            transform: tooltipTransform,
          }}
        >
          <div className={styles.tooltipPrice}>{formatCurrency(hoveredCandle.close)}</div>
          <div className={styles.tooltipDate}>{formatTooltipDate(hoveredCandle.timestamp)}</div>
        </div>
      )}
    </div>
  );
}
