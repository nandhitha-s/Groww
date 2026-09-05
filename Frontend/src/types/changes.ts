import type { ChangeEventSeverity, ChangeEventType } from './marketState';

/** Mirrors the backend's ChangeEventListItem (Phase 9: GET /api/changes).
 * Unlike ChangeEventSummary (a transient detection result from the "seen"
 * flow), this is a persisted row -- it carries the event's own id and
 * acknowledgement state. old_value/new_value follow the same Decimal-as-
 * string convention as the rest of the app. */
export interface ChangeEventListItem {
  id: string;
  stock_id: string;
  symbol: string;
  watchlist_id: string | null;
  type: ChangeEventType;
  severity: ChangeEventSeverity;
  title: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
  acknowledged_at: string | null;
}

export interface ChangeEventListResponse {
  items: ChangeEventListItem[];
  limit: number;
  count: number;
}

export interface ListChangesParams {
  severity?: ChangeEventSeverity;
  type?: ChangeEventType;
  stock_id?: string;
  limit?: number;
}
