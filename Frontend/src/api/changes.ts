import { request } from './client';
import type { ChangeEventListItem, ChangeEventListResponse, ListChangesParams } from '../types/changes';

export function getChanges(params: ListChangesParams = {}): Promise<ChangeEventListResponse> {
  const query = new URLSearchParams();
  if (params.severity) query.set('severity', params.severity);
  if (params.type) query.set('type', params.type);
  if (params.stock_id) query.set('stock_id', params.stock_id);
  if (params.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  return request<ChangeEventListResponse>(`/api/changes${qs ? `?${qs}` : ''}`);
}

export function acknowledgeChange(id: string): Promise<ChangeEventListItem> {
  return request<ChangeEventListItem>(`/api/changes/${id}/acknowledge`, { method: 'POST' });
}
