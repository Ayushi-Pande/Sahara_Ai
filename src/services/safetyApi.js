const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, '');

async function post(path, payload) {
  if (!apiBase) return { synced: false, status: 'not-configured' };
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`API request failed: ${response.status}`);
    const data = response.status === 204 || !response.headers.get('content-type')?.includes('application/json')
      ? null
      : await response.json();
    return { synced: true, status: 'accepted', data };
  } catch (error) {
    return {
      synced: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'Unknown API error',
    };
  }
}

export function saveProfile(profile) {
  return post('/api/profile', profile);
}

export function sendSafetyEvent(event, payload) {
  return post('/api/events', { event, ...payload, createdAt: new Date().toISOString() });
}

export function sendEmergencyAlert(payload) {
  return post('/api/sos', { ...payload, createdAt: new Date().toISOString() });
}

export function submitCommunityReport(report) {
  return post('/api/community-reports', report);
}
