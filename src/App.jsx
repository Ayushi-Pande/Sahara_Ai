import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowRight, Battery, BatteryCharging,
  Bell, BookOpen, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, Compass, Crosshair,
  FileAudio2, FileImage, FileText, FileVideo2, Heart, Home, LifeBuoy, LockKeyhole, Map,
  MapPin, Menu, MessageCircle, Mic, Navigation, Phone, Plus, Route as RouteIcon, Settings,
  Shield, ShieldAlert, ShieldCheck, Siren, Smartphone, Sparkles, Users, Volume2, Watch,
  X, Zap,
} from 'lucide-react';
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { saveProfile, sendEmergencyAlert, sendSafetyEvent, submitCommunityReport } from './services/safetyApi.js';
import { clearEvidenceFiles, getEvidenceFile, removeEvidenceFile, saveEvidenceFiles } from './services/evidenceStore.js';
import useLiveLocation from './hooks/useLiveLocation.js';
import FunctionalSosPage from './components/FunctionalSosPage.jsx';
import SessionDuressSetting from './components/SessionDuressSetting.jsx';

const initialProfile = {
  name: '',
  email: '',
  phone: '',
  emergency: '',
  blood: 'Unknown',
  home: '',
  language: 'English',
};
const navItems = [
  { to: '/home', label: 'Overview', icon: Home },
  { to: '/journey', label: 'Plan a journey', icon: RouteIcon },
  { to: '/live-journey', label: 'Live journey', icon: Navigation },
  { to: '/sos', label: 'Emergency', icon: Siren },
  { to: '/voice', label: 'Sahara assistant', icon: Mic },
  { to: '/nearby-help', label: 'Nearby help', icon: LifeBuoy },
  { to: '/community-map', label: 'Community map', icon: Map },
  { to: '/evidence', label: 'Evidence vault', icon: LockKeyhole },
  { to: '/guardian', label: 'Guardian view', icon: Users },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/history', label: 'Safety history', icon: Clock3 },
  { to: '/privacy', label: 'Privacy center', icon: LockKeyhole },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const featureItems = [
  { title: 'On-device safety tools', detail: 'A clear place to check in, get ready, and manage your next step.', icon: Sparkles, to: '/home' },
  { title: 'Journey check-ins', detail: 'Record manual check-ins on this device. Automatic contact alerts are not configured.', icon: Navigation, to: '/journey' },
  { title: 'Your trusted circle', detail: 'Keep contact details here and choose when to call or message them.', icon: Users, to: '/profile' },
  { title: 'Emergency response', detail: 'Open an on-device SOS flow. Emergency-service calls are never placed automatically.', icon: Siren, to: '/sos' },
  { title: 'Battery guardian', detail: 'Know when your phone needs a little extra attention.', icon: BatteryCharging, to: '/battery' },
  { title: 'Voice safety', detail: 'Use browser speech when supported, or enter a command by text.', icon: Mic, to: '/voice' },
];
const SafetyContext = createContext(null);

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      if (stored == null) return fallback;
      if (key === 'sahara-profile'
        && stored.name === 'Ayushi Pandey'
        && stored.email === 'ayushi@example.com'
        && stored.phone === '+91 98765 43210') return fallback;
      if (key === 'sahara-contacts' && Array.isArray(stored)) {
        return stored.filter((contact) => !(
          (contact.name === 'Mom' && contact.phone === '+91 98765 43210')
          || (contact.name === 'Janhavi' && contact.phone === '+91 91234 56789')
          || (contact.name === 'Praveen' && contact.phone === '+91 99887 77665')
        ));
      }
      if (key === 'sahara-evidence' && Array.isArray(stored)) {
        return stored.map((item) => item.location === 'Varanasi, India'
          ? { ...item, location: 'Location unavailable', status: 'Attachment was not stored by the previous version', hasStoredFile: false }
          : item);
      }
      if (key === 'sahara-journey'
        && stored.active === false
        && stored.from === 'SHEAT College, Varanasi'
        && stored.to === 'Home'
        && stored.eta === '7:28 PM'
        && stored.score === 92) return fallback;
      if (key === 'sahara-journey' && stored.from?.startsWith('Demo location')) {
        return { ...stored, from: 'Demo Mode · GPS paused', originPoint: null, destinationPoint: null, route: null };
      }
      return stored;
    } catch { return fallback; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
}

function distanceMeters(first, second) {
  const radians = (degree) => degree * Math.PI / 180;
  const latitudeDelta = radians(second[0] - first[0]);
  const longitudeDelta = radians(second[1] - first[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first[0])) * Math.cos(radians(second[0])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function hasRecentLiveFix(position, liveLocation, maxAgeMs = 60000, now = Date.now()) {
  if (!position || !liveLocation || !['connected', 'weak'].includes(liveLocation.status)) return false;
  const age = now - position.timestamp;
  return Number.isFinite(age) && age >= 0 && age < maxAgeMs;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return 'Unavailable';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function elapsedLabel(startedAt) {
  if (!startedAt) return 'Not started';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  return minutes < 1 ? 'Less than a minute' : `${minutes} min`;
}

function nextArrivalTimestamp(timeValue) {
  if (!timeValue) return null;
  const [hours, minutes] = timeValue.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  const arrival = new Date();
  arrival.setHours(hours, minutes, 0, 0);
  if (arrival.getTime() <= Date.now()) arrival.setDate(arrival.getDate() + 1);
  return arrival.toISOString();
}

async function fetchNearbyOpenData(coordinates) {
  const [latitude, longitude] = coordinates;
  const query = `[out:json][timeout:15];(nwr["amenity"~"police|hospital|clinic|pharmacy|shelter|community_centre|bus_station"](around:6000,${latitude},${longitude});nwr["shop"="pharmacy"](around:6000,${latitude},${longitude});nwr["public_transport"](around:6000,${latitude},${longitude}););out center tags;`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  let data;
  try {
    const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, { signal: controller.signal });
    if (!response.ok) throw new Error('Nearby map data unavailable');
    data = await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
  return (data.elements || []).flatMap((element) => {
    const point = element.center ? [element.center.lat, element.center.lon] : [element.lat, element.lon];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return [];
    const tags = element.tags || {};
    const amenity = tags.amenity || '';
    const type = amenity === 'police' ? 'Police'
      : ['hospital', 'clinic'].includes(amenity) ? 'Hospital'
        : amenity === 'pharmacy' || tags.shop === 'pharmacy' ? 'Pharmacy'
          : ['shelter', 'community_centre'].includes(amenity) ? 'Safe Zone' : 'Transport';
    const meters = distanceMeters(coordinates, point);
    return [{ name: tags.name || tags.operator || `${type} location`, type, distance: formatDistance(meters), distanceMeters: meters, open: 'Hours not provided', point, phone: tags.phone || tags['contact:phone'] || '', source: 'OpenStreetMap contributors' }];
  }).sort((first, second) => first.distanceMeters - second.distanceMeters).slice(0, 30);
}

function hasSeenOnboarding() {
  try {
    return localStorage.getItem('sahara-onboarding-complete') === 'true';
  } catch {
    return false;
  }
}

function App() {
  const [profile, setProfile] = useStoredState('sahara-profile', initialProfile);
  const [contacts, setContacts] = useStoredState('sahara-contacts', []);
  const [onboardingComplete, setOnboardingComplete] = useState(() => hasSeenOnboarding());
  const [showSplash, setShowSplash] = useState(true);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [journey, setJourney] = useStoredState('sahara-journey', { active: false, from: '', to: '', eta: '', route: null });
  const [reports, setReports] = useStoredState('sahara-reports', []);
  const [evidence, setEvidence] = useStoredState('sahara-evidence', []);
  const [lastKnownLocation, setLastKnownLocation] = useStoredState('sahara-last-known-location', null);
  const [emergency, setEmergency] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [batteryPct, setBatteryPct] = useState(null);
  const [batteryTimeRemaining, setBatteryTimeRemaining] = useState(null);
  const [batteryStatus, setBatteryStatus] = useState('checking');
  const [batteryError, setBatteryError] = useState('');
  const [demoMode, setDemoMode] = useStoredState('sahara-demo-mode', false);
  const [shareLocation, setShareLocation] = useStoredState('sahara-share-location', false);
  const [countdown, setCountdown] = useState(30);
  const [activationCountdown, setActivationCountdown] = useState(null);
  const [notificationLog, setNotificationLog] = useStoredState('sahara-notification-log', []);
  const [activity, setActivity] = useStoredState('sahara-activity', []);
  const [seenActivityIds, setSeenActivityIds] = useStoredState('sahara-seen-activity', []);
  const [travelledPath, setTravelledPath] = useState([]);
  const [duressPin, setDuressPin] = useState('');
  const [alertSoundOn, setAlertSoundOn] = useState(false);
  const audioRef = useRef(null);
  const activationTimerRef = useRef(null);
  const arrivalReminderForRef = useRef(null);
  const batteryAlertTierRef = useRef(0);
  const liveLocation = useLiveLocation(!demoMode);
  const location = demoMode ? null : liveLocation.position;
  const coordinates = location ? [location.latitude, location.longitude] : null;
  const locationInfo = useLocation();
  const isLanding = locationInfo.pathname === '/landing' || locationInfo.pathname === '/';
  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 2200);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const notify = (message, kind = 'success') => {
    const id = Date.now();
    setNotifications((items) => [...items, { id, message, kind }]);
    window.setTimeout(() => setNotifications((items) => items.filter((item) => item.id !== id)), 3500);
  };
  const addActivity = (message, kind = 'info') => {
    setActivity((items) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, message, kind, time: new Date().toISOString() }, ...items].slice(0, 100));
  };
  const stopAlertSound = () => {
    if (audioRef.current) {
      window.clearInterval(audioRef.current.interval);
      audioRef.current.context.close().catch(() => {});
      audioRef.current = null;
    }
    setAlertSoundOn(false);
  };
  const startAlertSound = () => {
    if (audioRef.current) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      notify('Emergency audio is not supported by this browser.', 'alert');
      return;
    }
    const context = new AudioContextClass();
    const beep = () => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.21);
    };
    context.resume().then(() => {
      beep();
      audioRef.current = { context, interval: window.setInterval(beep, 1100) };
      setAlertSoundOn(true);
    }).catch((error) => {
      void context.close();
      notify(`Emergency audio could not start${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    });
  };
  const clearLocalData = async () => {
    let evidenceClearError = '';
    try {
      await clearEvidenceFiles();
    } catch (error) {
      evidenceClearError = error instanceof Error ? error.message : 'Unknown local evidence storage error';
    }
    stopAlertSound();
    window.clearTimeout(activationTimerRef.current);
    activationTimerRef.current = null;
    setActivationCountdown(null);
    setProfile(initialProfile);
    setContacts([]);
    setJourney({ active: false, from: '', to: '', eta: '', route: null });
    setReports([]);
    setEvidence([]);
    setLastKnownLocation(null);
    setNotificationLog([]);
    setActivity([]);
    setSeenActivityIds([]);
    setEmergency(false);
    setCountdown(30);
    setNotifications([]);
    setDuressPin('');
    setTravelledPath([]);
    setShareLocation(false);
    setDemoMode(false);
    setOnboardingComplete(false);
    localStorage.removeItem('sahara-onboarding-complete');
    localStorage.removeItem('sahara-settings');
    localStorage.removeItem('sahara-deviation-threshold');
    notify(evidenceClearError
      ? `Other local SAHARA data was cleared, but attached evidence could not be cleared: ${evidenceClearError}`
      : 'Local SAHARA data was cleared from this browser. Browser permissions are unchanged.', evidenceClearError ? 'alert' : 'info');
  };
  const startJourney = (data = {}) => {
    const nextJourney = { ...journey, ...data, active: true, startedAt: new Date().toISOString(), originPoint: demoMode ? null : coordinates, demoModeAtStart: demoMode, destinationPoint: null, lastCheckInAt: null, pendingCheckInAt: null, arrivalReminderAt: null };
    arrivalReminderForRef.current = null;
    setJourney(nextJourney);
    setTravelledPath(coordinates ? [coordinates] : []);
    const destinationQuery = nextJourney.to?.trim();
    if (!demoMode && destinationQuery) {
      fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(nextJourney.to)}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Destination lookup failed: ${response.status}`);
          return response.json();
        })
        .then((results) => {
          const point = results[0] ? [Number(results[0].lat), Number(results[0].lon)] : null;
          if (point && point.every(Number.isFinite)) {
            setJourney((current) => ({ ...current, destinationPoint: point }));
          } else {
            notify('Destination could not be located. Journey monitoring remains GPS-only.', 'alert');
          }
        })
        .catch((error) => {
          notify(`Destination lookup unavailable. Journey monitoring remains GPS-only${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
        });
    }
    if (demoMode) {
      notify('Demo journey started locally; no sample coordinates were sent to a backend.', 'info');
    } else {
      void sendSafetyEvent('journey-started', { journey: nextJourney }).then((result) => {
        if (result.synced) return;
        notify(result.status === 'not-configured'
          ? 'Journey is active on this device; backend sync is not configured.'
          : `Journey is active on this device; backend sync failed${result.error ? `: ${result.error}` : '.'}`, 'info');
      });
    }
    addActivity(`Journey started · ${nextJourney.to}`, 'journey');
    notify('Journey started · local journey state updated');
  };
  const recordJourneyCheckIn = () => {
    const checkedInAt = new Date().toISOString();
    setJourney((current) => ({ ...current, lastCheckInAt: checkedInAt, pendingCheckInAt: null }));
    addActivity('Journey check-in recorded on this device', 'checkin');
    notify('Check-in recorded on this device.');
  };
  const extendJourneyArrival = () => {
    const currentArrival = journey.expectedArrivalAt ? new Date(journey.expectedArrivalAt).getTime() : Date.now();
    const nextArrival = new Date(Math.max(Date.now(), currentArrival) + 15 * 60000);
    const nextEta = nextArrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    arrivalReminderForRef.current = null;
    setJourney((current) => ({
      ...current,
      eta: nextEta,
      expectedArrivalAt: nextArrival.toISOString(),
      arrivalReminderAt: null,
      pendingCheckInAt: null,
    }));
    addActivity('Expected arrival extended by 15 minutes', 'journey');
    notify('Expected arrival extended by 15 minutes on this device.');
  };
  const endJourney = () => {
    const completedJourney = { ...journey, active: false, completedAt: new Date().toISOString() };
    setJourney(completedJourney);
    stopAlertSound();
    addActivity('Journey monitoring ended on this device', 'journey');
    notify('Journey monitoring ended on this device. This does not confirm arrival.');
    if (!demoMode) {
      void sendSafetyEvent('journey-ended', { journey: completedJourney }).then((result) => {
        if (result.synced) return;
        notify(result.status === 'not-configured'
          ? 'Journey end is saved locally; backend sync is not configured.'
          : `Journey end is saved locally; backend sync failed${result.error ? `: ${result.error}` : '.'}`, 'info');
      });
    }
  };
  const activateEmergency = () => {
    setEmergency(true);
    const triggeredAt = new Date().toISOString();
    const eventId = `sos-${Date.now()}`;
    const contactEvents = contacts.map((contact) => ({
      id: `${eventId}-${contact.name}`,
      contact: contact.name,
      phone: contact.phone,
      time: triggeredAt,
      status: 'Emergency active on this device; contact delivery not confirmed.',
      simulated: false,
    }));
    const eventRecord = {
      id: eventId,
      title: 'Emergency response activated',
      time: triggeredAt,
      status: 'Emergency active on this device; contact delivery not confirmed.',
      simulated: false,
    };
    setNotificationLog((items) => [eventRecord, ...contactEvents, ...items]);
    addActivity('Emergency response activated on this device', 'emergency');
    if (demoMode) {
      const demoStatus = 'Demo Mode is active; no real SOS request or contact alert was sent.';
      setNotificationLog((items) => items.map((item) => item.id === eventId || contactEvents.some((contact) => contact.id === item.id)
        ? { ...item, status: demoStatus }
        : item));
      notify(demoStatus, 'alert');
      return;
    }
    notify('Emergency mode activated on this device. Checking the configured safety service; contact delivery is unconfirmed.', 'alert');
    const currentCoordinates = !demoMode && hasRecentLiveFix(location, liveLocation)
      ? [location.latitude, location.longitude]
      : null;
    void sendEmergencyAlert({ profile: { name: profile.name }, coordinates: currentCoordinates, contacts, journey }).then((result) => {
      const details = result.synced
        ? Array.isArray(result.data?.notifications)
          ? result.data.notifications
          : null
        : null;
      const contactStatus = result.synced
        ? 'SOS accepted by backend; contact delivery is unconfirmed.'
        : result.status === 'not-configured'
          ? 'Prototype — service not connected. No contact alerts were sent.'
          : `Prototype — safety service unavailable; no contact alerts were confirmed${result.error ? ` (${result.error})` : ''}.`;
      const updatedContacts = contacts.map((contact) => {
        const response = details?.find((entry) => entry.contact === contact.name || entry.phone === contact.phone);
        return {
          id: `${eventId}-${contact.name}`,
          contact: contact.name,
          phone: contact.phone,
          time: triggeredAt,
          status: typeof response?.status === 'string' ? response.status : contactStatus,
          simulated: false,
        };
      });
      setNotificationLog((items) => [
        { ...eventRecord, status: result.synced ? 'SOS accepted by backend.' : contactStatus },
        ...updatedContacts,
        ...items.filter((item) => item.id !== eventId && !contactEvents.some((contact) => contact.id === item.id)),
      ]);
    });
  };
  const resolveEmergency = () => {
    setEmergency(false);
    setCountdown(30);
    stopAlertSound();
    addActivity('Emergency response cancelled by user', 'safety');
    notify('Emergency state cleared on this device.');
  };
  const beginEmergencySequence = () => {
    startAlertSound();
    setActivationCountdown(3);
    let remaining = 3;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        activationTimerRef.current = null;
        setActivationCountdown(null);
        activateEmergency();
        return;
      }
      setActivationCountdown(remaining);
      activationTimerRef.current = window.setTimeout(tick, 1000);
    };
    activationTimerRef.current = window.setTimeout(tick, 1000);
  };
  const cancelEmergencySequence = () => {
    window.clearTimeout(activationTimerRef.current);
    activationTimerRef.current = null;
    setActivationCountdown(null);
    stopAlertSound();
    notify('Emergency activation cancelled');
  };
  useEffect(() => {
    if (!emergency || countdown <= 0) return undefined;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emergency, countdown]);
  useEffect(() => {
    if (!journey.active || !journey.expectedArrivalAt || journey.arrivalReminderAt) return undefined;
    const dueAt = new Date(journey.expectedArrivalAt).getTime();
    if (!Number.isFinite(dueAt)) return undefined;
    if (journey.lastCheckInAt && new Date(journey.lastCheckInAt).getTime() >= dueAt) return undefined;
    const journeyId = journey.startedAt || journey.expectedArrivalAt;
    if (arrivalReminderForRef.current === journeyId) return undefined;
    const timer = window.setTimeout(() => {
      arrivalReminderForRef.current = journeyId;
      const reminderTime = new Date().toISOString();
      setJourney((current) => current.active && !current.arrivalReminderAt
        ? { ...current, arrivalReminderAt: reminderTime }
        : current);
      addActivity('Expected arrival time reached · check-in needed', 'checkin');
      notify('Your expected arrival time has passed. Please check in or end the journey; no alert was sent.', 'alert');
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('SAHARA AI journey check-in', { body: 'Your expected arrival time has passed. Please check in or end your journey.' });
        } catch (error) {
          notify(`Browser reminder could not be displayed${error instanceof Error ? `: ${error.message}` : '.'}`, 'info');
        }
      }
    }, Math.max(0, dueAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [journey.active, journey.startedAt, journey.expectedArrivalAt, journey.arrivalReminderAt, journey.lastCheckInAt]);
  useEffect(() => {
    if (!journey.active || !journey.startedAt || !journey.checkInIntervalMinutes || journey.pendingCheckInAt) return undefined;
    const previousCheckIn = journey.lastCheckInAt || journey.startedAt;
    const dueAt = new Date(previousCheckIn).getTime() + journey.checkInIntervalMinutes * 60000;
    if (!Number.isFinite(dueAt)) return undefined;
    const timer = window.setTimeout(() => {
      const pendingAt = new Date().toISOString();
      setJourney((current) => current.active && !current.pendingCheckInAt
        ? { ...current, pendingCheckInAt: pendingAt }
        : current);
      addActivity('Safety check-in reminder is due', 'checkin');
      notify('Safety check-in due. Please confirm you are safe or choose Need help.', 'alert');
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('SAHARA AI safety check-in', { body: 'Please confirm that you are safe.' });
        } catch (error) {
          notify(`Browser check-in reminder could not be displayed${error instanceof Error ? `: ${error.message}` : '.'}`, 'info');
        }
      }
    }, Math.max(0, dueAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [journey.active, journey.startedAt, journey.checkInIntervalMinutes, journey.lastCheckInAt, journey.pendingCheckInAt]);
  useEffect(() => {
    if (!('getBattery' in navigator)) {
      setBatteryStatus('unsupported');
      return undefined;
    }
    let battery;
    const update = () => {
      setBatteryPct(Math.round(battery.level * 100));
      setBatteryTimeRemaining(Number.isFinite(battery.dischargingTime) && battery.dischargingTime > 0 ? battery.dischargingTime : null);
      setBatteryStatus('available');
    };
    navigator.getBattery().then((result) => { battery = result; update(); battery.addEventListener('levelchange', update); battery.addEventListener('dischargingtimechange', update); battery.addEventListener('chargingchange', update); }).catch((error) => {
      setBatteryStatus('unavailable');
      setBatteryError(error instanceof Error ? error.message : 'Could not read device battery status.');
    });
    return () => {
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('dischargingtimechange', update);
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);
  useEffect(() => {
    if (batteryPct == null) return;
    const alertTier = batteryPct <= 10 ? 3 : batteryPct <= 15 ? 2 : batteryPct <= 20 ? 1 : 0;
    if (alertTier === 0) {
      batteryAlertTierRef.current = 0;
      return;
    }
    if (alertTier <= batteryAlertTierRef.current) return;
    batteryAlertTierRef.current = alertTier;
    const threshold = alertTier === 3 ? 10 : alertTier === 2 ? 15 : 20;
    const level = alertTier === 3 ? 'critical' : alertTier === 2 ? 'urgent' : 'low';
    addActivity(`Battery ${level} · ${batteryPct}%`, 'battery');
    notify(`Battery ${level} at ${batteryPct}%. Share a recent location manually if you need to.`, 'alert');
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(`SAHARA AI battery ${level}`, { body: `Device battery is at ${batteryPct}% (below ${threshold}%).` });
      } catch (error) {
        notify(`Browser battery reminder could not be displayed${error instanceof Error ? `: ${error.message}` : '.'}`, 'info');
      }
    }
  }, [batteryPct]);
  useEffect(() => {
    if (demoMode || !journey.active || !hasRecentLiveFix(location, liveLocation)) return;
    const next = [location.latitude, location.longitude];
    setTravelledPath((path) => path.length && path[path.length - 1][0] === next[0] && path[path.length - 1][1] === next[1] ? path : [...path, next]);
    addActivity(`GPS location updated · ±${Math.round(location.accuracy)} m`, 'location');
  }, [location?.timestamp, demoMode, journey.active, liveLocation.status]);
  useEffect(() => {
    if (!demoMode && liveLocation.position) setLastKnownLocation(liveLocation.position);
  }, [demoMode, liveLocation.position?.timestamp]);
  useEffect(() => () => {
    window.clearTimeout(activationTimerRef.current);
    if (audioRef.current) {
      window.clearInterval(audioRef.current.interval);
      audioRef.current.context.close().catch(() => {});
    }
  }, []);
  const requestLocation = () => {
    if (demoMode) setDemoMode(false);
    liveLocation.retry();
  };
  const addEvidence = async (items) => {
    if (!items.length) return;
    const locationLabel = !demoMode && hasRecentLiveFix(location, liveLocation)
      ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
      : 'Location unavailable';
    try {
      const additions = await saveEvidenceFiles(items, locationLabel);
      setEvidence((current) => [...additions, ...current]);
      addActivity(`${additions.length} evidence file${additions.length === 1 ? '' : 's'} saved locally`, 'evidence');
      notify(`${additions.length} evidence file${additions.length === 1 ? '' : 's'} saved in this browser.`);
    } catch (error) {
      notify(`Evidence could not be saved${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const addEvidenceNote = (title, note) => {
    const noteRecord = {
      id: `evidence-note-${Date.now()}`,
      name: title.trim(),
      note: note.trim(),
      type: 'note',
      size: note.trim().length,
      time: new Date().toISOString(),
      location: !demoMode && hasRecentLiveFix(location, liveLocation) ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Location unavailable',
      status: 'Note saved in this browser',
      hasStoredFile: false,
    };
    setEvidence((current) => [noteRecord, ...current]);
    addActivity('Evidence note saved locally', 'evidence');
    notify('Evidence note saved on this device.');
  };
  const deleteEvidence = async (item) => {
    if (item.hasStoredFile) {
      try {
        await removeEvidenceFile(item.id);
      } catch (error) {
        notify(`Evidence attachment could not be deleted${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
        return;
      }
    }
    setEvidence((current) => current.filter((entry) => entry.id !== item.id));
    notify('Evidence item removed from this device.');
  };
  const downloadEvidence = async (item) => {
    try {
      const file = await getEvidenceFile(item.id);
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify(`Evidence file could not be opened${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const addReport = (report) => {
    setReports((current) => [{ id: Date.now(), ...report, time: new Date().toLocaleString() }, ...current]);
    addActivity(`Community report saved on this device · ${report.type}`, 'community');
    void submitCommunityReport(report).then((result) => {
      if (result.synced) {
        notify('Community report sent to the configured service. Verification status is unavailable.', 'info');
      } else if (result.status === 'not-configured') {
        notify('Report saved on this device; community reporting service is not configured.', 'info');
      } else {
        notify('Report saved on this device; community reporting service is unavailable.', 'alert');
      }
    });
  };

  if (showSplash && !isLanding) {
    return <SplashScreen />;
  }

  return (
    <>
        {!isLanding && <AppShell profile={profile} demoMode={demoMode} setDemoMode={setDemoMode} emergency={emergency} activity={activity} seenActivityIds={seenActivityIds} onModeToggle={() => setDemoMode((mode) => !mode)} />}
      <main className={isLanding ? 'main main--landing' : 'main'}>
        {!isLanding && <div className={`demo-mode-banner ${demoMode ? '' : 'live-mode-banner'}`}><span className="demo-banner-dot" /><span>{demoMode ? <><b>DEMO MODE</b> · GPS tracking and location results are paused. Browser location permission: {liveLocation.permission}.</> : <><b>LIVE MODE</b> · GPS is requested from this device. Routing, safety scoring, contact delivery, and guardian sync remain prototype-only.</>}</span></div>}
        {!isLanding && !isOnline && <div className="offline-mode-banner" role="status"><AlertTriangle size={16} /><span><b>OFFLINE MODE</b> · Local profile and journey data remain on this device. {lastKnownLocation ? `Last GPS fix: ${new Date(lastKnownLocation.timestamp).toLocaleString()}. ` : ''}Map lookups and backend services are unavailable; events are not queued or synced automatically.</span></div>}
        <SafetyContext.Provider value={{ location: demoMode ? coordinates : hasRecentLiveFix(location, liveLocation, 20000) ? coordinates : null, demoMode }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/onboarding" element={<OnboardingPage onComplete={() => { localStorage.setItem('sahara-onboarding-complete', 'true'); setOnboardingComplete(true); }} />} />
          <Route path="/signup" element={<Navigate to="/profile-setup" replace />} />
          <Route path="/profile-setup" element={<ProfilePage profile={profile} setProfile={setProfile} contacts={contacts} setContacts={setContacts} notify={notify} />} />
          <Route path="/profile" element={<ProfilePage profile={profile} setProfile={setProfile} contacts={contacts} setContacts={setContacts} notify={notify} />} />
          <Route path="/home" element={!onboardingComplete ? <Navigate to="/onboarding" replace /> : !profile.name.trim() ? <Navigate to="/profile-setup" replace /> : <Dashboard profile={profile} journey={journey} batteryPct={batteryPct} emergency={emergency} location={location} liveLocation={liveLocation} demoMode={demoMode} contacts={contacts} activity={activity} />} />
          <Route path="/dashboard" element={<Navigate to="/home" replace />} />
          <Route path="/journey" element={<JourneySetup journey={journey} startJourney={startJourney} notify={notify} location={location} liveLocation={liveLocation} demoMode={demoMode} requestLocation={requestLocation} />} />
          <Route path="/live-journey" element={<LiveJourney journey={journey} batteryPct={batteryPct} location={location} liveLocation={liveLocation} demoMode={demoMode} travelledPath={travelledPath} shareLocation={shareLocation} requestLocation={requestLocation} endJourney={endJourney} recordCheckIn={recordJourneyCheckIn} notify={notify} />} />
            <Route path="/sos" element={<FunctionalSosPage emergency={emergency} activateEmergency={activateEmergency} beginEmergencySequence={beginEmergencySequence} cancelEmergencySequence={cancelEmergencySequence} activationCountdown={activationCountdown} resolveEmergency={resolveEmergency} countdown={countdown} contacts={contacts} location={location} liveLocation={liveLocation} demoMode={demoMode} shareLocation={shareLocation} notificationLog={notificationLog} alertSoundOn={alertSoundOn} startAlertSound={startAlertSound} stopAlertSound={stopAlertSound} duressPin={duressPin} />} />
          <Route path="/journey-alert" element={<AlertPage journey={journey} emergency={emergency} beginEmergencySequence={beginEmergencySequence} resolveEmergency={resolveEmergency} countdown={countdown} contacts={contacts} location={location} liveLocation={liveLocation} batteryPct={batteryPct} demoMode={demoMode} recordCheckIn={recordJourneyCheckIn} extendJourneyArrival={extendJourneyArrival} />} />
          <Route path="/notifications" element={<NotificationCenter activity={activity} notificationLog={notificationLog} seenActivityIds={seenActivityIds} markAllViewed={() => setSeenActivityIds(activity.map((item) => item.id))} />} />
          <Route path="/history" element={<SafetyHistory activity={activity} />} />
          <Route path="/privacy" element={<PrivacyCenter profile={profile} contacts={contacts} journey={journey} reports={reports} evidence={evidence} activity={activity} notificationLog={notificationLog} lastKnownLocation={lastKnownLocation} shareLocation={shareLocation} setShareLocation={setShareLocation} onClearData={clearLocalData} notify={notify} />} />
          <Route path="/voice" element={<VoicePage journey={journey} notify={notify} location={location} liveLocation={liveLocation} contacts={contacts} demoMode={demoMode} profile={profile} requestLocation={requestLocation} recordCheckIn={recordJourneyCheckIn} emergency={emergency} resolveEmergency={resolveEmergency} beginEmergencySequence={beginEmergencySequence} alertSoundOn={alertSoundOn} startAlertSound={startAlertSound} stopAlertSound={stopAlertSound} />} />
          <Route path="/evidence" element={<EvidenceVault evidence={evidence} addEvidence={addEvidence} addEvidenceNote={addEvidenceNote} deleteEvidence={deleteEvidence} downloadEvidence={downloadEvidence} notify={notify} />} />
          <Route path="/nearby-help" element={<NearbyHelp notify={notify} location={location} liveLocation={liveLocation} demoMode={demoMode} requestLocation={requestLocation} />} />
          <Route path="/community-map" element={<CommunityMap reports={reports} addReport={addReport} location={location} liveLocation={liveLocation} demoMode={demoMode} notify={notify} />} />
          <Route path="/battery" element={<BatteryPage batteryPct={batteryPct} batteryTimeRemaining={batteryTimeRemaining} batteryStatus={batteryStatus} batteryError={batteryError} location={location} lastKnownLocation={lastKnownLocation} liveLocation={liveLocation} demoMode={demoMode} shareLocation={shareLocation} notify={notify} />} />
          <Route path="/smartwatch" element={<Smartwatch beginEmergencySequence={beginEmergencySequence} journey={journey} batteryPct={batteryPct} recordCheckIn={recordJourneyCheckIn} notify={notify} />} />
          <Route path="/guardian" element={<Guardian profile={profile} journey={journey} batteryPct={batteryPct} location={location} liveLocation={liveLocation} demoMode={demoMode} emergency={emergency} contacts={contacts} notificationLog={notificationLog} />} />
          <Route path="/settings" element={<SettingsRoute profile={profile} setProfile={setProfile} contacts={contacts} setContacts={setContacts} shareLocation={shareLocation} setShareLocation={setShareLocation} notify={notify} liveLocation={liveLocation} demoMode={demoMode} requestLocation={requestLocation} setDemoMode={setDemoMode} alertSoundOn={alertSoundOn} startAlertSound={startAlertSound} stopAlertSound={stopAlertSound} duressPin={duressPin} setDuressPin={setDuressPin} />} />
          <Route path="*" element={<Navigate to="/landing" replace />} />
        </Routes>
        </SafetyContext.Provider>
      </main>
      {!isLanding && <MobileNav emergency={emergency} />}
      <div className="toast-stack" aria-live="polite">
        {notifications.map((item) => <div className={`toast toast--${item.kind}`} key={item.id}><CheckCircle2 size={17} />{item.message}<button onClick={() => setNotifications((all) => all.filter(({ id }) => id !== item.id))} aria-label="Dismiss notification"><X size={15} /></button></div>)}
      </div>
    </>
  );
}

function AppShell({ profile, demoMode, setDemoMode, emergency, activity, seenActivityIds, onModeToggle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const unreadCount = activity.filter((item) => !seenActivityIds.includes(item.id)).length;
  return (
    <>
      <aside className="sidebar">
        <Link to="/home" className="brand"><span className="brand-mark"><Shield size={20} /></span><span>SAHARA <b>AI</b><small>Stay alert · Stay aware · Stay safe</small></span></Link>
        <div className="side-caption">YOUR SPACE</div>
        <nav className="side-nav">{navItems.map(({ to, label, icon: Icon }) => <NavLink to={to} key={to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{label}</span>{to === '/sos' && emergency && <i className="nav-alert-dot" />}</NavLink>)}</nav>
        <div className="sidebar-bottom"><div className="circle-card"><div className="circle-icon"><Heart size={17} /></div><b>Your circle, close</b><p>{profile.name.split(' ')[0] || 'Your profile'}, {demoMode ? 'Demo Mode is selected; GPS is paused.' : 'Live Mode is selected.'}</p><Link to="/profile">Manage contacts <ArrowRight size={13} /></Link></div><div className="sidebar-user"><div className="avatar avatar--small">{profile.name.slice(0, 1) || '?'}</div><div><b>{profile.name || 'Complete your profile'}</b><small>Personal account</small></div><Link to="/settings" aria-label="Settings"><Settings size={17} /></Link></div></div>
      </aside>
      <header className="topbar"><button className="icon-button menu-toggle" aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}><Menu size={21} /></button><div className="mobile-brand"><span className="brand-mark"><Shield size={18} /></span>SAHARA <b>AI</b></div><div className="breadcrumb">Your safety <ChevronRight size={14} /> <span>{navItems.find((item) => item.to === window.location.pathname)?.label || 'Overview'}</span></div><div className="topbar-actions"><button className={`mode-chip ${demoMode ? 'is-demo' : 'is-live'}`} onClick={onModeToggle} title={demoMode ? 'Switch to Live Mode and enable device GPS' : 'Switch to Demo Mode and pause GPS'}><span />{demoMode ? 'DEMO MODE' : 'LIVE MODE'}</button><Link className="icon-button notification-button" to="/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}><Bell size={18} />{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}</Link><Link to="/profile" className="topbar-profile"><div className="avatar avatar--tiny">{profile.name.slice(0, 1) || '?'}</div><span>{profile.name.split(' ')[0] || 'Profile'}</span></Link></div></header>
      {menuOpen && <div className="mobile-menu">{navItems.map(({ to, label, icon: Icon }) => <NavLink to={to} key={to} onClick={() => setMenuOpen(false)}><Icon size={17} />{label}</NavLink>)}</div>}
    </>
  );
}

function MobileNav({ emergency }) {
  const tabs = [{ to: '/home', label: 'Home', icon: Home }, { to: '/journey', label: 'Journey', icon: RouteIcon }, { to: '/sos', label: 'SOS', icon: Siren }, { to: '/nearby-help', label: 'Nearby', icon: MapPin }, { to: '/profile', label: 'Profile', icon: Users }];
  return <nav className="mobile-nav">{tabs.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `mobile-nav-link ${isActive ? 'active' : ''} ${to === '/sos' ? 'mobile-sos' : ''}`}><Icon size={19} /><span>{label}</span>{to === '/sos' && emergency && <i />}</NavLink>)}</nav>;
}

function Landing() {
  return <div className="landing-wrap">
    <header className="landing-nav"><Link to="/" className="brand"><span className="brand-mark"><Shield size={20} /></span><span>SAHARA <b>AI</b><small>Safety, with you.</small></span></Link><nav><a href="#features">Features</a><Link to="/home">Your dashboard</Link><Link to="/onboarding" className="button button--dark button--small">Get started <ArrowRight size={15} /></Link></nav></header>
    <section className="hero">
      <div className="hero-media">
        <img className="hero-photo" src="/sahara-ai-hero.png" alt="SAHARA AI artwork featuring two women, the safety shield, and the app's safety features" />
      </div>
      <div className="hero-copy">
        <div className="hero-actions">
          <Link to="/onboarding" className="button button--hot">Get started <ArrowRight size={17} /></Link>
          <a href="#features" className="text-button">Explore features <ArrowDownLeft size={16} /></a>
        </div>
      </div>
    </section>
    <section className="landing-quote"><span className="quote-mark">“</span><p>Every woman deserves to feel safe <em>wherever life takes her.</em></p><span className="quote-label">THE SAHARA PROMISE</span></section>
    <section className="feature-section" id="features"><div className="section-heading"><div><div className="eyebrow">A LITTLE MORE PEACE OF MIND</div><h2>Safety that moves<br /><em>with your life.</em></h2></div><p>One calm place for the moments that matter, from planning your trip to reaching your people.</p></div><div className="feature-grid">{featureItems.map(({ title, detail, icon: Icon, to }, index) => <Link to={to} key={title} className="feature-card"><div className={`feature-icon feature-icon--${index}`}><Icon size={20} /></div><span className="feature-index">0{index + 1}</span><h3>{title}</h3><p>{detail}</p><span className="feature-arrow"><ArrowRight size={17} /></span></Link>)}</div></section>
    <footer className="landing-footer"><Link to="/" className="brand"><span className="brand-mark"><Shield size={17} /></span><span>SAHARA <b>AI</b></span></Link><span>Move freely. Stay connected.</span><span>Prototype · Demo mode</span></footer>
  </div>;
}

function PageHeader({ eyebrow, title, subtitle, action }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}
function SplashScreen() {
  return (
    <div className="splash-screen">
      <div className="splash-glow" />
      <div className="splash-content">
        <div className="splash-logo">
          <div className="splash-shield">
            <Shield size={44} />
          </div>
        </div>
        <div className="splash-brand">SAHARA AI</div>
        <p className="splash-tagline">Safer Journeys.<br />Stronger Women.<br />Brighter Communities.</p>
        <p className="splash-subtitle">Your safety companion, wherever you go.</p>
        <div className="splash-loading">
          <span />
          <span />
          <span />
        </div>
        <p className="splash-status">Preparing your safe journey...</p>
      </div>
    </div>
  );
}

function OnboardingPage({ onComplete }) {
  const steps = [
    { title: 'Your Journey. Your Safety.', description: 'Plan a local journey and record check-ins. GPS is used only with browser permission; route guidance is not connected.', accent: 'journey', icon: RouteIcon },
    { title: 'One Tap Can Ask For Help.', description: 'Start an on-device SOS flow. No emergency-service call or trusted-contact message is placed automatically.', accent: 'sos', icon: Siren },
    { title: 'Your Trusted Circle, Always Closer.', description: 'Keep contact details on this device and choose when to open your phone’s call, message, or share sheet.', accent: 'circle', icon: Users },
  ];
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const step = steps[index];
  const Icon = step.icon;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-shell">
        <header className="onboarding-topbar">
          <div className="brand"><span className="brand-mark"><Shield size={18} /></span><span>SAHARA <b>AI</b></span></div>
          <button className="text-link" type="button" onClick={() => { onComplete(); navigate('/profile-setup'); }}>Skip</button>
        </header>

        <div className={`onboarding-visual onboarding-visual--${step.accent}`}>
          <div className="onboarding-badge"><Icon size={20} /></div>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="illustration-card">
            <div className="illustration-pin"><MapPin size={18} /></div>
            <div className="illustration-shield"><ShieldCheck size={18} /></div>
            <div className="illustration-wave" />
          </div>
        </div>

        <div className="onboarding-copy">
          <span className="eyebrow">SAFETY ONBOARDING</span>
          <h1>{step.title}</h1>
          <p>{step.description}</p>
        </div>

        <div className="onboarding-dots" aria-label="Onboarding progress">
          {steps.map((item, itemIndex) => <button key={item.title} type="button" className={itemIndex === index ? 'active' : ''} onClick={() => setIndex(itemIndex)} aria-label={`Go to slide ${itemIndex + 1}`} />)}
        </div>

        <div className="onboarding-actions">
          <button className="button button--outline" type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>Back</button>
          {index < steps.length - 1 ? (
            <button className="button button--hot" type="button" onClick={() => setIndex((current) => current + 1)}>Next</button>
          ) : (
            <button className="button button--hot" type="button" onClick={() => { onComplete(); navigate('/profile-setup'); }}>Get Started</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ className = '', children }) { return <section className={`panel ${className}`}>{children}</section>; }
function Button({ children, variant = 'primary', className = '', ...props }) { return <button className={`button button--${variant} ${className}`} {...props}>{children}</button>; }
function SectionTitle({ title, trailing }) { return <div className="section-title"><h2>{title}</h2>{trailing}</div>; }
function SafetyInsight({ children = 'Add trusted contacts and start a journey to use the safety tools available on this device.' }) { return <div className="insight"><span className="insight-icon"><Sparkles size={17} /></span><div><small>SAHARA INSIGHT <i>PROTOTYPE ANALYSIS</i></small><p>{children}</p></div><ChevronRight size={16} /></div>; }
function StatusTag({ children, tone = 'safe' }) { return <span className={`status-pill status-pill--${tone}`}><span />{children}</span>; }

function Dashboard({ profile, journey, batteryPct, emergency, location, liveLocation, demoMode, contacts, activity }) {
  const recentGpsFix = hasRecentLiveFix(location, liveLocation);
  const gpsLabel = demoMode ? 'GPS paused in Demo Mode' : recentGpsFix ? liveLocation.status === 'weak' ? 'GPS signal weak' : 'GPS connected' : liveLocation.error || 'Waiting for a recent GPS fix';
  const firstName = profile.name.trim().split(/\s+/)[0];
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';
  const safetyStatus = emergency
    ? 'Emergency active'
    : journey.active
      ? 'Journey active on this device'
      : profile.name.trim() && contacts.length
        ? 'Profile ready on this device'
        : 'Setup needed';
  const statusTone = emergency ? 'danger' : recentGpsFix ? 'safe' : 'warning';
  const journeyStatusText = journey.active ? 'Journey in progress' : 'No active journey';
  const dashboardCards = [
    { title: 'Voice Commands', caption: 'Hands-free support', to: '/voice', icon: Mic, tone: 'rose' },
    { title: 'Evidence Vault', caption: 'Saved on this device', to: '/evidence', icon: LockKeyhole, tone: 'wine' },
    { title: 'Nearby Help', caption: 'Find support', to: '/nearby-help', icon: LifeBuoy, tone: 'coral' },
    { title: 'Community Map', caption: 'Know your area', to: '/community-map', icon: Map, tone: 'lilac' },
    { title: 'Safety Settings', caption: 'Manage your tools', to: '/settings', icon: BookOpen, tone: 'gold' },
    { title: 'Journey Status', caption: 'Journey overview', to: '/live-journey', icon: RouteIcon, tone: 'mint' },
    { title: 'Battery Guardian', caption: 'Device reading only', to: '/battery', icon: BatteryCharging, tone: 'blue' },
    { title: 'Trusted Circle', caption: 'Manage your contacts', to: '/profile', icon: Users, tone: 'coral' },
    { title: 'Watch Preview', caption: 'No watch connected', to: '/smartwatch', icon: Watch, tone: 'wine' },
  ];

  return (
    <div className="page-content">
      <div className="dashboard-shell">
        <div className="dashboard-phone">
          <header className="dashboard-phone-header">
            <div className="brand brand--compact">
              <span className="brand-mark"><Shield size={16} /></span>
              <span>SAHARA <b>AI</b></span>
            </div>
            <span className="status-chip status-chip--soft">{demoMode ? 'Demo Mode' : 'Live Mode'}</span>
          </header>

          <div className="dashboard-hero">
            <div className="dashboard-hero-copy">
              <span className="eyebrow">YOUR SAFETY COMPANION</span>
              <div className="dashboard-intro-row">
                <div>
                  <h2>{firstName ? `${greeting}, ${firstName}` : 'Welcome to SAHARA AI'}</h2>
                  <p>{journey.active ? 'Journey monitoring is active on this device.' : 'Your safety companion is ready.'}</p>
                </div>
                <span className="dashboard-live-pill">{journeyStatusText}</span>
              </div>
            </div>
            <div className="dashboard-route-strip">
              <span><MapPin size={14} /> {journey.active ? journey.to || 'Destination not set' : 'No journey planned'}</span>
              <span className="dashboard-route-dot" />
              <span>{journey.active ? journey.eta || 'ETA unavailable' : 'Start when you are ready'}</span>
            </div>
          </div>

          <div className="dashboard-score-card">
            <div className="dashboard-score-ring">
              <div className="dashboard-status-icon" aria-hidden="true">
                {emergency ? <Siren size={34} /> : <ShieldCheck size={34} />}
              </div>
            </div>
            <div className="dashboard-score-meta">
              <span className="score-label">Your safety status</span>
              <div className="dashboard-status-value">{safetyStatus}</div>
              <StatusTag tone={statusTone}>{demoMode ? 'GPS paused in Demo Mode' : recentGpsFix ? 'Recent GPS fix' : 'Location unavailable'}</StatusTag>
              <div className="dashboard-score-stats">
                <span><MapPin size={12} /> {demoMode ? 'GPS paused' : recentGpsFix ? 'Recent GPS fix' : 'No recent fix'}</span>
                <span><RouteIcon size={12} /> {journey.active ? 'Journey active' : 'Journey inactive'}</span>
                <span><Users size={12} /> {contacts.length ? `${contacts.length} trusted contact${contacts.length === 1 ? '' : 's'}` : 'No trusted contacts'}</span>
                <span><Battery size={12} /> {batteryPct == null ? 'Battery unavailable' : `${batteryPct}% battery`}</span>
              </div>
            </div>
          </div>

          <div className="dashboard-actions">
            <Link to={journey.active ? '/live-journey' : '/journey'} className="dashboard-action dashboard-action--primary">
              <span className="dashboard-action-icon"><RouteIcon size={18} /></span>
              <b>{journey.active ? 'View Journey' : 'Start Journey'}</b>
            </Link>
            <Link to="/sos" aria-label={emergency ? 'Open active emergency status' : 'Open SOS emergency controls'} className="dashboard-action dashboard-action--danger">
              <span className="dashboard-action-icon"><Siren size={18} /></span>
              <b>SOS</b>
            </Link>
            <Link to="/voice" className="dashboard-action dashboard-action--soft">
              <span className="dashboard-action-icon"><Mic size={18} /></span>
              <b>AI Assistant</b>
            </Link>
          </div>

          <div className="dashboard-mini-grid">
            {dashboardCards.map(({ title, caption, to, icon: Icon, tone }) => (
              <Link to={to} key={title} className="dashboard-mini-card">
                <span className={`dashboard-mini-icon dashboard-mini-icon--${tone}`}><Icon size={18} /></span>
                <b>{title}</b>
                <small>{caption}</small>
              </Link>
            ))}
          </div>

          <section className="dashboard-recent-activity" aria-labelledby="dashboard-activity-title">
            <div className="dashboard-activity-heading">
              <div><span className="eyebrow">ON THIS DEVICE</span><h3 id="dashboard-activity-title">Recent activity</h3></div>
              <Link to="/history">View history <ArrowRight size={13} /></Link>
            </div>
            {activity.length ? activity.slice(0, 3).map((item) => {
              const time = new Date(item.time);
              return <div className="dashboard-activity-item" key={item.id}>
                <span className={`history-icon history-icon--${item.kind || 'info'}`}>{item.kind === 'emergency' ? <Siren size={15} /> : item.kind === 'checkin' ? <CheckCircle2 size={15} /> : <Activity size={15} />}</span>
                <span><b>{item.message}</b><small>{Number.isNaN(time.getTime()) ? 'Time unavailable' : time.toLocaleString()}</small></span>
              </div>;
            }) : <p className="small-note">Journey starts, manual check-ins, and other local events will appear here.</p>}
          </section>

          <div className="dashboard-foot-summary">
            <div className="dashboard-foot-item">
              <span className="eyebrow">Location</span>
              <b>{gpsLabel}</b>
            </div>
            <div className="dashboard-foot-item">
              <span className="eyebrow">Battery</span>
              <b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function JourneySetup({ journey, startJourney, notify, location, liveLocation, demoMode, requestLocation }) {
  const [to, setTo] = useState(journey.to || '');
  const [eta, setEta] = useState(journey.eta || '');
  const [etaInput, setEtaInput] = useState(() => journey.expectedArrivalAt && Number.isFinite(Date.parse(journey.expectedArrivalAt))
    ? new Date(journey.expectedArrivalAt).toTimeString().slice(0, 5)
    : '');
  const [checkInIntervalMinutes, setCheckInIntervalMinutes] = useState(journey.checkInIntervalMinutes || 15);
  const [routeType, setRouteType] = useState('Safer route preference');
  const navigate = useNavigate();
  const hasRecentFix = hasRecentLiveFix(location, liveLocation);
  const originLabel = location && hasRecentFix
    ? `Live GPS · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : '';
  const submit = (event) => {
    event.preventDefault();
    if (!demoMode && !hasRecentFix) {
      notify('A recent GPS fix is required before live journey monitoring can start.', 'alert');
      requestLocation();
      return;
    }
    if (!to.trim() || !eta) {
      notify('Enter a destination and expected arrival time to continue.', 'alert');
      return;
    }
    startJourney({
      from: originLabel,
      to: to.trim(),
      eta,
      expectedArrivalAt: nextArrivalTimestamp(etaInput),
      checkInIntervalMinutes,
      route: routeType,
    });
    navigate('/live-journey');
  };
  return <div className="page-content"><PageHeader eyebrow="YOUR NEXT MOVE" title="Start a safe journey" subtitle={demoMode ? 'Set up a local journey. GPS stays paused in Demo Mode; route guidance and contact alerts are not configured.' : 'Set up a local journey. GPS stays on this device; route guidance and contact alerts are not configured.'} action={<Link to="/home" className="button button--outline"><ArrowLeft size={15} /> Back</Link>} />
    <form className="journey-layout" onSubmit={submit}>
      <div className="journey-form-column">
        <Panel className="form-panel">
          <SectionTitle title="Your route" />
          <label className="field-label">CURRENT GPS LOCATION<div className="input-wrap"><MapPin size={17} /><input value={originLabel} readOnly placeholder={demoMode ? 'GPS paused in Demo Mode' : 'Allow location access to continue'} /></div></label>
          {!location && !demoMode && <div className="nearby-permission"><p>Live location is required for journey monitoring. Your browser may ask for permission.</p><Button variant="outline" type="button" onClick={requestLocation}>Enable location <MapPin size={15} /></Button></div>}
          {demoMode && <div className="nearby-permission"><p>Demo Mode does not create sample GPS coordinates. Journey check-ins still run locally, but location tracking is paused.</p><Button variant="outline" type="button" onClick={requestLocation}>Switch to Live GPS <MapPin size={15} /></Button></div>}
          <label className="field-label">DESTINATION<div className="input-wrap"><MapPin size={17} /><input value={to} onChange={(event) => setTo(event.target.value)} required placeholder="Enter your destination" /></div></label>
          <label className="field-label">EXPECTED ARRIVAL<div className="input-wrap"><Clock3 size={17} /><input type="time" value={etaInput} required onChange={(event) => { setEtaInput(event.target.value); const [hour, minute] = event.target.value.split(':').map(Number); setEta(`${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`); }} /></div></label>
          <label className="field-label">SAFETY CHECK-IN FREQUENCY<select value={checkInIntervalMinutes} onChange={(event) => setCheckInIntervalMinutes(Number(event.target.value))}>{[5, 10, 15, 30].map((minutes) => <option value={minutes} key={minutes}>{minutes} minutes</option>)}</select></label>
          <p className="small-note">A reminder appears on this device while the app is open. Missed check-ins do not automatically contact anyone.</p>
        </Panel>
        <Panel className="form-panel">
          <SectionTitle title="Journey capabilities" />
          <div className="toggle-list">
            {[
              ['Safety check-ins', `Local reminders every ${checkInIntervalMinutes} minutes while the app is open.`, 'ON DEVICE'],
              ['Battery status', 'Local reminders at 20%, 15%, and 10% when supported.', 'ON DEVICE'],
              ['Route deviation alerts', 'Unavailable until a real routing service is configured.', 'UNAVAILABLE'],
              ['Trusted circle sharing', 'Unavailable until a contact-delivery service is configured.', 'UNAVAILABLE'],
            ].map(([name, hint, status]) => <div className="toggle-row journey-capability-row" key={name}><span className="toggle-copy"><b>{name}</b><small>{hint}</small></span><span className="demo-badge">{status}</span></div>)}
          </div>
        </Panel>
      </div>
      <div className="journey-side-column">
        <Panel className="route-choice-panel">
          <SectionTitle title="Route preferences" />
          <button type="button" className={`route-choice ${routeType === 'Safer route preference' ? 'selected' : ''}`} onClick={() => setRouteType('Safer route preference')}><span className="route-choice-icon"><ShieldCheck size={19} /></span><span><b>Prefer a safer route</b><small>Saved as a preference; not applied without a routing service</small></span></button>
          <button type="button" className={`route-choice ${routeType === 'Direct route preference' ? 'selected' : ''}`} onClick={() => setRouteType('Direct route preference')}><span className="route-choice-icon route-choice-icon--fast"><Zap size={18} /></span><span><b>Prefer a direct route</b><small>Saved as a preference; not applied without a routing service</small></span></button>
          <div className="route-map-preview"><MapView compact route={false} demoMode={demoMode} /></div>
          <p className="small-note">Live route guidance, distance, and safety scoring are unavailable because no routing service is configured.</p>
          <Button type="submit" variant="hot" className="button--full">Start journey <ArrowRight size={16} /></Button>
        </Panel>
        <p className="privacy-caption"><LockKeyhole size={14} /> {demoMode ? 'GPS monitoring is paused. Trusted-contact alerts need a configured backend.' : 'GPS monitoring stays on this device. Trusted-contact alerts need a configured backend.'}</p>
      </div>
    </form>
  </div>;
}

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, map.getZoom(), { animate: true }); }, [center?.[0], center?.[1], map]);
  return null;
}

function MapView({ compact = false, places = [], reports = [], location, demoMode, route = true, destinationPoint, originPoint, travelledPath = [] }) {
  const sharedState = useContext(SafetyContext);
  if (demoMode === undefined) demoMode = sharedState?.demoMode ?? false;
  if (location === undefined) location = sharedState?.location ?? null;
  places = places.filter((place) => demoMode || place.source);
  reports = reports.filter((report) => report.point);
  const center = Array.isArray(location) ? location : location ? [location.latitude, location.longitude] : null;
  if (!center) {
    const message = demoMode
      ? 'Demo Mode is active. No sample location is shown.'
      : 'Enable location access to center the map on your device.';
    return <div className={`map-frame map-frame--unavailable ${compact ? 'map-frame--compact' : ''}`}><div><MapPin size={24} /><b>{demoMode ? 'GPS paused in Demo Mode' : 'Live map waiting for GPS'}</b><span>{message}</span></div></div>;
  }
  const plannedPath = destinationPoint && (originPoint || center) ? [originPoint || center, destinationPoint] : [];
  const renderedDestination = destinationPoint || null;
  return <div className={`map-frame ${compact ? 'map-frame--compact' : ''}`}><MapContainer center={center} zoom={compact ? 14 : 15} scrollWheelZoom={!compact} zoomControl={!compact} className="leaflet-map"><MapRecenter center={center} /><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />{plannedPath.length > 1 && <Polyline positions={plannedPath} pathOptions={{ color: '#e74476', weight: 5, opacity: 0.8, dashArray: '8 7' }} />}{travelledPath.length > 1 && <Polyline positions={travelledPath} pathOptions={{ color: '#4a1238', weight: 5, opacity: 0.9 }} />}{renderedDestination && <CircleMarker center={renderedDestination} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#d94f7d', fillOpacity: 1 }}><Tooltip>Destination · direct-line preview</Tooltip></CircleMarker>}<CircleMarker center={center} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#159579', fillOpacity: 1 }}><Tooltip>Current GPS location</Tooltip></CircleMarker>{places.map((place) => <CircleMarker key={place.name} center={place.point} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: place.type === 'Safe Zone' ? '#18a689' : place.type === 'Unsafe Area' ? '#ee4774' : '#f59b4c', fillOpacity: 1 }}><Tooltip>{place.name}</Tooltip></CircleMarker>)}{reports.map((report, index) => <Circle key={`${report.id}-${index}`} center={report.point} radius={90} pathOptions={{ color: '#ed4976', fillColor: '#ed4976', fillOpacity: 0.14 }} />)}</MapContainer><span className="map-compass"><Crosshair size={17} /></span></div>;
}

function LiveJourney({ journey, batteryPct, location, liveLocation, demoMode, travelledPath, shareLocation, requestLocation, endJourney, recordCheckIn, notify }) {
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const coordinates = demoMode
    ? location ? [location.latitude, location.longitude] : null
    : hasRecentLiveFix(location, liveLocation, 20000) ? [location.latitude, location.longitude] : null;
  const locationAge = location ? Math.max(0, Math.floor((now - location.timestamp) / 1000)) : null;
  const gpsConnected = !demoMode && hasRecentLiveFix(location, liveLocation, 20000);
  const statusMessage = demoMode
    ? 'DEMO MODE · GPS is paused'
    : gpsConnected
      ? liveLocation.status === 'weak' ? 'GPS signal weak · accuracy may vary' : 'LIVE LOCATION · GPS connected'
      : locationAge >= 20 ? 'GPS signal stale · waiting for another fix'
        : liveLocation.status === 'denied' ? 'Location permission denied'
          : liveLocation.status === 'unsupported' ? 'Live tracking unavailable'
            : liveLocation.status === 'unavailable' ? 'GPS unavailable · check signal'
              : 'Waiting for GPS permission...';
  const shareCurrentLocation = async () => {
    if (!shareLocation) {
      notify('Enable manual location-link sharing in Settings before creating a location link.', 'alert');
      return;
    }
    if (demoMode || !coordinates || !gpsConnected) {
      notify('A recent live GPS fix is required before sharing a location.', 'alert');
      return;
    }
    const mapUrl = `https://www.openstreetmap.org/?mlat=${coordinates[0]}&mlon=${coordinates[1]}#map=16/${coordinates[0]}/${coordinates[1]}`;
    const shareData = { title: 'My current location', text: 'My current location shared from SAHARA AI.', url: mapUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        notify('Location link handed to your device share sheet. Confirm delivery in the app you chose.', 'info');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mapUrl);
        notify('Location link copied. Choose who to send it to.', 'info');
      } else {
        notify('Location sharing is unavailable in this browser. No link was sent.', 'alert');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      notify(`Could not prepare a location link${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const lastCheckIn = journey.lastCheckInAt
    ? new Date(journey.lastCheckInAt).toLocaleString()
    : 'No check-in recorded';

  return <div className="page-content">
    <PageHeader eyebrow="YOUR JOURNEY" title={journey.active ? 'You’re on your way.' : 'Live journey'} subtitle={journey.active ? demoMode ? 'Journey and manual check-ins stay on this device. GPS is paused in Demo Mode; route guidance and automatic contact alerts are not configured.' : 'Location updates stay on this device. Route guidance and automatic contact alerts are not configured.' : 'No active journey. Start one when you’re ready.'} action={<span className={`mode-chip ${gpsConnected ? 'is-live' : 'is-demo'}`}><span />{gpsConnected ? 'LIVE LOCATION' : demoMode ? 'GPS PAUSED' : 'GPS UNAVAILABLE'}</span>} />
    {!journey.active && <div className="inline-callout"><CircleHelp size={18} /><span>{demoMode ? 'Plan a journey to record local manual check-ins; GPS remains paused in Demo Mode.' : 'There’s no active trip right now. Plan a journey to see live tracking here.'}</span><Link to="/journey">Plan a journey <ArrowRight size={14} /></Link></div>}
    <div className="live-layout">
      <Panel className="live-map-panel">
        <div className="map-top-label"><span className={`live-indicator ${gpsConnected ? 'live-indicator--on' : ''}`} /><span><b>{journey.from || 'Starting location unavailable'}</b><small>Destination: {journey.to || 'Not set'}</small></span><StatusTag tone={gpsConnected ? 'safe' : 'warning'}>{demoMode ? 'GPS PAUSED' : gpsConnected ? 'GPS ACTIVE' : 'GPS WAITING'}</StatusTag></div>
        <MapView location={coordinates} demoMode={demoMode} route destinationPoint={journey.destinationPoint} originPoint={journey.originPoint} travelledPath={travelledPath} />
        <div className="map-legend"><span><i className="legend-dot legend-dot--you" />{gpsConnected ? 'Current position' : demoMode ? 'No GPS position' : 'Position unavailable'}</span><span><i className="legend-line" /> Direct-line preview, not navigation</span><span><i className="legend-line legend-line--travelled" /> Recorded GPS positions</span><button type="button" onClick={requestLocation}><Crosshair size={15} /> {gpsConnected ? 'Refresh GPS' : 'Enable location'}</button></div>
        <div className={`gps-detail ${gpsConnected ? 'gps-detail--live' : ''}`}><span className={`live-indicator ${gpsConnected ? 'live-indicator--on' : ''}`} /><div><b>{statusMessage}</b><small>{demoMode ? 'No location updates are recorded in Demo Mode.' : location ? `Last updated ${locationAge} sec ago · Accuracy approximately ${Math.round(location.accuracy)} m` : liveLocation.error || 'Allow location access to show your current position.'}</small></div>{!gpsConnected && !demoMode && <button type="button" className="button button--outline" onClick={requestLocation}>Allow location access</button>}</div>
      </Panel>
      <div className="live-details">
        <Panel className="journey-active-panel">
          <span className="eyebrow">{journey.active ? 'JOURNEY ACTIVE' : 'JOURNEY STANDBY'}</span>
          <h2>{journey.to || 'No destination set'}</h2>
          <div className="live-eta"><Clock3 size={18} /><div><b>{journey.eta || 'Not set'}</b><small>Your expected arrival time · not a live ETA</small></div></div>
          <div className="metric-grid"><div><span>DISTANCE LEFT</span><b>Unavailable</b></div><div><span>DURATION</span><b>{journey.active ? elapsedLabel(journey.startedAt) : 'Not started'}</b></div><div><span>BATTERY</span><b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`}</b></div></div>
          <div className="journey-location-detail"><MapPin size={16} /><span><b>{coordinates ? `${coordinates[0].toFixed(5)}, ${coordinates[1].toFixed(5)}` : 'Current location unavailable'}</b><small>{demoMode ? 'GPS paused in Demo Mode' : gpsConnected ? `Accuracy ±${Math.round(location.accuracy)} m` : liveLocation.error || 'Waiting for a recent GPS fix'}</small></span></div>
          {journey.active && <div className="journey-checkin"><span><CheckCircle2 size={16} /><span><b>Manual check-in</b><small>{lastCheckIn} · stored on this device</small></span></span><Button variant="safe" onClick={recordCheckIn}>I’m safe</Button></div>}
          {journey.active && <Button variant="outline" onClick={shareCurrentLocation}><Navigation size={16} /> Share current GPS location</Button>}
          {journey.active && !shareLocation && <p className="small-note">Enable manual location-link sharing in Settings before sharing.</p>}
          {journey.active && <Button variant="dark-outline" onClick={() => { endJourney(); navigate('/home'); }}><Check size={16} /> End journey</Button>}
        </Panel>
        <SafetyInsight>{demoMode ? 'GPS tracking, coordinates, and location results are paused in Demo Mode. Manual check-ins remain available on this device.' : gpsConnected ? 'GPS updates are being recorded on this device. Route guidance, deviation detection, and contact delivery are unavailable without configured services.' : 'Live tracking is waiting for browser location access.'}</SafetyInsight>
        <Link to="/journey-alert" className="missed-link"><Clock3 size={15} /> Check-ins & alerts <ArrowRight size={14} /></Link>
      </div>
    </div>
  </div>;
}

function SosPage({ emergency, activateEmergency, beginEmergencySequence, cancelEmergencySequence, activationCountdown, resolveEmergency, countdown, contacts, location, demoMode, shareLocation, notificationLog, alertSoundOn, startAlertSound, stopAlertSound, duressPin }) {
  const [pin, setPin] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pinMessage, setPinMessage] = useState('');
  useEffect(() => { if (emergency) { setShowConfirm(false); setShowCancelConfirm(false); } }, [emergency]);
  const checkPin = (event) => { event.preventDefault(); const accepted = Boolean(duressPin) && pin === duressPin; setPinMessage(accepted ? 'Duress PIN accepted. Emergency mode is active.' : duressPin ? 'PIN not recognized.' : 'Set a Duress PIN in Settings for this browser session first.'); if (accepted) activateEmergency(); setPin(''); };
  const coordinates = location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'Unavailable';
  const triggeredAt = notificationLog[0]?.time ? new Date(notificationLog[0].time).toLocaleString() : 'Not active';
  return <div className="page-content"><PageHeader eyebrow="HERE WHEN IT MATTERS" title="Emergency support" subtitle="A clear next step when you or someone you care about needs help." />
    <div className="sos-layout"><Panel className={`sos-panel ${emergency ? 'sos-panel--active' : ''}`}><div className="sos-glow" /><div className="sos-panel-content"><span className="eyebrow">{emergency ? 'ACTIVE EMERGENCY' : 'EMERGENCY RESPONSE · PROTOTYPE'}</span><div className={`emergency-status-mark ${emergency ? 'emergency-status-mark--active' : ''}`}><Siren size={34} /><span>{emergency ? 'SOS ACTIVE' : 'STANDBY'}</span></div><h2>{emergency ? 'Emergency mode is active.' : 'Need help? We’re here.'}</h2><p>{emergency ? 'Contact notifications are simulated on this device. Use call or message links below to contact someone directly.' : 'Start a brief cancellation countdown before the local emergency state activates.'}</p>{emergency && <div className="emergency-summary"><span><MapPin size={14} /> {coordinates} {demoMode && '· demo'}</span><span><Clock3 size={14} /> Activated {triggeredAt}</span><span><Users size={14} /> Trusted circle sharing {shareLocation ? 'enabled locally' : 'paused'}</span></div>}{emergency && <div className="alert-countdown"><span>00:{String(countdown).padStart(2, '0')}</span><small>Emergency state duration</small></div>}{emergency ? <div className="emergency-controls"><Button variant="light" onClick={() => alertSoundOn ? stopAlertSound() : notify('Sound can be enabled during activation')}>{alertSoundOn ? 'Mute alert sound' : 'Alert sound muted'} <Volume2 size={16} /></Button><Button variant="dark-outline" onClick={() => setShowCancelConfirm(true)}>Cancel Emergency <X size={16} /></Button></div> : <Button variant="hot" onClick={() => setShowConfirm(true)}>ACTIVATE EMERGENCY <Siren size={16} /></Button>}</div><div className="sos-footer"><span><LockKeyhole size={14} /> No automatic calls or real contact messages</span><span>{demoMode ? 'GPS PAUSED' : 'DEVICE MODE'}</span></div></Panel>
      <div className="sos-aside"><Panel className="contact-panel"><SectionTitle title="Your trusted circle" trailing={<Link to="/profile" className="quiet-link">Edit <ArrowRight size={13} /></Link>} />{contacts.map((contact, index) => { const event = notificationLog.find((entry) => entry.contact === contact.name); return <div className="contact-row contact-row--actions" key={`${contact.name}-${index}`}><div className="avatar">{contact.initials || contact.name.slice(0, 1)}</div><span><b>{contact.name}</b><small>{contact.relation} · {event ? 'Notification simulated' : contact.phone || 'No number saved'}</small></span><a href={contact.phone ? `tel:${contact.phone}` : undefined} aria-label={`Call ${contact.name}`} title="Call using your device"><Phone size={15} /></a><a href={contact.phone ? `sms:${contact.phone}` : undefined} aria-label={`Message ${contact.name}`} title="Message using your device"><MessageCircle size={15} /></a></div>; })}</Panel>{emergency && <Panel className="notification-log-panel"><SectionTitle title="Emergency notification log" trailing={<span className="demo-badge">LOCAL PROTOTYPE</span>} />{notificationLog.slice(0, 4).map((entry, index) => <div className="notification-log-row" key={`${entry.contact}-${index}`}><CheckCircle2 size={15} /><span><b>{entry.contact}</b><small>{new Date(entry.time).toLocaleTimeString()} · {entry.coordinates ? entry.coordinates.join(', ') : 'Location unavailable'}</small></span><em>{entry.status}</em></div>)}<p className="small-note">No network notification was sent. Call and SMS links require your explicit action and device support.</p></Panel>}<Panel className="duress-panel"><div className="duress-icon"><ShieldAlert size={19} /></div><div><span className="eyebrow">DURESS PIN · PROTOTYPE</span><h3>A discreet emergency demo.</h3><p>Enter your configured demo PIN to demonstrate a duress state. Do not use a real PIN here.</p><form className="pin-form" onSubmit={checkPin}><input aria-label="Demo PIN" type="password" inputMode="numeric" maxLength="8" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••" /><Button variant="dark" type="submit">Check PIN <ArrowRight size={14} /></Button></form>{pinMessage && <small className="form-feedback">{pinMessage}</small>}</div></Panel><div className="feature-note"><LockKeyhole size={16} /><p><b>Honest by design.</b> A browser prototype cannot monitor physical volume buttons or trigger actions from the lock screen.</p></div></div></div>
    {showConfirm && <Modal title={activationCountdown == null ? 'Emergency activation' : 'Emergency activation'} onClose={() => { if (activationCountdown != null) cancelEmergencySequence(); setShowConfirm(false); }}><p className="modal-copy">{activationCountdown == null ? 'Confirm to begin a three-second cancellation window. The alert beep will play on this device after you confirm.' : 'Emergency activates when the countdown ends. Cancel now if this was accidental.'}</p>{activationCountdown != null ? <div className="activation-countdown"><strong>{activationCountdown}</strong><span>Cancel before activation</span><Button variant="outline" onClick={() => { cancelEmergencySequence(); setShowConfirm(false); }}>Cancel activation</Button></div> : <><div className="modal-contact-list">{contacts.slice(0, 3).map((contact) => <span key={contact.name}><CheckCircle2 size={15} /> {contact.name} · notification simulated only</span>)}</div><div className="modal-actions"><Button variant="outline" onClick={() => setShowConfirm(false)}>Not now</Button><Button variant="hot" onClick={beginEmergencySequence}>Start countdown <Siren size={15} /></Button></div></>}</Modal>}
    {showCancelConfirm && <Modal title="Cancel emergency mode?" onClose={() => setShowCancelConfirm(false)}><p className="modal-copy">This only clears the local prototype emergency state. If you are in danger, contact local emergency services directly.</p><div className="modal-actions"><Button variant="outline" onClick={() => setShowCancelConfirm(false)}>Keep active</Button><Button variant="hot" onClick={() => { resolveEmergency(); setShowCancelConfirm(false); }}>Cancel Emergency <X size={15} /></Button></div></Modal>}
  </div>;
}

function AlertPage({ journey, emergency, beginEmergencySequence, resolveEmergency, countdown, contacts, location, liveLocation, batteryPct, demoMode, recordCheckIn, extendJourneyArrival }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  const expectedAt = journey.expectedArrivalAt ? new Date(journey.expectedArrivalAt) : null;
  const checkedInAfterArrival = journey.lastCheckInAt && expectedAt && new Date(journey.lastCheckInAt).getTime() >= expectedAt.getTime();
  const arrivalPassed = Boolean(journey.active && expectedAt && expectedAt.getTime() <= now && !checkedInAfterArrival);
  const checkInDue = Boolean(journey.active && journey.pendingCheckInAt);
  const lastCheckIn = journey.lastCheckInAt ? new Date(journey.lastCheckInAt).toLocaleString() : 'No check-in recorded';
  const hasRecentFix = hasRecentLiveFix(location, liveLocation);
  const coordinates = demoMode && location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : hasRecentFix ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'No recent GPS fix';
  return <div className="page-content">
    <PageHeader eyebrow="SAFETY CHECK-IN" title={emergency ? 'Emergency response' : journey.active ? 'Journey check-in' : 'Journey alerts'} subtitle="Check-ins are manual. Arrival reminders run only while this browser app remains open; no automatic emergency alert is sent." />
    <div className="alert-page-grid">
      <Panel className={`alert-card ${emergency || arrivalPassed ? 'alert-card--active' : ''}`}>
        <div className="alert-emblem">{emergency ? <Siren size={26} /> : <CheckCircle2 size={26} />}</div>
        <span className="eyebrow">{emergency ? 'LOCAL EMERGENCY STATE' : checkInDue ? 'CHECK-IN REMINDER DUE' : arrivalPassed ? 'ARRIVAL TIME PASSED' : journey.active ? 'MANUAL CHECK-IN' : 'NO ACTIVE JOURNEY'}</span>
        <h2>{emergency ? 'Emergency mode is active on this device.' : checkInDue || arrivalPassed ? 'Please check in on your journey.' : journey.active ? 'How are you doing?' : 'Start a journey to use check-ins.'}</h2>
        <p>{emergency ? 'No emergency service call or contact message is confirmed. If you need immediate help, contact local emergency services directly.' : journey.active ? 'This check-in is recorded locally. Missing an ETA or reminder does not automatically contact anyone.' : 'Create a journey first. Safety check-ins and arrival reminders are local to this browser.'}</p>
        {emergency && <div className="countdown-large">00:{String(countdown).padStart(2, '0')}</div>}
        {journey.active && <div className="alert-facts"><span><Clock3 size={15} /> Expected arrival <b>{journey.eta || 'Not set'}</b></span><span><CheckCircle2 size={15} /> Check-in frequency <b>Every {journey.checkInIntervalMinutes || 15} minutes</b></span><span><CheckCircle2 size={15} /> Last check-in <b>{lastCheckIn}</b></span><span><MapPin size={15} /> Current location <b>{coordinates}{demoMode ? ' · demo' : ''}</b></span><span><Battery size={15} /> Battery <b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`}</b></span></div>}
        {emergency
          ? <div className="alert-actions"><Button variant="safe" onClick={resolveEmergency}><Check size={16} /> I’m safe · clear local state</Button><Link to="/sos" className="button button--outline"><Siren size={16} /> Review emergency</Link></div>
          : journey.active
            ? <div className="alert-actions"><Button variant="safe" onClick={recordCheckIn}><Check size={16} /> I’m safe</Button><Button variant="hot" onClick={beginEmergencySequence}><Siren size={16} /> Need help</Button>{arrivalPassed && <Button variant="outline" onClick={extendJourneyArrival}>Extend 15 minutes</Button>}<Link to="/live-journey" className="button button--outline">View journey <ArrowRight size={15} /></Link></div>
            : <div className="alert-actions"><Link to="/journey" className="button button--hot">Plan a journey <ArrowRight size={15} /></Link></div>}
        <span className="small-note">Stored locally on this device · no remote guardian or contact notification configured</span>
      </Panel>
      <div className="alert-context">
        <Panel><SectionTitle title="Journey status" /><div className="last-location"><MapPin size={17} /><div><b>{demoMode ? 'GPS paused in Demo Mode' : hasRecentFix ? 'Recent GPS fix' : 'GPS unavailable or stale'}</b><small>{coordinates}</small></div></div><div className="alert-facts"><span><RouteIcon size={15} /> Journey <b>{journey.active ? 'Active on this device' : 'Not active'}</b></span><span><Users size={15} /> Trusted contacts <b>{contacts.length} saved locally · not notified</b></span></div><Link to="/live-journey" className="button button--outline button--full">Open live journey <ArrowRight size={15} /></Link></Panel>
        <Panel><SectionTitle title="More safety updates" /><Link to="/notifications" className="missed-link"><Bell size={15} /> Notifications <ArrowRight size={14} /></Link><Link to="/history" className="missed-link"><Clock3 size={15} /> Safety history <ArrowRight size={14} /></Link></Panel>
      </div>
    </div>
  </div>;
}

function NotificationCenter({ activity, notificationLog, seenActivityIds, markAllViewed }) {
  const entries = [
    ...activity.map((item) => ({ ...item, source: 'activity' })),
    ...notificationLog.map((item) => ({ ...item, source: 'emergency' })),
  ].sort((first, second) => new Date(second.time).getTime() - new Date(first.time).getTime());
  const unreadCount = activity.filter((item) => !seenActivityIds.includes(item.id)).length;
  return <div className="page-content">
    <PageHeader eyebrow="YOUR SAFETY UPDATES" title="Notifications" subtitle="A local record of events on this device. No push alerts or contact messages are implied." action={<Button variant="outline" onClick={markAllViewed} disabled={!unreadCount}>Mark as viewed</Button>} />
    <div className="notification-page-grid">
      <Panel className="notification-feed">
        <SectionTitle title="Recent activity" trailing={<span className="demo-badge">{unreadCount} UNVIEWED</span>} />
        {entries.length ? entries.map((entry, index) => {
          const time = new Date(entry.time);
          const validTime = Number.isFinite(time.getTime());
          const title = entry.message || entry.title || (entry.contact ? `Emergency update · ${entry.contact}` : 'Safety event');
          const detail = entry.source === 'emergency' ? entry.status || 'Emergency status recorded locally' : entry.kind || 'App activity';
          return <article className={`notification-item ${entry.source === 'activity' && !seenActivityIds.includes(entry.id) ? 'notification-item--unread' : ''}`} key={`${entry.id || entry.time}-${entry.source}-${index}`}>
            <span className="notification-item-icon">{entry.kind === 'emergency' || entry.source === 'emergency' ? <Siren size={17} /> : entry.kind === 'checkin' ? <CheckCircle2 size={17} /> : <Activity size={17} />}</span>
            <div><b>{title}</b><p>{detail}</p><time dateTime={validTime ? time.toISOString() : undefined}>{validTime ? time.toLocaleString() : 'Time unavailable'}</time></div>
            {entry.source === 'activity' && !seenActivityIds.includes(entry.id) && <span className="notification-unread-dot" aria-label="Unviewed" />}
          </article>;
        }) : <div className="empty-activity"><Bell size={22} /><b>No safety updates yet.</b><p>Journey starts, check-ins, and emergency events will appear here.</p></div>}
      </Panel>
      <div className="notification-aside">
        <Panel><SectionTitle title="Delivery status" /><p className="panel-subtitle">Prototype — service not connected. Items here are local records; background push alerts and trusted-contact delivery are not active.</p><Link to="/settings" className="button button--outline button--full">Review permissions <ArrowRight size={15} /></Link></Panel>
        <Link to="/history" className="missed-link"><Clock3 size={15} /> View safety history <ArrowRight size={14} /></Link>
      </div>
    </div>
  </div>;
}

function SafetyHistory({ activity }) {
  const [filter, setFilter] = useState('all');
  const filters = [
    ['all', 'All events'],
    ['journey', 'Journeys'],
    ['checkin', 'Check-ins'],
    ['emergency', 'Emergency'],
    ['location', 'Location'],
    ['battery', 'Battery'],
    ['evidence', 'Evidence'],
    ['community', 'Community'],
    ['safety', 'Other safety'],
  ];
  const filtered = filter === 'all' ? activity : activity.filter((item) => item.kind === filter);
  return <div className="page-content">
    <PageHeader eyebrow="YOUR DEVICE, YOUR RECORD" title="Safety history" subtitle="Review journey and safety events recorded locally by SAHARA AI." action={<Link to="/notifications" className="button button--outline"><Bell size={15} /> Notifications</Link>} />
    <Panel className="history-panel">
      <div className="history-filters" role="group" aria-label="Filter safety history">{filters.map(([key, label]) => <button type="button" key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
      {filtered.length ? <div className="history-list">{filtered.map((item) => {
        const time = new Date(item.time);
        return <article className="history-item" key={item.id}><span className={`history-icon history-icon--${item.kind || 'info'}`}>{item.kind === 'emergency' ? <Siren size={17} /> : item.kind === 'checkin' ? <CheckCircle2 size={17} /> : item.kind === 'journey' ? <RouteIcon size={17} /> : <Activity size={17} />}</span><div><b>{item.message}</b><small>{Number.isNaN(time.getTime()) ? 'Time unavailable' : time.toLocaleString()}</small></div><span className="demo-badge">LOCAL</span></article>;
      })}</div> : <div className="empty-activity"><Clock3 size={22} /><b>{activity.length ? 'No events in this category.' : 'No safety history yet.'}</b><p>Events are saved on this device as you use the app.</p></div>}
      <p className="small-note">History is device-local and may be removed when browser site data is cleared. It is not a verified incident report or remote monitoring record.</p>
    </Panel>
  </div>;
}

function PrivacyCenter({ profile, contacts, journey, reports, evidence, activity, notificationLog, lastKnownLocation, shareLocation, setShareLocation, onClearData, notify }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);
  const [microphoneStatus, setMicrophoneStatus] = useState('Not requested');
  const [cameraStatus, setCameraStatus] = useState('Not requested');
  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unavailable');
      notify('Browser notifications are not supported here.', 'alert');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      notify(`Browser notification permission: ${permission}.`, permission === 'granted' ? 'success' : 'info');
    } catch (error) {
      notify(`Notification permission could not be requested${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const requestMediaPermission = async (kind) => {
    const setStatus = kind === 'audio' ? setMicrophoneStatus : setCameraStatus;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('Unavailable in this browser');
      notify(`${kind === 'audio' ? 'Microphone' : 'Camera'} access is not supported by this browser.`, 'alert');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'audio' ? { audio: true } : { video: true });
      stream.getTracks().forEach((track) => track.stop());
      setStatus('Permission granted · stream stopped');
      notify(`${kind === 'audio' ? 'Microphone' : 'Camera'} permission checked. No recording was made.`, 'info');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Permission denied or unavailable');
      notify(`${kind === 'audio' ? 'Microphone' : 'Camera'} access was not granted${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const exportData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      notice: 'This file contains local SAHARA AI data. Store and share it carefully.',
      profile,
      contacts,
      journey,
      communityReports: reports,
      evidence,
      activity,
      emergencyLog: notificationLog,
      lastKnownLocation,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sahara-local-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="page-content">
    <PageHeader eyebrow="YOUR DATA, YOUR CONTROL" title="Privacy center" subtitle="Review what this browser stores, export a copy, or clear local SAHARA data." />
    <div className="privacy-center-grid">
      <div className="privacy-center-main">
        <Panel className="privacy-data-panel"><SectionTitle title="Stored on this device" /><p className="panel-subtitle">Profile details, contacts, journeys, reports, and event metadata are saved in local browser storage. Evidence attachment files are stored separately in IndexedDB. No account sync is configured.</p>
          <div className="privacy-data-list"><div><span>Profile</span><b>{profile.name ? 'Set up' : 'Not set up'}</b></div><div><span>Trusted contacts</span><b>{contacts.length}</b></div><div><span>Journey</span><b>{journey.active ? 'Active locally' : 'No active journey'}</b></div><div><span>Community reports</span><b>{reports.length}</b></div><div><span>Evidence records</span><b>{evidence.length}</b></div><div><span>Safety activity</span><b>{activity.length + notificationLog.length}</b></div><div><span>Last GPS fix</span><b>{lastKnownLocation ? new Date(lastKnownLocation.timestamp).toLocaleString() : 'Not recorded'}</b></div></div>
        </Panel>
        <Panel className="privacy-actions-panel"><SectionTitle title="Your data actions" /><div className="privacy-action-row"><span><b>Export local data</b><small>Downloads profile, notes, contacts, journey, and event metadata as JSON. Attached media files are not included.</small></span><Button variant="outline" onClick={exportData}><FileText size={15} /> Download</Button></div><div className="privacy-action-row privacy-action-row--danger"><span><b>Clear local data</b><small>Removes SAHARA profile, contacts, reports, evidence, and event history from this browser.</small></span><Button variant="hot" onClick={() => setConfirmClear(true)}><X size={15} /> Clear data</Button></div></Panel>
      </div>
      <div className="privacy-center-aside"><Panel><div className="privacy-icon"><LockKeyhole size={19} /></div><h3>Sharing requires your action</h3><p>GPS access is requested from this device. Location links are shared only when you explicitly choose a share action. Backend alerts, cloud sync, and guardian-device access are not configured.</p><SafetyInsight>Browser storage is not encrypted by this prototype. Avoid storing sensitive evidence on a shared or untrusted device.</SafetyInsight></Panel><Panel><SectionTitle title="Permissions & sharing" /><label className="settings-row"><span className="settings-copy"><b>Allow manual location-link sharing</b><small>{shareLocation ? 'Enabled; location links still require your explicit action.' : 'Disabled; location-link actions are blocked.'}</small></span><input type="checkbox" checked={shareLocation} onChange={(event) => setShareLocation(event.target.checked)} /><span className="switch" /></label><div className="permission-row"><span className="settings-icon"><Bell size={17} /></span><span><b>Notifications</b><small>Permission: {notificationPermission}</small></span><Button variant="outline" onClick={requestNotificationPermission} disabled={notificationPermission === 'granted'}>{notificationPermission === 'granted' ? 'Enabled' : 'Request'}</Button></div><div className="permission-row"><span className="settings-icon"><Mic size={17} /></span><span><b>Microphone</b><small>{microphoneStatus}</small></span><Button variant="outline" onClick={() => { void requestMediaPermission('audio'); }}>Check access</Button></div><div className="permission-row"><span className="settings-icon"><Smartphone size={17} /></span><span><b>Camera</b><small>{cameraStatus}</small></span><Button variant="outline" onClick={() => { void requestMediaPermission('video'); }}>Check access</Button></div><Link to="/settings" className="button button--outline button--full">Review settings <Settings size={15} /></Link></Panel></div>
    </div>
    {confirmClear && <Modal title="Clear SAHARA data from this browser?" onClose={() => setConfirmClear(false)}><p className="modal-copy">This removes your saved profile, contacts, reports, evidence, and local event history. This action cannot be undone. It does not change browser permission settings.</p><div className="modal-actions"><Button variant="outline" onClick={() => setConfirmClear(false)}>Keep my data</Button><Button variant="hot" onClick={() => { onClearData(); setConfirmClear(false); }}>Clear local data</Button></div></Modal>}
  </div>;
}

function VoicePage({ journey, notify, location, liveLocation, contacts, demoMode, profile, requestLocation, recordCheckIn, emergency, resolveEmergency, beginEmergencySequence, alertSoundOn, startAlertSound, stopAlertSound }) {
  const navigate = useNavigate();
  const recognitionRef = useRef(null);
  const [command, setCommand] = useState('');
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [conversation, setConversation] = useState([{ who: 'assistant', text: `Hi ${profile.name.trim().split(/\s+/)[0] || 'there'}. I’m your on-device safety assistant. What do you need?` }]);
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = Boolean(SpeechRecognition);
  const hasCurrentLocation = demoMode ? Boolean(location) : hasRecentLiveFix(location, liveLocation);
  const speak = (text) => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    window.speechSynthesis.speak(utterance);
  };
  const parseCommand = (text, fromVoice = false) => {
    const lower = text.toLowerCase().replace(/[’‘]/g, "'");
    let reply = 'I can help plan a journey, check your GPS, find nearby help, or open safety settings.';
    let destination;
    if (lower.includes('where am i') || lower.includes('current location')) {
      reply = !hasCurrentLocation
        ? `I can’t read a recent location fix. ${demoMode ? 'Demo Mode is selected; switch to Live Mode and allow GPS access.' : liveLocation.error || 'Allow GPS access and wait for a fresh fix.'}`
        : `Current device location: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}. Accuracy is approximately ${Math.round(location.accuracy)} meters.`;
    } else if (lower.includes('i am safe') || lower.includes("i'm safe") || lower.includes('im safe')) {
      if (journey.active) {
        recordCheckIn();
        reply = 'Your journey check-in was recorded on this device.';
      } else if (emergency) {
        resolveEmergency();
        reply = 'The local emergency state was cleared. No outside service status changed.';
      } else {
        destination = '/journey-alert';
        reply = 'There is no active journey or emergency to clear. Opening check-in status.';
      }
    } else if (lower.includes('need help') || lower.includes('emergency') || lower.includes('sos')) {
      beginEmergencySequence();
      destination = '/sos';
      reply = 'Emergency countdown started on this device. Cancel it on the SOS screen if this was accidental. No call or contact message is confirmed.';
    } else if (lower.includes('start safety beep') || lower.includes('start alarm')) {
      startAlertSound();
      reply = 'The local audio alarm was requested. Use the stop command or SOS controls to silence it.';
    } else if (lower.includes('stop safety beep') || lower.includes('stop alarm')) {
      stopAlertSound();
      reply = 'The local audio alarm was stopped.';
    } else if (lower.includes('plan') && lower.includes('journey')) {
      destination = '/journey';
      reply = 'Opening journey planning. Choose a destination, expected arrival, and check-in interval before starting.';
    } else if ((lower.includes('nearby') || lower.includes('show')) && lower.includes('police')) {
      destination = '/nearby-help?category=Police';
      reply = `Opening nearby police listings. ${demoMode ? 'Demo Mode pauses GPS and shows no sample listings.' : hasCurrentLocation ? 'Public OpenStreetMap results are requested around your recent GPS fix.' : 'Allow GPS access to search nearby.'}`;
    } else if ((lower.includes('nearby') || lower.includes('show')) && lower.includes('hospital')) {
      destination = '/nearby-help?category=Hospital';
      reply = `Opening nearby hospital listings. ${demoMode ? 'Demo Mode pauses GPS and shows no sample listings.' : hasCurrentLocation ? 'Public map results will be requested around your recent GPS fix.' : 'Allow GPS access to search nearby.'}`;
    } else if (lower.includes('start') && (lower.includes('tracking') || lower.includes('live'))) {
      requestLocation();
      destination = journey.active ? '/live-journey' : '/journey';
      reply = journey.active
        ? 'Requesting a fresh GPS fix for your active local journey.'
        : 'Requesting GPS access and opening the journey planner. Tracking does not start until you submit a journey.';
    } else if (lower.includes('trusted contact') || lower.includes('my contacts') || lower.includes('who are')) {
      reply = contacts.length ? `Your trusted circle has ${contacts.length} saved contact${contacts.length === 1 ? '' : 's'}: ${contacts.map((contact) => `${contact.name} (${contact.relation})`).join(', ')}. They are stored on this device and have not been notified.` : 'You have no trusted contacts saved yet. Add someone in your Profile.';
      if (!contacts.length) destination = '/profile';
    } else if (lower.includes('unsafe') || lower.includes('feel unsafe')) {
      reply = 'Move toward a public place if you can, contact someone you trust, and call your local emergency number if there is immediate danger. I can open the SOS countdown if you ask for help.';
    } else if (lower.includes('share') && lower.includes('location')) {
      destination = '/live-journey';
      reply = 'Opening your live journey. Review the current GPS fix and choose Share there to use your device share sheet. Nothing is sent automatically.';
    } else if (lower.includes('start') && lower.includes('journey')) {
      destination = '/journey';
      reply = 'Opening journey planning so you can confirm a destination before monitoring begins.';
    } else if (lower.includes('cancel') && lower.includes('journey')) {
      if (journey.active) { destination = '/live-journey'; reply = 'Open Live Journey to review and end the active trip.'; }
      else reply = 'There is no active journey to end.';
    } else if (lower.includes('nearby')) {
      destination = '/nearby-help';
      reply = `Opening Nearby Help. ${demoMode ? 'Demo Mode pauses GPS and shows no sample listings.' : hasCurrentLocation ? 'The page will search public map listings around a recent GPS fix.' : 'Allow location access to find nearby services.'}`;
    } else if (lower.includes('battery')) {
      destination = '/battery';
      reply = 'Opening Battery Guardian. The page shows a device percentage only if your browser exposes one.';
    }
    setConversation((items) => [...items, { who: 'user', text }, { who: 'assistant', text: reply }]);
    setTranscript(text);
    setCommand('');
    if (fromVoice) speak(reply);
    if (destination) {
      if (lower.includes('need help') || lower.includes('emergency') || lower.includes('sos')) notify(reply, 'alert');
      else notify(reply, 'info');
      navigate(destination);
    }
  };
  const startListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    if (!SpeechRecognition) {
      setTranscript('Voice recognition is not supported in this browser. You can type a command below.');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = 'en-IN';
      recognition.interimResults = false;
      recognition.onresult = (event) => parseCommand(event.results[0][0].transcript, true);
      recognition.onerror = (event) => {
        setListening(false);
        setTranscript(`Voice recognition failed${event.error ? `: ${event.error}` : '.'} Type a command instead.`);
      };
      recognition.onend = () => setListening(false);
      recognition.start();
      setListening(true);
      setTranscript('Listening…');
    } catch (error) {
      setListening(false);
      setTranscript(`Voice recognition could not start${error instanceof Error ? `: ${error.message}` : '.'}`);
    }
  };
  useEffect(() => () => {
    recognitionRef.current?.stop();
    window.speechSynthesis?.cancel();
  }, []);
  const suggestions = ['Start my journey', 'Share my location', 'I need help', 'Start safety beep', 'Stop safety beep', 'I’m safe', 'Find nearby help'];
  return <div className="page-content">
    <PageHeader eyebrow="SAHARA AI ASSISTANT" title="I’m right here." subtitle="Use voice or text to navigate local safety features. Spoken emergency requests begin a cancellation countdown on this device." />
    <div className="voice-layout">
      <Panel className="voice-panel">
        <div className="assistant-intro"><div className="assistant-avatar"><Sparkles size={25} /></div><div><span className="eyebrow">SAHARA AI ASSISTANT</span><h2>On-device assistance</h2><StatusTag tone={speechSupported ? 'safe' : 'warning'}>{speechSupported ? listening ? 'LISTENING' : 'VOICE READY' : 'VOICE INPUT UNAVAILABLE'}</StatusTag></div></div>
        <div className="chat-window" aria-live="polite">{conversation.map((item, index) => <div className={`chat-bubble chat-bubble--${item.who}`} key={`${index}-${item.text}`}>{item.who === 'assistant' && <div className="avatar avatar--tiny"><Shield size={13} /></div>}<p>{item.text}</p></div>)}</div>
        <form className="voice-input" onSubmit={(event) => { event.preventDefault(); if (command.trim()) parseCommand(command.trim()); }}><input aria-label="Type a safety command" placeholder="Try: Start my journey" value={command} onChange={(event) => setCommand(event.target.value)} /><button aria-label="Send command" type="submit"><ArrowRight size={17} /></button></form>
        <div className="voice-controls"><button type="button" className={`mic-button ${listening ? 'is-listening' : ''}`} onClick={startListening} aria-label={listening ? 'Stop voice input' : 'Start voice input'}><Mic size={23} /></button><span>{listening ? 'Listening…' : speechSupported ? 'Tap to speak' : 'Voice unavailable · type instead'}</span><span className="demo-badge">{speechSupported ? 'BROWSER SPEECH' : 'TEXT INPUT'}</span></div>
        {transcript && <div className="transcript"><Volume2 size={15} /> {transcript}</div>}
      </Panel>
      <div className="voice-side"><Panel className="commands-panel"><SectionTitle title="Try a command" />{suggestions.map((sample) => <button type="button" key={sample} onClick={() => parseCommand(sample)}><span><Mic size={14} /></span>{sample}<ArrowRight size={14} /></button>)}</Panel><SafetyInsight>Speech recognition and speech output depend on browser support and permission. Commands do not send messages or share location automatically.</SafetyInsight></div>
    </div>
  </div>;
}

function EvidencePage({ evidence, addEvidence, setEvidence }) {
  const [filter, setFilter] = useState('All');
  const fileInput = useMemo(() => ['All', 'Photos', 'Audio', 'Videos', 'Notes'], []);
  const filtered = evidence.filter((item) => filter === 'All' || item.type.toLowerCase().includes(filter.slice(0, -1).toLowerCase()) || (filter === 'Photos' && item.type.startsWith('image')) || (filter === 'Audio' && item.type.startsWith('audio')) || (filter === 'Videos' && item.type.startsWith('video')));
  const iconFor = (type) => type.startsWith('image') ? FileImage : type.startsWith('audio') ? FileAudio2 : type.startsWith('video') ? FileVideo2 : FileText;
  return <div className="page-content"><PageHeader eyebrow="PRIVATE BY DESIGN" title="Evidence vault" subtitle="A private place for the details you may want to keep." action={<label className="button button--hot upload-button"><Plus size={16} /> Add evidence<input type="file" multiple accept="image/*,audio/*,video/*,.txt,.pdf" onChange={(e) => { addEvidence(Array.from(e.target.files || [])); e.target.value = ''; }} /></label>} /><div className="evidence-layout"><Panel className="evidence-panel"><div className="filter-tabs">{fileInput.map((item) => <button className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}<span>{filtered.length} items</span></div>{filtered.length ? <div className="evidence-list">{filtered.map((item) => { const Icon = iconFor(item.type); return <div className="evidence-item" key={item.id}><div className="evidence-file-icon"><Icon size={19} /></div><div className="evidence-item-info"><b>{item.name}</b><span>{item.time} · {item.location}</span><small><LockKeyhole size={12} /> {item.status}</small></div><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => setEvidence((current) => current.filter((entry) => entry.id !== item.id))}><X size={16} /></button></div>; })}</div> : <div className="empty-state"><div><LockKeyhole size={23} /></div><h3>Your vault is yours.</h3><p>Add a photo, audio clip, video, or note. Items stay in this demo on your device.</p><label className="button button--outline upload-button"><Plus size={15} /> Add first item<input type="file" multiple onChange={(e) => { addEvidence(Array.from(e.target.files || [])); e.target.value = ''; }} /></label></div>}</Panel><div className="evidence-aside"><Panel className="vault-note"><span className="vault-lock"><LockKeyhole size={20} /></span><span className="eyebrow">YOUR PRIVATE VAULT</span><h3>Your evidence belongs to you.</h3><p>This demo stores item details in your browser. Uploaded file contents are not sent to a server.</p><StatusTag>LOCAL DEMO STORAGE</StatusTag></Panel><SafetyInsight>Keep only what feels useful. You are always in control of what you save and share.</SafetyInsight></div></div></div>;
}

function EvidenceVault({ evidence, addEvidence, addEvidenceNote, deleteEvidence, downloadEvidence, notify }) {
  const filters = ['All', 'Photos', 'Audio', 'Videos', 'Notes'];
  const [filter, setFilter] = useState('All');
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const discardRecordingRef = useRef(false);
  const isNote = (item) => item.type === 'note';
  const filtered = evidence.filter((item) => {
    if (filter === 'All') return true;
    if (filter === 'Notes') return isNote(item);
    if (filter === 'Photos') return item.type.startsWith('image/');
    if (filter === 'Audio') return item.type.startsWith('audio/');
    return item.type.startsWith('video/');
  });
  const saveNote = (event) => {
    event.preventDefault();
    if (!noteText.trim()) return;
    addEvidenceNote(noteTitle.trim() || 'Safety note', noteText);
    setNoteTitle('');
    setNoteText('');
    setShowNoteForm(false);
  };
  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notify('Audio recording is not supported by this browser.', 'alert');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      discardRecordingRef.current = false;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        if (!discardRecordingRef.current) {
          const audioFile = new File(
            [new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })],
            `SAHARA-audio-${Date.now()}.webm`,
            { type: recorder.mimeType || 'audio/webm' },
          );
          void addEvidence([audioFile]);
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
      }, { once: true });
      recorder.start();
      setRecording(true);
    } catch (error) {
      notify(`Audio recording could not start${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  };
  useEffect(() => () => {
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);
  const iconFor = (item) => item.type.startsWith('image/') ? FileImage
    : item.type.startsWith('audio/') ? FileAudio2
      : item.type.startsWith('video/') ? FileVideo2 : FileText;
  return <div className="page-content">
    <PageHeader eyebrow="PRIVATE BY DESIGN" title="Evidence vault" subtitle="Add media or notes only when you choose. Files are stored in this browser and are not uploaded." action={<div className="evidence-actions">
      <label className="button button--hot upload-button"><Plus size={16} /> Add media<input type="file" multiple accept="image/*,audio/*,video/*,.txt,.pdf" onChange={(event) => { void addEvidence(Array.from(event.target.files || [])); event.target.value = ''; }} /></label>
      <label className="button button--outline upload-button"><CameraIcon /> Capture photo<input type="file" accept="image/*" capture="environment" onChange={(event) => { void addEvidence(Array.from(event.target.files || [])); event.target.value = ''; }} /></label>
      <Button variant={recording ? 'dark-outline' : 'outline'} onClick={recording ? stopRecording : startRecording}><Mic size={15} /> {recording ? 'Stop recording' : 'Record audio'}</Button>
      <Button variant="outline" onClick={() => setShowNoteForm((shown) => !shown)}><FileText size={15} /> Add note</Button>
    </div>} />
    {recording && <div className="inline-callout" role="status"><span className="recording-indicator" /> Recording audio on this device. Select “Stop recording” to save it locally.</div>}
    {showNoteForm && <Panel className="evidence-note-form-panel"><form className="evidence-note-form" onSubmit={saveNote}><label className="field-label">NOTE TITLE<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Optional title" maxLength={120} /></label><label className="field-label">NOTE<textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Write a factual note to keep for yourself" rows={4} required maxLength={5000} /></label><div className="modal-actions"><Button variant="outline" type="button" onClick={() => setShowNoteForm(false)}>Cancel</Button><Button variant="hot" type="submit">Save note <Check size={15} /></Button></div></form></Panel>}
    <div className="evidence-layout">
      <Panel className="evidence-panel">
        <div className="filter-tabs">{filters.map((item) => <button type="button" className={filter === item ? 'active' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)} key={item}>{item}</button>)}<span>{filtered.length} items</span></div>
        {filtered.length ? <div className="evidence-list">{filtered.map((item) => {
          const Icon = iconFor(item);
          return <article className="evidence-item" key={item.id}>
            <div className="evidence-file-icon"><Icon size={19} /></div>
            <div className="evidence-item-info"><b>{item.name}</b><span>{new Date(item.time).toLocaleString()} · {item.location || 'Location unavailable'}</span>{item.note && <p>{item.note}</p>}<small><LockKeyhole size={12} /> {item.status} · {item.size ? `${Math.ceil(item.size / 1024)} KB` : 'No file attachment'}</small></div>
            {item.hasStoredFile && <button type="button" className="icon-button" aria-label={`Download ${item.name}`} title="Download saved file" onClick={() => downloadEvidence(item)}><ArrowDownLeft size={15} /></button>}
            <button type="button" className="icon-button" aria-label={`Delete ${item.name}`} title="Delete from this device" onClick={() => { void deleteEvidence(item); }}><X size={16} /></button>
          </article>;
        })}</div> : <div className="empty-state"><div><LockKeyhole size={23} /></div><h3>Your vault is yours.</h3><p>Upload or capture media, record audio with permission, or add a written note. Nothing is recorded or uploaded without your action.</p></div>}
      </Panel>
      <div className="evidence-aside"><Panel className="vault-note"><span className="vault-lock"><LockKeyhole size={20} /></span><span className="eyebrow">YOUR LOCAL VAULT</span><h3>Your evidence belongs to you.</h3><p>Attachments are stored in this browser’s IndexedDB; notes and item details are stored locally. This storage is not encrypted. Files can disappear if browser data is cleared.</p><StatusTag>NOT UPLOADED</StatusTag></Panel><SafetyInsight>Location is attached to new items only when a real GPS fix is available in Live Mode.</SafetyInsight></div>
    </div>
  </div>;
}

function CameraIcon() {
  return <FileImage size={15} />;
}

function NearbyHelp({ notify, location, liveLocation, demoMode, requestLocation }) {
  const [searchParams] = useSearchParams();
  const [gpsClock, setGpsClock] = useState(Date.now());
  const [refreshCount, setRefreshCount] = useState(0);
  const [category, setCategory] = useState(searchParams.get('category') || 'All');
  const [places, setPlaces] = useState([]);
  const [source, setSource] = useState(demoMode ? 'demo-paused' : location ? 'loading' : 'waiting');
  const hasRecentFix = hasRecentLiveFix(location, liveLocation, 120000, gpsClock);
  const usableLocation = hasRecentFix ? [location.latitude, location.longitude] : null;
  const regionKey = usableLocation ? `${Math.round(usableLocation[0] * 200) / 200},${Math.round(usableLocation[1] * 200) / 200}` : 'none';
  const locationStatusKey = usableLocation ? 'has-location' : liveLocation.status;
  const lastQueryRef = useRef(null);
  useEffect(() => {
    const timer = window.setInterval(() => setGpsClock(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (demoMode) { setPlaces([]); setSource('demo-paused'); return undefined; }
    if (!usableLocation) { setPlaces([]); setSource(liveLocation.status === 'denied' ? 'denied' : 'waiting'); return undefined; }
    const previous = lastQueryRef.current;
    if (previous && Date.now() - previous.time < 60000 && distanceMeters(previous.location, usableLocation) < 500) return undefined;
    let active = true;
    setPlaces([]);
    setSource('loading');
    fetchNearbyOpenData(usableLocation).then((results) => {
      if (!active) return;
      lastQueryRef.current = { location: usableLocation, time: Date.now() };
      setPlaces(results);
      setSource('live');
    }).catch(() => {
      if (!active) return;
      lastQueryRef.current = { location: usableLocation, time: Date.now() };
      setPlaces([]);
      setSource('unavailable');
    });
    return () => { active = false; };
  }, [demoMode, regionKey, locationStatusKey, refreshCount]);
  const shown = category === 'All' ? places : places.filter((place) => place.type === category);
  const sourceLabel = source === 'live' ? 'LIVE NEARBY DATA · OpenStreetMap'
    : source === 'loading' ? 'Searching OpenStreetMap…'
      : source === 'waiting' ? 'Enable location to find nearby help'
        : source === 'denied' ? 'Location permission denied'
          : source === 'demo-paused' ? 'Demo Mode · no sample coordinates or results'
            : 'Nearby map data unavailable';
  const statusLabel = source === 'live' ? 'LIVE RESULTS'
    : source === 'loading' ? 'SEARCHING'
      : source === 'demo-paused' ? 'GPS PAUSED'
        : 'LOCATION NEEDED';
  return (
    <div className="page-content">
      <PageHeader eyebrow="SUPPORT NEAR YOU" title="Nearby help" subtitle="Nearby results use a recent live GPS fix when available. Public map listings may be incomplete or outdated." action={<span className={`mode-chip ${source === 'live' ? 'is-live' : 'is-demo'}`}><span />{statusLabel}</span>} />
      <div className="nearby-layout">
        <Panel className="nearby-map-panel">
          <MapView places={shown} location={demoMode ? null : usableLocation} demoMode={demoMode} route={false} />
          <div className="map-legend"><span><i className="legend-pin" />{source === 'live' ? 'OpenStreetMap result' : 'No live results'}</span><span>{sourceLabel}</span></div>
        </Panel>
        <Panel className="places-panel">
          <div className="places-head"><SectionTitle title="Places close by" /><button className="icon-button" aria-label="Refresh locations" onClick={() => { if (!demoMode) { lastQueryRef.current = null; setRefreshCount((count) => count + 1); requestLocation(); } else notify('Switch to Live Mode to request real nearby results.', 'info'); }}><Crosshair size={17} /></button></div>
          <div className="category-pills">{['All', 'Police', 'Hospital', 'Pharmacy', 'Safe Zone', 'Transport'].map((item) => <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
          {!usableLocation && <div className="nearby-permission"><p>{demoMode ? 'Demo Mode pauses GPS and does not use sample locations.' : source === 'denied' ? liveLocation.error : 'A recent live location is needed to search nearby services.'}</p><Button variant="outline" onClick={requestLocation}>{demoMode ? 'Switch to Live GPS' : 'Allow location access'} <MapPin size={15} /></Button></div>}
          <div className="place-list">{shown.map((place, index) => <div className="place-item" key={`${place.name}-${index}`}><div className={`place-icon place-icon--${index % 5}`}><PlaceIcon type={place.type} /></div><div className="place-info"><b>{place.name}</b><span>{place.distance} · {place.open}</span><small>{place.type}{place.source ? ` · ${place.source}` : ''}</small></div><div className="place-actions"><a href={`https://www.openstreetmap.org/directions?to=${place.point.join('%2C')}`} target="_blank" rel="noreferrer" aria-label={`Directions to ${place.name}`}><Navigation size={15} /></a>{place.phone && <a href={`tel:${place.phone}`} aria-label={`Call ${place.name}`}><Phone size={15} /></a>}</div></div>)}</div>
          {source === 'loading' && <p className="small-note">Searching nearby public map data. This can take a few seconds.</p>}
          {source === 'unavailable' && <p className="small-note">Could not retrieve live public map data. Try again when connected or allow location access.</p>}
          {source === 'demo-paused' && <p className="small-note">No demonstration businesses or coordinates are shown. Switch to Live Mode to request real nearby results.</p>}
          {source === 'live' && <p className="small-note">OpenStreetMap data can be incomplete. Hours and phone numbers are shown only when the listing provides them.</p>}
          {source === 'live' && !shown.length && <p className="small-note">No matching listings were returned within approximately 6 km.</p>}
        </Panel>
      </div>
    </div>
  );
}
function PlaceIcon({ type }) { if (type === 'Police') return <Shield size={17} />; if (type === 'Hospital') return <Heart size={17} />; if (type === 'Pharmacy') return <Plus size={17} />; if (type === 'Safe Zone') return <CheckCircle2 size={17} />; return <Navigation size={17} />; }

function CommunityMap({ reports, addReport, location, liveLocation, demoMode, notify }) {
  const [filter, setFilter] = useState('All');
  const [reportType, setReportType] = useState('Poor lighting');
  const [note, setNote] = useState('');
  const [showForm, setShowForm] = useState(false);
  const filtered = reports.filter((report) => filter === 'All' || report.type === filter);
  const mapReports = filtered.filter((report) => Number.isFinite(report.point?.[0]) && Number.isFinite(report.point?.[1]));
  const hasRecentFix = hasRecentLiveFix(location, liveLocation);
  const submit = (event) => {
    event.preventDefault();
    if (demoMode || !hasRecentFix) {
      notify('A recent real GPS fix in Live Mode is required to place a community report.', 'alert');
      return;
    }
    addReport({ type: reportType, note: note.trim() || 'Community safety report', point: [location.latitude, location.longitude] });
    setNote('');
    setShowForm(false);
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="LOOK OUT FOR EACH OTHER"
        title="Community safety map"
        subtitle="Reports are unverified and stored on this device. Prototype — service not connected; there is no shared community feed."
        action={<Button variant="hot" onClick={() => setShowForm(true)}><Plus size={16} /> Submit a report</Button>}
      />
      <div className="community-layout">
        <Panel className="community-map-panel">
          <div className="community-filters">
            {['All', 'Unsafe Area', 'Poor lighting', 'Harassment', 'Suspicious activity', 'Safe area'].map((item) => (
              <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
            ))}
          </div>
          <MapView reports={mapReports} location={demoMode ? location : hasRecentFix ? location : null} demoMode={demoMode} route={false} />
          <div className="map-legend"><span><i className="legend-dot legend-dot--report" /> Unverified community report</span></div>
        </Panel>
        <div className="community-side">
          <Panel className="report-list-panel">
            <SectionTitle title="Recent community notes" trailing={<span className="demo-badge">UNVERIFIED</span>} />
            {reports.length
              ? reports.slice(0, 5).map((report) => (
                <div className="report-item" key={report.id}>
                  <span className="report-icon"><AlertTriangle size={16} /></span>
                  <div><b>{report.type}</b><small>{report.note}</small><span>{report.time}</span></div>
                </div>
              ))
              : <div className="empty-reports"><div className="report-illustration"><MapPin size={22} /></div><b>No community reports saved.</b><p>Reports from other users are unavailable. Prototype — service not connected.</p></div>}
          </Panel>
          <SafetyInsight>Community reports are user-submitted and unverified. They are not emergency alerts or confirmed safety information.</SafetyInsight>
        </div>
      </div>
      {showForm && (
        <Modal title="Share a community note" onClose={() => setShowForm(false)}>
          <form className="report-form" onSubmit={submit}>
            <label className="field-label">REPORT TYPE<select value={reportType} onChange={(e) => setReportType(e.target.value)}>{['Unsafe Area', 'Poor lighting', 'Harassment', 'Suspicious activity', 'Safe area'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field-label">WHAT WOULD YOU LIKE OTHERS TO KNOW?<textarea rows="4" maxLength="240" placeholder="Keep it factual. Please don't include personal details." value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <p className="privacy-caption"><LockKeyhole size={14} /> {demoMode || !location ? 'Switch to Live Mode and allow GPS to attach a real report location.' : 'Your name and contact details are not included in the local report.'}</p>
            <div className="modal-actions">
              <Button variant="outline" type="button" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="hot" type="submit">Save report <ArrowRight size={15} /></Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BatteryCard({ batteryPct, compact = false }) {
  return <Panel className={`battery-card ${compact ? 'battery-card--compact' : ''}`}><div className="battery-icon"><BatteryCharging size={20} /></div><div className="battery-copy"><span className="eyebrow">BATTERY GUARDIAN</span><b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`} <small>{batteryPct == null ? 'on this browser' : 'remaining'}</small></b>{batteryPct != null && <span className="battery-track"><i style={{ width: `${batteryPct}%` }} /></span>}<small>{batteryPct == null ? 'Battery status unavailable' : batteryPct <= 20 ? 'Your phone may not last until your expected arrival.' : 'Device battery status'}</small></div><Link to="/battery" className="round-link" aria-label="Battery guardian"><ArrowRight size={15} /></Link></Panel>;
}
function BatteryPage({ batteryPct, batteryTimeRemaining, batteryStatus, batteryError, location, lastKnownLocation, liveLocation, demoMode, shareLocation, notify }) {
  const remainingHours = batteryTimeRemaining == null ? null : Number((batteryTimeRemaining / 3600).toFixed(1));
  const batteryTier = batteryPct == null ? null : batteryPct <= 10 ? 'CRITICAL' : batteryPct <= 15 ? 'URGENT' : batteryPct <= 20 ? 'LOW' : 'OK';
  const lastFix = !demoMode ? location || lastKnownLocation : null;
  const shareLastLocation = async () => {
    if (!shareLocation) {
      notify('Enable manual location-link sharing in Settings before creating a location link.', 'alert');
      return;
    }
    const isFreshGps = location
      && !demoMode
      && ['connected', 'weak'].includes(liveLocation.status)
      && Date.now() - location.timestamp < 60000;
    if (!isFreshGps) {
      notify('A recent live GPS fix is required. No location was shared.', 'alert');
      return;
    }
    const mapUrl = `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My last known location', text: 'My current location shared from SAHARA AI.', url: mapUrl });
        notify('Location link handed to your device share sheet. Confirm delivery in the app you chose.', 'info');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mapUrl);
        notify('Location link copied. Choose who to send it to.', 'info');
      } else {
        notify('Location sharing is unavailable in this browser. No link was sent.', 'alert');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      notify(`Could not prepare a location link${error instanceof Error ? `: ${error.message}` : '.'}`, 'alert');
    }
  };
  const statusLabel = batteryStatus === 'unsupported' ? 'API UNSUPPORTED'
    : batteryStatus === 'unavailable' ? 'BATTERY UNAVAILABLE'
      : batteryPct == null ? 'CHECKING DEVICE' : 'DEVICE BATTERY';
  return <div className="page-content">
    <PageHeader eyebrow="A LITTLE EXTRA PEACE OF MIND" title="Battery guardian" subtitle="Battery values come from this device only when its browser exposes them. No sample percentage is shown." action={<span className={`mode-chip ${batteryPct == null ? 'is-demo' : 'is-live'}`}><span />{statusLabel}</span>} />
    <div className="battery-page-grid">
      <Panel className="battery-hero-card">
        <div className="battery-big-icon"><Battery size={46} />{batteryPct != null && <span style={{ width: `${batteryPct}%` }} />}</div>
        <span className="eyebrow">CURRENT DEVICE BATTERY</span>
        <strong className="battery-big-number">{batteryPct == null ? '—' : batteryPct}<small>{batteryPct == null ? '' : '%'}</small></strong>
        <StatusTag tone={batteryPct == null || batteryPct <= 20 ? 'warning' : 'safe'}>{batteryTier || 'NOT AVAILABLE'}</StatusTag>
        <p>{batteryPct == null ? batteryError || (batteryStatus === 'unsupported' ? 'Battery Status API is not supported by this browser.' : 'Waiting for device battery information.') : batteryPct <= 10 ? 'Critical: your phone may not remain connected until arrival.' : batteryPct <= 15 ? 'Urgent: consider conserving power and checking in.' : batteryPct <= 20 ? 'Low battery: consider conserving power and checking in.' : 'Battery status is in a comfortable range for now.'}</p>
        <div className="battery-estimate"><div><span>ESTIMATED DISCHARGE TIME</span><b>{remainingHours == null ? 'Unavailable' : `~${remainingHours} hours`}</b></div><div><span>LAST KNOWN GPS FIX</span><b>{lastFix ? new Date(lastFix.timestamp).toLocaleTimeString() : 'Unavailable'}</b></div></div>
        <Button variant="hot" onClick={shareLastLocation}><MapPin size={16} /> Share recent live location</Button>
        <small className="small-note">{shareLocation ? 'Location is never shared automatically. This action uses your device share sheet or clipboard.' : 'Enable manual location-link sharing in Settings before creating a link.'}</small>
      </Panel>
      <div className="battery-settings">
        <Panel><SectionTitle title="Battery alerts" /><div className="battery-alert-thresholds">{[[20, 'Low'], [15, 'Urgent'], [10, 'Critical']].map(([value, label]) => <div key={value}><span>{label}</span><b>{value}%</b></div>)}</div><p className="panel-subtitle">When supported, threshold reminders are generated from actual battery readings while SAHARA AI is open. Browser notifications appear only if you have granted notification permission.</p></Panel>
        <SafetyInsight>{batteryPct == null ? 'Battery alerts are unavailable until the browser exposes a real device battery reading.' : `Current device reading: ${batteryPct}%. Values update only when the browser reports a change.`}</SafetyInsight>
      </div>
    </div>
  </div>;
}

function Smartwatch({ journey, batteryPct, recordCheckIn, notify }) {
  const [selected, setSelected] = useState('SOS');
  const [now, setNow] = useState(Date.now());
  const navigate = useNavigate();
  const screens = ['SOS', 'Journey', 'Voice', 'Safety check', 'Battery'];
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const localTime = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const markSafe = () => {
    if (journey.active) recordCheckIn();
    else notify('No active journey check-in is available.', 'info');
  };
  return <div className="page-content">
    <PageHeader eyebrow="WATCH MODE PREVIEW" title="Smartwatch companion" subtitle="A visual prototype only. No physical watch is paired, connected, or monitored." action={<span className="mode-chip is-demo"><span /> NOT CONNECTED</span>} />
    <div className="watch-demo-layout">
      <Panel className="watch-preview-panel">
        <div className="watch-tabs">{screens.map((screen) => <button type="button" className={selected === screen ? 'active' : ''} key={screen} onClick={() => setSelected(screen)}>{screen}</button>)}</div>
        <div className="watch-stage"><div className="watch-device"><div className="watch-strap" /><div className="watch-casing"><div className="watch-screen">
          {selected === 'SOS' && <><span className="watch-time">{localTime}</span><button type="button" className="watch-sos" onClick={() => navigate('/sos')}><Siren size={25} /><small>Open SOS<br />on phone</small></button></>}
          {selected === 'Journey' && <><span className="watch-time">JOURNEY · LOCAL</span><MapPin className="watch-pin" size={29} /><b>{journey.active ? journey.eta || 'Arrival unavailable' : 'No active journey'}</b><button type="button" className="watch-safe" onClick={markSafe} disabled={!journey.active}>I’m safe</button></>}
          {selected === 'Voice' && <><span className="watch-time">VOICE ASSISTANT</span><Mic className="watch-pin" size={29} /><Link to="/voice" className="watch-safe">Open on phone</Link></>}
          {selected === 'Safety check' && <><span className="watch-time">SAFETY CHECK-IN</span><div className="watch-checks"><button type="button" onClick={markSafe} aria-label="Mark safe" disabled={!journey.active}>✓</button><button type="button" onClick={() => navigate('/sos')} aria-label="Open SOS confirmation">!</button></div><small>{journey.active ? 'Check-in is local · SOS opens on phone' : 'No active journey · SOS opens on phone'}</small></>}
          {selected === 'Battery' && <><span className="watch-time">PHONE BATTERY</span><Battery className="watch-battery" size={36} /><b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`}</b><small>From this device, when supported</small></>}
        </div></div></div></div>
        <p className="prototype-caption"><Watch size={15} /> Prototype — service not connected. No physical watch is paired; preview actions open the phone flows only.</p>
      </Panel>
      <div className="watch-side"><Panel><span className="eyebrow">PHONE-BASED PREVIEW</span><h3>Safety at a glance.</h3><p>Preview possible watch screens. Actions either open the corresponding phone flow or update a local journey check-in.</p><div className="watch-feature-list">{[['SOS', 'Opens the phone SOS page; it does not simulate a paired watch'], ['Journey check-in', 'Records “I’m safe” locally for an active journey'], ['Voice assistant', 'Opens the browser-based assistant on this device'], ['Battery', 'Shows actual device data only when the browser exposes it']].map(([title, detail]) => <div key={title}><span><Check size={15} /></span><div><b>{title}</b><small>{detail}</small></div></div>)}</div></Panel><SafetyInsight>A real watch integration requires a companion mobile app and platform-specific APIs. Nothing is currently connected to a wearable.</SafetyInsight></div>
    </div>
  </div>;
}

function Guardian({ profile, journey, batteryPct, location, liveLocation, demoMode, emergency, contacts, notificationLog }) {
  const firstName = profile.name.trim().split(/\s+/)[0] || 'Your';
  const hasRecentFix = hasRecentLiveFix(location, liveLocation);
  const coordinates = demoMode ? location ? [location.latitude, location.longitude] : null
    : hasRecentFix ? [location.latitude, location.longitude] : null;
  const gpsConnected = !demoMode && Boolean(hasRecentFix);
  const lastUpdate = location
    ? new Date(location.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'No location fix';
  const guardianTabs = [
    ['Live tracking', '/guardian'],
    ['Journey history', '/history'],
    ['Alerts', '/notifications'],
    ['Contacts', '/profile'],
    ['Evidence', '/evidence'],
    ['Settings', '/settings'],
  ];
  const primaryContact = contacts[0];

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="A WEB VIEW FOR YOUR CIRCLE"
        title="Guardian dashboard"
        subtitle={`This view reflects browser state for ${profile.name || 'this profile'}. It does not sync to another device or account.`}
        action={<span className={`mode-chip ${gpsConnected ? 'is-live' : 'is-demo'}`}><span />{gpsConnected ? 'LIVE ON THIS DEVICE' : demoMode ? 'GPS PAUSED' : 'GPS UNAVAILABLE'}</span>}
      />
      <div className="guardian-sync-note"><Activity size={15} /><span><b>Prototype — service not connected.</b> Location and safety events are not being sent to a guardian device.</span></div>
      <div className="guardian-dashboard">
        <aside className="guardian-side">
          <div className="guardian-brand"><Shield size={17} /> SAHARA AI <small>GUARDIAN</small></div>
          {guardianTabs.map(([item, href], index) => (
            <Link key={item} to={href} className={`guardian-tab-link ${index === 0 ? 'active' : ''}`}>
              <GuardianIcon name={item} />{item}{item === 'Alerts' && emergency && <i />}
            </Link>
          ))}
          <div className="guardian-person"><div className="avatar">{profile.name[0] || '?'}</div><span><b>{profile.name || 'Profile setup required'}</b><small>{gpsConnected ? 'GPS active on this device' : 'Local prototype view'}</small></span></div>
        </aside>
        <div className="guardian-main">
          <div className="guardian-main-head">
            <div><span className="eyebrow">LIVE TRACKING</span><h2>{profile.name.trim() ? `${firstName}’s journey` : 'Your journey'}</h2></div>
            <StatusTag tone={emergency ? 'warning' : gpsConnected ? 'safe' : 'warning'}>
              {emergency ? 'EMERGENCY ACTIVE ON THIS DEVICE' : gpsConnected ? 'LIVE GPS' : demoMode ? 'GPS PAUSED' : 'WAITING FOR GPS'}
            </StatusTag>
          </div>
          <div className="guardian-map-wrap">
            <MapView location={coordinates} demoMode={demoMode} route={journey.active} destinationPoint={journey.destinationPoint} originPoint={journey.originPoint} />
          </div>
          <div className="guardian-update-line">
            <span className={`live-indicator ${gpsConnected ? 'live-indicator--on' : ''}`} />
            <b>{demoMode ? 'GPS paused in Demo Mode' : gpsConnected ? 'Recent GPS fix' : liveLocation.error || 'GPS unavailable or stale'}</b>
            <span>Last update: {lastUpdate}</span>
          </div>
          <div className="guardian-stats">
            <div><span>JOURNEY STATUS</span><b>{emergency ? 'Emergency active' : journey.active ? 'Monitoring on this device' : 'No active journey'}</b></div>
            <div><span>LOCATION</span><b>{coordinates ? `${coordinates[0].toFixed(4)}, ${coordinates[1].toFixed(4)}` : 'Unavailable'}</b></div>
            <div><span>EXPECTED ARRIVAL</span><b>{journey.active ? journey.eta || 'Unavailable' : 'No active journey'}</b></div>
            <div><span>BATTERY</span><b>{batteryPct == null ? 'Unavailable' : `${batteryPct}%`}</b></div>
          </div>
          <div className="guardian-route-line">
            <div className="route-dots"><i /><span /><i /></div>
            <span><b>{journey.from || 'Current location unavailable'}</b><small>{journey.active ? `Journey duration: ${elapsedLabel(journey.startedAt)}` : 'No active journey'}</small><b>{journey.to || 'Destination not set'}</b></span>
            <span className="guardian-distance">Distance unavailable<br /><small>Routing service not configured</small></span>
          </div>
          <div className="guardian-actions">
            {primaryContact?.phone
              ? <a href={`tel:${primaryContact.phone}`} className="button button--hot"><Phone size={15} /> Call {primaryContact.name}</a>
              : <Link to="/profile" className="button button--hot"><Users size={15} /> Add a contact</Link>}
            {primaryContact?.phone && <a href={`sms:${primaryContact.phone}`} className="button button--outline"><MessageCircle size={15} /> Message</a>}
            {coordinates && <a className="button button--outline" href={`https://www.openstreetmap.org/directions?to=${coordinates.join('%2C')}`} target="_blank" rel="noreferrer"><Navigation size={15} /> Open map</a>}
            <Link to="/evidence" className="button button--outline"><LockKeyhole size={15} /> Evidence</Link>
            {emergency && <Link to="/notifications" className="button button--outline"><Bell size={15} /> Emergency log</Link>}
          </div>
          {journey.active && <p className="small-note">Journey updates and check-ins are local to this browser. The line on the map is a direct-line preview, not route guidance.</p>}
          {emergency && notificationLog.length > 0 && <p className="small-note">Prototype — service not connected. Contact delivery status: {notificationLog.find((entry) => entry.contact)?.status || 'Not confirmed'}.</p>}
        </div>
      </div>
    </div>
  );
}
function GuardianIcon({ name }) { const Icon = ({ 'Live tracking': Navigation, 'Journey history': Clock3, Alerts: Bell, Contacts: Users, Evidence: LockKeyhole, Settings })[name] || CircleHelp; return <Icon size={16} />; }

function ProfilePage({ profile, setProfile, contacts, setContacts, notify }) {
  const [draft, setDraft] = useState(profile);
  const navigate = useNavigate();
  const pageLocation = useLocation();
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRelation, setNewRelation] = useState('Friend');
  const saveProfileForm = (event) => {
    event.preventDefault();
    setProfile(draft);
    void saveProfile(draft).then((result) => {
      notify(result.synced
        ? 'Your profile was sent to the configured service.'
        : result.status === 'not-configured'
          ? 'Your profile is saved on this device; cloud sync is not configured.'
          : 'Your profile is saved on this device; cloud sync is unavailable.', result.synced ? 'success' : 'info');
    });
    if (pageLocation.pathname === '/profile-setup') navigate('/home');
  };
  const addContact = (event) => {
    event.preventDefault();
    const name = newName.trim();
    const phone = newPhone.trim();
    if (!name) return;
    if (contacts.some((contact) => contact.name.trim().toLowerCase() === name.toLowerCase()
      && contact.phone.replace(/\s+/g, '') === phone.replace(/\s+/g, ''))) {
      notify('That contact is already saved on this device.', 'alert');
      return;
    }
    setContacts((items) => [...items, { name, phone, relation: newRelation, status: 'On this device', initials: name[0] }]);
    setNewName('');
    setNewPhone('');
    notify('Trusted contact saved on this device. They were not notified.', 'info');
  };
  return (
    <div className="page-content">
      <PageHeader eyebrow="YOUR DETAILS, YOUR CHOICE" title="Your profile" subtitle="Set up your details and the people you want close by." action={<Link to="/settings" className="button button--outline"><Settings size={16} /> Settings</Link>} />
      <div className="profile-layout">
        <Panel className="profile-form-panel">
          <div className="profile-avatar-row">
            <div className="avatar avatar--large">{draft.name.slice(0, 1) || '?'}</div>
            <div><span className="eyebrow">YOUR PROFILE</span><h2>{draft.name || 'Profile setup'}</h2><p>Personal safety profile</p></div>
            <span className="profile-verified"><LockKeyhole size={16} /> On this device</span>
          </div>
          <form className="profile-form" onSubmit={saveProfileForm}>
            <div className="form-grid">
              <label className="field-label">FULL NAME<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
              <label className="field-label">EMAIL ADDRESS<input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
              <label className="field-label">PHONE NUMBER<input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
              <label className="field-label">EMERGENCY CONTACT<input value={draft.emergency} onChange={(e) => setDraft({ ...draft, emergency: e.target.value })} /></label>
              <label className="field-label">BLOOD GROUP<select value={draft.blood} onChange={(e) => setDraft({ ...draft, blood: e.target.value })}>{['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field-label">PREFERRED LANGUAGE<select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })}>{['English', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Marathi'].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field-label field-span">HOME LOCATION<input value={draft.home} onChange={(e) => setDraft({ ...draft, home: e.target.value })} /></label>
            </div>
            <div className="profile-form-footer">
              <span><LockKeyhole size={14} /> Stored on this device unless a backend is configured.</span>
              <Button variant="hot" type="submit">Save profile <Check size={16} /></Button>
            </div>
          </form>
        </Panel>
        <div className="contacts-column">
          <Panel className="contacts-panel">
            <SectionTitle title="Trusted contacts" trailing={<span className="demo-badge">{contacts.length} CONTACTS</span>} />
            <p className="panel-subtitle">Choose people who can support you during a safety event. Prototype — service not connected; saving a contact does not notify them.</p>
            {contacts.length === 0 && <p className="small-note">No trusted contacts saved yet. Add people you know and trust. Emergency messages are not sent unless a backend service is configured.</p>}
            {contacts.map((contact, index) => (
              <div className="trusted-contact" key={`${contact.name}-${index}`}>
                <div className="avatar">{contact.initials || contact.name[0]}</div>
                <div className="trusted-contact-copy"><b>{contact.name}</b><small>{contact.relation} · {contact.phone || 'No number saved'}</small><small>{contact.status || 'Saved on this device'}</small></div>
                <div className="contact-action-links">
                  {contact.phone
                    ? <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${contact.name}`} title="Open a call using your device"><Phone size={14} /></a>
                    : <button className="icon-button" type="button" disabled aria-label={`Call ${contact.name}`} title="No phone number saved"><Phone size={14} /></button>}
                  {contact.phone
                    ? <a href={`sms:${contact.phone.replace(/[^\d+]/g, '')}`} aria-label={`Message ${contact.name}`} title="Open a message using your device"><MessageCircle size={14} /></a>
                    : <button className="icon-button" type="button" disabled aria-label={`Message ${contact.name}`} title="No phone number saved"><MessageCircle size={14} /></button>}
                  <button className="icon-button" aria-label={`Remove ${contact.name}`} onClick={() => { setContacts((items) => items.filter((_, itemIndex) => itemIndex !== index)); notify('Contact removed'); }}><X size={14} /></button>
                </div>
              </div>
            ))}
            <form className="add-contact-form" onSubmit={addContact}>
              <input aria-label="Contact name" placeholder="Contact name" autoComplete="name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
              <input aria-label="Contact phone number" type="tel" autoComplete="tel" placeholder="Phone number (optional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              <label className="sr-only" htmlFor="contact-relation">Relationship</label><select id="contact-relation" aria-label="Relationship" value={newRelation} onChange={(e) => setNewRelation(e.target.value)}>{['Mother', 'Father', 'Sister', 'Brother', 'Partner', 'Friend', 'Other'].map((item) => <option key={item}>{item}</option>)}</select>
              <Button variant="dark" type="submit"><Plus size={15} /> Add contact</Button>
            </form>
          </Panel>
          <SafetyInsight>Contacts are stored locally. SOS and journey alerts require a configured backend; call and message links open your device app only when you choose them.</SafetyInsight>
        </div>
      </div>
    </div>
  );
}

function SettingsRoute({ duressPin, setDuressPin, notify, ...settingsProps }) {
  return <><SettingsPage {...settingsProps} notify={notify} /><div className="page-content session-pin-content"><div className="settings-layout"><div className="settings-main"><SessionDuressSetting duressPin={duressPin} setDuressPin={setDuressPin} notify={notify} /></div></div></div></>;
}

function SettingsPage({ profile, contacts, shareLocation, setShareLocation, notify, liveLocation, demoMode, requestLocation, setDemoMode, alertSoundOn, startAlertSound, stopAlertSound }) {
  const [notificationPermission, setNotificationPermission] = useState(typeof Notification === 'undefined' ? 'unavailable' : Notification.permission);
  const requestNotifications = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unavailable');
      notify('Browser notifications are not supported here.', 'alert');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } catch (error) {
      notify('Notification permission could not be requested' + (error instanceof Error ? ': ' + error.message : '.'), 'alert');
    }
  };
  const tools = [
    [BatteryCharging, 'Battery guardian', 'View actual battery data when available.', '/battery'],
    [Mic, 'Voice assistant', 'Open browser voice and text controls.', '/voice'],
    [Bell, 'Safety notifications', 'Review local journey and check-in reminders.', '/notifications'],
    [ShieldAlert, 'Emergency & duress', 'Open SOS and session PIN controls.', '/sos'],
  ];
  return (
    <div className="page-content">
      <PageHeader eyebrow="MAKE IT YOURS" title="Safety settings" subtitle="You stay in control of what is shared and when." />
      <div className="settings-layout">
        <div className="settings-main">
          <Panel className="settings-panel permission-panel">
            <SectionTitle title="Safety & permissions" />
            <div className="permission-row"><span className="settings-icon"><MapPin size={17} /></span><span><b>Location permission</b><small>{demoMode ? 'Demo Mode - browser GPS is not active' : liveLocation.error || ('Permission: ' + liveLocation.permission + ' - ' + liveLocation.status)}</small></span><Button variant="outline" onClick={requestLocation}>{demoMode ? 'Enable location' : 'Retry GPS'} <ArrowRight size={14} /></Button></div>
            <div className="permission-row"><span className="settings-icon"><Bell size={17} /></span><span><b>Browser notifications</b><small>{notificationPermission === 'unavailable' ? 'Unavailable in this browser' : 'Permission: ' + notificationPermission}</small></span><Button variant="outline" onClick={requestNotifications} disabled={notificationPermission === 'granted'}>{notificationPermission === 'granted' ? 'Enabled' : 'Request'} <ArrowRight size={14} /></Button></div>
            <div className="permission-row"><span className="settings-icon"><Volume2 size={17} /></span><span><b>Audio alert</b><small>{'AudioContext' in window ? alertSoundOn ? 'Alert tone is active on this device' : 'Web Audio available - starts after a user action' : 'Web Audio is unavailable'}</small></span><Button variant="outline" onClick={alertSoundOn ? stopAlertSound : startAlertSound}>{alertSoundOn ? 'Mute' : 'Test sound'} <Volume2 size={14} /></Button></div>
            <div className="permission-row"><span className="settings-icon"><Activity size={17} /></span><span><b>Live tracking</b><small>{demoMode ? 'GPS is paused in Demo Mode' : liveLocation.status + (liveLocation.error ? ' - ' + liveLocation.error : '')}</small></span><Button variant="outline" onClick={() => { setDemoMode((mode) => !mode); if (demoMode) requestLocation(); }}>{demoMode ? 'Switch to Live' : 'Switch to Demo'} <ArrowRight size={14} /></Button></div>
            <label className="settings-row"><span className="settings-copy"><b>Allow manual location-link sharing</b><small>{shareLocation ? 'Enabled on this device; sharing still requires your action.' : 'Disabled; location-link actions are blocked.'}</small></span><input type="checkbox" checked={shareLocation} onChange={(event) => setShareLocation(event.target.checked)} /><span className="switch" /></label>
          </Panel>
          <Panel className="settings-panel"><SectionTitle title="Your safety tools" />{tools.map(([Icon, title, detail, to]) => <Link className="settings-row settings-tool-link" to={to} key={title}><span className="settings-icon"><Icon size={17} /></span><span className="settings-copy"><b>{title}</b><small>{detail}</small></span><ArrowRight size={15} /></Link>)}</Panel>
          <Panel className="settings-panel"><SectionTitle title="Privacy & sharing" /><div className="privacy-block"><div className="privacy-icon"><LockKeyhole size={19} /></div><div><h3>Your location stays yours.</h3><p>Location links are shared only when you explicitly choose a share action. This prototype does not send location to trusted contacts or guardian devices in the background.</p></div></div><div className="privacy-points"><span><Check size={14} /> Evidence stored on this device</span><span><Check size={14} /> You control your contacts</span><span><Check size={14} /> No guardian device sync</span></div><Link to="/privacy" className="quiet-link">Open Privacy Center <ArrowRight size={14} /></Link></Panel>
        </div>
        <div className="settings-aside">
          <Panel className="settings-profile-card"><div className="avatar avatar--large">{profile.name.slice(0, 1) || '?'}</div><span className="eyebrow">YOUR ACCOUNT</span><h3>{profile.name || 'Complete your profile'}</h3><p>{profile.email || 'Profile is saved on this device.'}</p><Link to="/profile" className="button button--outline button--full">Edit profile <ArrowRight size={15} /></Link></Panel>
          <Panel className="settings-contact-card"><SectionTitle title="Trusted circle" trailing={<Link to="/profile">Edit</Link>} />{contacts.length ? contacts.map((contact, index) => <div key={contact.name + '-' + index}><div className="avatar avatar--small">{contact.initials || contact.name[0]}</div><span><b>{contact.name}</b><small>{contact.relation}</small></span></div>) : <p className="small-note">No contacts saved yet.</p>}</Panel>
          <SafetyInsight>Change or remove your trusted contacts any time. Calls and messages open your device app only after you choose them.</SafetyInsight>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></div>{children}</section></div>; }

export default App;
