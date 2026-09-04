import { request } from './client';

export { ApiError } from './client';

export interface UserPublic {
  id: string;
  name: string;
  email: string;
}

export function registerRequest(input: {
  name: string;
  email: string;
  password: string;
}): Promise<UserPublic> {
  return request<UserPublic>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function loginRequest(input: { email: string; password: string }): Promise<UserPublic> {
  return request<UserPublic>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function logoutRequest(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function meRequest(): Promise<UserPublic> {
  return request<UserPublic>('/api/auth/me', { method: 'GET' });
}
