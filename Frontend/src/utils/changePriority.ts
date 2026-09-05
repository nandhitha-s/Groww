/** Phase 6's severity is the source of truth -- no new scoring here, just
 * an ordering. Anything outside the known set (e.g. a future LOW/CRITICAL,
 * or an unrecognized value) sorts after HIGH/MEDIUM rather than crashing. */
const SEVERITY_RANK: Record<string, number> = {
  HIGH: 0,
  MEDIUM: 1,
};

function rankFor(severity: string): number {
  return SEVERITY_RANK[severity] ?? 2;
}

interface Prioritizable {
  severity: string;
  detected_at: string;
}

/** Sorts changes (or, since Phase 6C, Market Signals -- both shapes carry
 * just `severity`/`detected_at`) by severity (HIGH, then MEDIUM, then
 * anything else), and within the same severity, most-recently-detected
 * first. Pure and side-effect free -- never mutates the input array. */
export function sortChangesByPriority<T extends Prioritizable>(changes: T[]): T[] {
  return [...changes].sort((a, b) => {
    const rankDiff = rankFor(a.severity) - rankFor(b.severity);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
  });
}
