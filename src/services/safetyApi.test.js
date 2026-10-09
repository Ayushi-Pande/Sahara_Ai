import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fromBackendProfile,
  fromBackendCommunityReport,
  isAllowedApiBaseUrl,
  resolveApiBaseUrl,
  toBackendCommunityReport,
  toBackendProfile,
  toBackendSOS,
} from './safetyApi.js';

test('API base URL defaults locally but remains unset in production', () => {
  assert.equal(resolveApiBaseUrl(undefined, true), 'http://127.0.0.1:8000');
  assert.equal(resolveApiBaseUrl(undefined, false), '');
  assert.equal(resolveApiBaseUrl(' https://api.example.test/// ', false), 'https://api.example.test');
});

test('community feed mapper preserves report coordinates and marks the backend source', () => {
  assert.deepEqual(fromBackendCommunityReport({
    id: 12,
    latitude: 12.5,
    longitude: 77.6,
    type: 'POOR_LIGHTING',
    description: 'Dim street',
    severity: 2,
    timestamp: '2025-01-01T00:00:00Z',
  }), {
    id: 'backend-12',
    type: 'Poor lighting',
    note: 'Dim street',
    point: [12.5, 77.6],
    time: '2025-01-01T00:00:00Z',
    source: 'backend',
    severity: 2,
  });
});

test('backend bearer tokens are only sent over HTTPS or local development HTTP', () => {
  assert.equal(isAllowedApiBaseUrl('https://api.example.test', false), true);
  assert.equal(isAllowedApiBaseUrl('http://api.example.test', false), false);
  assert.equal(isAllowedApiBaseUrl('http://localhost:8000', true), true);
  assert.equal(isAllowedApiBaseUrl('http://api.example.test', true), false);
});

test('profile mapper uses the existing backend profile contract', () => {
  assert.deepEqual(toBackendProfile({
    name: 'Asha',
    email: 'asha@example.test',
    phone: '+10000000000',
    blood: 'O+',
    home: 'North',
    language: 'English',
  }), {
    name: 'Asha',
    email: 'asha@example.test',
    phone: '+10000000000',
    blood_group: 'O+',
    home_location: 'North',
    preferred_language: 'English',
  });
  assert.equal(fromBackendProfile({ name: 'Asha', blood_group: 'O+' }).blood, 'O+');
});

test('community report mapper emits only supported backend report types', () => {
  assert.deepEqual(toBackendCommunityReport({
    type: 'Unsafe Area',
    note: 'Poor visibility',
    point: [12.5, 77.6],
  }), {
    type: 'UNSAFE_AREA',
    latitude: 12.5,
    longitude: 77.6,
    description: 'Poor visibility',
    severity: 1,
  });
  assert.equal(toBackendCommunityReport({ type: 'Unknown', point: [0, 0] }), null);
});

test('SOS mapper emits the authenticated FastAPI SOS schema without contact claims', () => {
  assert.deepEqual(toBackendSOS({
    coordinates: [12.5, 77.6],
    journey: { backendJourneyId: 42 },
  }), {
    trigger_type: 'MANUAL',
    journey_id: 42,
    latitude: 12.5,
    longitude: 77.6,
  });
  assert.deepEqual(toBackendSOS({ coordinates: null, journey: {} }), {
    trigger_type: 'MANUAL',
  });
});
