const TOKEN_KEY = 'sahara-backend-access-token';
const environment = import.meta.env || {};
const apiBase = resolveApiBaseUrl(environment.VITE_API_URL, environment.DEV);

export function resolveApiBaseUrl(configuredUrl, isDevelopment = false) {
  const configured = configuredUrl?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return isDevelopment ? 'http://127.0.0.1:8000' : '';
}

export function isAllowedApiBaseUrl(value, isDevelopment = false) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      || (isDevelopment && url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname));
  } catch {
    return false;
  }
}

export function isBackendAuthenticated() {
  return Boolean(readAccessToken());
}

function readAccessToken() {
  try {
    return globalThis.sessionStorage?.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function storeAccessToken(token) {
  try {
    globalThis.sessionStorage?.setItem(TOKEN_KEY, token);
  } catch {
    throw new Error('This browser could not retain the backend session for this tab.');
  }
}

function clearAccessToken() {
  try {
    globalThis.sessionStorage?.removeItem(TOKEN_KEY);
  } catch {
    return;
  }
}

async function request(path, { method = 'GET', body, authenticated = true } = {}) {
  if (!apiBase) return { synced: false, status: 'not-configured' };
  if (!isAllowedApiBaseUrl(apiBase, Boolean(environment.DEV))) {
    return {
      synced: false,
      status: 'invalid-configuration',
      error: 'The backend API URL must use HTTPS outside local development.',
    };
  }
  const token = readAccessToken();
  if (authenticated && !token) return { synced: false, status: 'not-authenticated' };

  const headers = {};
  const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isMultipart) {
    headers['Content-Type'] = 'application/json';
  }
  if (authenticated) headers.Authorization = 'Bearer ' + token;

  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: isMultipart ? body : JSON.stringify(body) }),
    });
    const contentType = response.headers.get('content-type') || '';
    const responseBody = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      if (response.status === 401) clearAccessToken();
      const message = responseBody?.message
        || responseBody?.detail?.message
        || `Backend request failed (${response.status}).`;
      return {
        synced: false,
        status: response.status === 401 ? 'not-authenticated' : 'unavailable',
        error: message,
      };
    }
    return { synced: true, status: 'accepted', data: responseBody?.data ?? responseBody };
  } catch (error) {
    return {
      synced: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown API error',
    };
  }
}

export async function authenticateBackendAccount(mode, credentials) {
  const result = await request(`/api/auth/${mode}`, {
    method: 'POST',
    body: credentials,
    authenticated: false,
  });
  if (!result.synced) return result;
  if (!result.data?.access_token) {
    return { synced: false, status: 'unavailable', error: 'The backend did not return an access token.' };
  }
  try {
    storeAccessToken(result.data.access_token);
  } catch (error) {
    return {
      synced: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'Could not retain backend session.',
    };
  }
  return { ...result, data: { user: result.data.user } };
}

export async function logoutBackendAccount() {
  const result = await request('/api/auth/logout', { method: 'POST' });
  clearAccessToken();
  return result;
}

export function toBackendProfile(profile) {
  return {
    name: profile.name,
    ...(profile.email ? { email: profile.email } : {}),
    phone: profile.phone || null,
    blood_group: profile.blood === 'Unknown' ? null : profile.blood,
    home_location: profile.home || null,
    preferred_language: profile.language || 'English',
  };
}

export function fromBackendProfile(profile) {
  return {
    name: profile.name || '',
    email: profile.email || '',
    phone: profile.phone || '',
    blood: profile.blood_group || 'Unknown',
    emergency: '',
    home: profile.home_location || '',
    language: profile.preferred_language || 'English',
  };
}

export function toBackendCommunityReport(report) {
  const typeMap = {
    'Unsafe Area': 'UNSAFE_AREA',
    'Poor lighting': 'POOR_LIGHTING',
    Harassment: 'HARASSMENT',
    'Suspicious activity': 'SUSPICIOUS_ACTIVITY',
    'Safe area': 'SAFE_AREA',
  };
  const type = typeMap[report.type];
  if (!type || !Array.isArray(report.point) || report.point.length !== 2) return null;
  return {
    type,
    latitude: report.point[0],
    longitude: report.point[1],
    description: report.note || 'Community safety report',
    severity: 1,
  };
}

export async function saveProfile(profile) {
  return request('/api/users/me', { method: 'PUT', body: toBackendProfile(profile) });
}

export function loadBackendProfile() {
  return request('/api/users/me');
}

export function listTrustedContacts() {
  return request('/api/contacts');
}

export async function createTrustedContact(contact) {
  return request('/api/contacts', {
    method: 'POST',
    body: {
      name: contact.name,
      relationship: contact.relation || 'Friend',
      phone: contact.phone,
      ...(contact.email ? { email: contact.email } : {}),
      priority: contact.priority ?? 1,
      is_active: contact.is_active ?? true,
    },
  });
}

export async function deleteTrustedContact(contactId) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}`, { method: 'DELETE' });
}

export function updateTrustedContact(contactId, contact) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PUT',
    body: {
      name: contact.name,
      relationship: contact.relation || 'Friend',
      phone: contact.phone,
      ...(contact.email ? { email: contact.email } : {}),
      priority: contact.priority ?? 1,
      is_active: contact.is_active ?? true,
    },
  });
}

export function fromBackendCommunityReport(report) {
  const typeLabels = {
    UNSAFE_AREA: 'Unsafe Area',
    POOR_LIGHTING: 'Poor lighting',
    HARASSMENT: 'Harassment',
    SUSPICIOUS_ACTIVITY: 'Suspicious activity',
    SAFE_AREA: 'Safe area',
  };
  return {
    id: `backend-${report.id}`,
    type: typeLabels[report.type] || report.type,
    note: report.description,
    point: [report.latitude, report.longitude],
    time: report.timestamp,
    source: 'backend',
    severity: report.severity,
  };
}

export function listCommunityReports() {
  return request('/api/community/reports', { authenticated: false }).then((result) => (
    result.synced ? { ...result, data: result.data.map(fromBackendCommunityReport) } : result
  ));
}

export async function sendSafetyEvent(event, payload) {
  const journey = payload.journey || {};
  if (event === 'journey-started') {
    const created = await request('/api/journeys', {
      method: 'POST',
      body: {
        origin: journey.from || 'Current location unavailable',
        destination: journey.to || 'Destination not set',
        expected_arrival: journey.expectedArrivalAt || null,
      },
    });
    if (!created.synced) return created;
    const started = await request(`/api/journeys/${created.data.id}/start`, { method: 'POST' });
    return started.synced
      ? { ...started, data: { ...started.data, backendJourneyId: created.data.id } }
      : started;
  }

  if (event === 'journey-ended' && journey.backendJourneyId) {
    return request(`/api/journeys/${journey.backendJourneyId}/end`, { method: 'POST' });
  }

  return { synced: false, status: 'unsupported-event' };
}

export function sendJourneyLocation(journeyId, location) {
  return request(`/api/journeys/${encodeURIComponent(journeyId)}/location`, {
    method: 'POST',
    body: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      battery: location.battery,
      timestamp: new Date(location.timestamp).toISOString(),
    },
  });
}

export function checkJourneyRoute(journeyId, location) {
  return request(`/api/journeys/${encodeURIComponent(journeyId)}/route-check`, {
    method: 'POST',
    body: { latitude: location.latitude, longitude: location.longitude },
  });
}

export function submitJourneyCheckIn(journeyId) {
  return request(`/api/journeys/${encodeURIComponent(journeyId)}/check-in`, {
    method: 'POST',
    body: { status: 'SAFE' },
  });
}

export function updateJourneyArrival(journeyId, journey) {
  return request(`/api/journeys/${encodeURIComponent(journeyId)}`, {
    method: 'PUT',
    body: {
      origin: journey.from || 'Current location unavailable',
      destination: journey.to || 'Destination not set',
      expected_arrival: journey.expectedArrivalAt || null,
    },
  });
}

export function toBackendSOS(payload) {
  const coordinates = payload.coordinates;
  return {
    trigger_type: 'MANUAL',
    ...(payload.journey?.backendJourneyId ? { journey_id: payload.journey.backendJourneyId } : {}),
    ...(Array.isArray(coordinates) && coordinates.length === 2
      ? { latitude: coordinates[0], longitude: coordinates[1] }
      : {}),
  };
}

export function sendEmergencyAlert(payload) {
  return request('/api/sos', { method: 'POST', body: toBackendSOS(payload) });
}

export function submitCommunityReport(report) {
  const payload = toBackendCommunityReport(report);
  if (!payload) return Promise.resolve({ synced: false, status: 'unsupported-report' });
  return request('/api/community/reports', { method: 'POST', body: payload });
}
