import { describe, expect, it } from 'vitest';

import {
  fromBackendProfile,
  fromBackendCommunityReport,
  isAllowedApiBaseUrl,
  resolveApiBaseUrl,
  toBackendCommunityReport,
  toBackendProfile,
  toBackendSOS,
} from './safetyApi.js';

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
});
