import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fromBackendProfile,
  fromBackendCommunityReport,
  isAllowedApiBaseUrl,
  loadBackendCurrentUser,
  listBackendNotifications,
  markBackendNotificationRead,
  logoutBackendAccount,
  resolveApiBaseUrl,
  revokeAllBackendSessions,
  toBackendCommunityReport,
  toBackendProfile,
  toBackendSOS,
  updateBackendBatteryStatus,
  uploadBackendEvidence,
} from './safetyApi.js';

afterEach(() => {
  sessionStorage.removeItem('sahara-backend-access-token');
  vi.unstubAllGlobals();
});

describe('safetyApi', () => {
  it('API base URL defaults locally but remains unset in production', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe('http://127.0.0.1:8000');
    expect(resolveApiBaseUrl(undefined, false)).toBe('');
    expect(resolveApiBaseUrl(' https://api.example.test/// ', false)).toBe('https://api.example.test');
  });

  it('community feed mapper preserves report coordinates and marks the backend source', () => {
    expect(fromBackendCommunityReport({
      id: 12,
      latitude: 12.5,
      longitude: 77.6,
      type: 'POOR_LIGHTING',
      description: 'Dim street',
      severity: 2,
      timestamp: '2025-01-01T00:00:00Z',
    })).toEqual({
      id: 'backend-12',
      type: 'Poor lighting',
      note: 'Dim street',
      point: [12.5, 77.6],
      time: '2025-01-01T00:00:00Z',
      source: 'backend',
      severity: 2,
    });
  });

  it('backend bearer tokens are only sent over HTTPS or local development HTTP', () => {
    expect(isAllowedApiBaseUrl('https://api.example.test', false)).toBe(true);
    expect(isAllowedApiBaseUrl('http://api.example.test', false)).toBe(false);
    expect(isAllowedApiBaseUrl('http://localhost:8000', true)).toBe(true);
    expect(isAllowedApiBaseUrl('http://api.example.test', true)).toBe(false);
  });

  it('profile mapper uses the existing backend profile contract', () => {
    expect(toBackendProfile({
      name: 'Asha',
      email: 'asha@example.test',
      phone: '+10000000000',
      blood: 'O+',
      home: 'North',
      language: 'English',
    })).toEqual({
      name: 'Asha',
      email: 'asha@example.test',
      phone: '+10000000000',
      blood_group: 'O+',
      home_location: 'North',
      preferred_language: 'English',
    });
    expect(fromBackendProfile({ name: 'Asha', blood_group: 'O+' }).blood).toBe('O+');
  });

  it('community report mapper emits only supported backend report types', () => {
    expect(toBackendCommunityReport({
      type: 'Unsafe Area',
      note: 'Poor visibility',
      point: [12.5, 77.6],
    })).toEqual({
      type: 'UNSAFE_AREA',
      latitude: 12.5,
      longitude: 77.6,
      description: 'Poor visibility',
      severity: 1,
    });
    expect(toBackendCommunityReport({ type: 'Unknown', point: [0, 0] })).toBeNull();
  });

  it('SOS mapper emits the authenticated FastAPI SOS schema without contact claims', () => {
    expect(toBackendSOS({
      coordinates: [12.5, 77.6],
      journey: { backendJourneyId: 42 },
    })).toEqual({
      trigger_type: 'MANUAL',
      journey_id: 42,
      latitude: 12.5,
      longitude: 77.6,
    });
    expect(toBackendSOS({ coordinates: null, journey: {} })).toEqual({
      trigger_type: 'MANUAL',
    });
  });

  it('restores a session from the backend current-user contract without caching the request', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: { id: 7, name: 'Asha', email: 'asha@example.test' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadBackendCurrentUser()).resolves.toMatchObject({
      synced: true,
      data: { id: 7, name: 'Asha', email: 'asha@example.test' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/auth/me',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'omit',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('clears a revoked token and notifies the app when session restoration returns 401', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'revoked-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: false, message: 'Invalid or expired authentication token.' }),
    });
    const expiryHandler = vi.fn();
    window.addEventListener('sahara:auth-expired', expiryHandler);
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadBackendCurrentUser()).resolves.toMatchObject({ synced: false, status: 'not-authenticated' });
    expect(sessionStorage.getItem('sahara-backend-access-token')).toBeNull();
    expect(expiryHandler).toHaveBeenCalledOnce();
    window.removeEventListener('sahara:auth-expired', expiryHandler);
  });

  it('calls current-device logout and clears the tab credential', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: { logged_out: true } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutBackendAccount()).resolves.toMatchObject({ synced: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sessionStorage.getItem('sahara-backend-access-token')).toBeNull();
  });

  it('revokes all backend sessions through the existing logout-all endpoint', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: { logged_out: 2 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(revokeAllBackendSessions()).resolves.toMatchObject({
      synced: true,
      data: { logged_out: 2 },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/auth/logout-all',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(sessionStorage.getItem('sahara-backend-access-token')).toBeNull();
  });

  it('loads account notifications and marks one notification read through existing routes', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: [{ id: 8, type: 'SOS', message: 'SOS recorded', read: false }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: { id: 8, read: true } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listBackendNotifications()).resolves.toMatchObject({
      synced: true,
      data: [{ id: 8, type: 'SOS', read: false }],
    });
    await expect(markBackendNotificationRead(8)).resolves.toMatchObject({ synced: true, data: { id: 8, read: true } });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8000/api/notifications',
      'http://127.0.0.1:8000/api/notifications/8/read',
    ]);
  });

  it('sends a battery percentage and timestamp without attaching location', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: { battery_percentage: 57 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await updateBackendBatteryStatus(57, '2026-10-09T00:00:00.000Z');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8000/api/battery/update',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ battery_percentage: 57, timestamp: '2026-10-09T00:00:00.000Z' }),
      }),
    );
  });

  it('uploads evidence using the backend multipart contract', async () => {
    sessionStorage.setItem('sahara-backend-access-token', 'test-token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: { id: 19, filename: 'photo.jpg', type: 'photo' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['image bytes'], 'photo.jpg', { type: 'image/jpeg' });
    await expect(uploadBackendEvidence({ type: 'photo', file, description: 'photo.jpg' }))
      .resolves.toMatchObject({ synced: true, data: { id: 19 } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/api/evidence/upload');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('type')).toBe('photo');
    expect(options.body.get('description')).toBe('photo.jpg');
    expect(options.body.get('file').name).toBe('photo.jpg');
    expect(options.headers).toEqual({ Authorization: 'Bearer test-token' });
  });
});
