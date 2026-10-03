import { useCallback, useEffect, useRef, useState } from 'react';

const initialState = {
  position: null,
  status: 'idle', // 'idle' | 'loading' | 'connected' | 'weak' | 'denied' | 'unavailable' | 'unsupported' | 'paused'
  permission: 'prompt', // 'granted' | 'prompt' | 'denied' | 'unsupported'
  error: '',
  lastUpdateSec: null,
};

export default function useLiveLocation(enabled = true) {
  const [state, setState] = useState(initialState);
  const [attempt, setAttempt] = useState(0);
  const watchIdRef = useRef(null);

  // Monitor browser permission status if supported
  useEffect(() => {
    if (!navigator.permissions?.query) return undefined;
    let active = true;
    let permissionStatus;
    let permissionListener;

    navigator.permissions
      .query({ name: 'geolocation' })
      .then((perm) => {
        if (!active) return;
        permissionStatus = perm;
        setState((curr) => ({
          ...curr,
          permission: perm.state,
          status: perm.state === 'denied' ? 'denied' : curr.status,
          error: perm.state === 'denied' ? 'Location permission is denied in your browser settings.' : curr.error,
        }));

        permissionListener = () => {
          if (!active) return;
          const isDenied = perm.state === 'denied';
          setState((curr) => ({
            ...curr,
            permission: perm.state,
            status: isDenied ? 'denied' : curr.status === 'denied' ? 'loading' : curr.status,
            error: isDenied ? 'Location permission is denied in your browser settings.' : '',
          }));
        };

        if (perm.addEventListener) perm.addEventListener('change', permissionListener);
        else perm.onchange = permissionListener;
      })
      .catch(() => {});

    return () => {
      active = false;
      if (permissionStatus) {
        if (permissionListener) permissionStatus.removeEventListener?.('change', permissionListener);
        permissionStatus.onchange = null;
      }
    };
  }, []);

  // Watch position when enabled
  useEffect(() => {
    if (!enabled) {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setState((curr) => ({
        ...curr,
        status: curr.position ? 'paused' : 'idle',
        error: '',
      }));
      return undefined;
    }

    if (!window.isSecureContext) {
      setState((curr) => ({
        ...curr,
        status: 'unsupported',
        error: 'Location access requires HTTPS or localhost (Secure Context).',
      }));
      return undefined;
    }

    if (!('geolocation' in navigator)) {
      setState((curr) => ({
        ...curr,
        status: 'unsupported',
        error: 'Geolocation is not supported by your browser.',
      }));
      return undefined;
    }

    let active = true;

    setState((curr) => ({
      ...curr,
      status: 'loading',
      error: '',
    }));

    const options = {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000,
    };

    const handleSuccess = (result) => {
      if (!active) return;
      const { latitude, longitude, accuracy, altitude, heading, speed } = result.coords;
      const timestamp = result.timestamp || Date.now();

      setState({
        position: {
          latitude,
          longitude,
          accuracy,
          altitude: altitude ?? null,
          heading: heading ?? null,
          speed: speed ?? null,
          timestamp,
          simulated: false,
        },
        status: accuracy > 85 ? 'weak' : 'connected',
        permission: 'granted',
        error: '',
        lastUpdateSec: 0,
      });
    };

    const handleError = (error) => {
      if (!active) return;
      const isDenied = error.code === error.PERMISSION_DENIED;
      const isUnavailable = error.code === error.POSITION_UNAVAILABLE;
      const isTimeout = error.code === error.TIMEOUT;

      let errorMsg = 'Unable to acquire location.';
      let nextStatus = 'unavailable';

      if (isDenied) {
        errorMsg = 'Location permission was denied. Please allow location access in your browser.';
        nextStatus = 'denied';
      } else if (isTimeout) {
        errorMsg = 'GPS location request timed out. Retrying signal...';
        nextStatus = 'unavailable';
      } else if (isUnavailable) {
        errorMsg = 'Location signal currently unavailable. Check your device GPS.';
        nextStatus = 'unavailable';
      }

      setState((curr) => ({
        ...curr,
        status: nextStatus,
        permission: isDenied ? 'denied' : curr.permission,
        error: errorMsg,
      }));
    };

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        handleError,
        options
      );
    } catch (err) {
      setState((curr) => ({
        ...curr,
        status: 'unsupported',
        error: 'Failed to start geolocation watch: ' + (err?.message || ''),
      }));
    }

    return () => {
      active = false;
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, attempt]);

  // Second ticker to update "lastUpdateSec" (how many seconds ago last GPS fix occurred)
  useEffect(() => {
    if (!state.position?.timestamp) return undefined;
    const interval = setInterval(() => {
      setState((curr) => {
        if (!curr.position?.timestamp) return curr;
        const diff = Math.max(0, Math.floor((Date.now() - curr.position.timestamp) / 1000));
        return { ...curr, lastUpdateSec: diff };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.position?.timestamp]);

  const retry = useCallback(() => {
    setAttempt((c) => c + 1);
  }, []);

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => setAttempt((c) => c + 1),
      () => setAttempt((c) => c + 1),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  return {
    ...state,
    retry,
    requestPermission,
    isSecureContext: window.isSecureContext,
    isSupported: Boolean(typeof navigator !== 'undefined' && navigator.geolocation),
  };
}