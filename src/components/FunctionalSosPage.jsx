import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Phone,
  Radio,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

function Dialog({ title, children, onClose }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div className="modal-heading">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

export default function FunctionalSosPage({
  emergency,
  activateEmergency,
  beginEmergencySequence,
  cancelEmergencySequence,
  activationCountdown,
  resolveEmergency,
  countdown,
  contacts,
  location,
  liveLocation,
  demoMode,
  shareLocation,
  notificationLog = [],
  duressPin,
  journey,
  notify,
  alertSoundOn,
  startAlertSound,
  stopAlertSound,
}) {
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');
  const soundMuted = !alertSoundOn;

  useEffect(() => {
    if (emergency) {
      setConfirming(false);
      setCancelConfirm(false);
    }
  }, [emergency]);
  useEffect(() => {
    if (activationCountdown != null) setConfirming(true);
  }, [activationCountdown]);

  const gpsAge = location?.timestamp ? Date.now() - location.timestamp : Infinity;
  const hasRecentGps = !demoMode
    && location
    && ['connected', 'weak'].includes(liveLocation?.status)
    && Number.isFinite(gpsAge)
    && gpsAge >= 0
    && gpsAge < 60000;
  const coordinates = hasRecentGps
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
    : 'No recent GPS fix';
  const accuracyText = hasRecentGps && location.accuracy ? `±${Math.round(location.accuracy)} m` : 'Unknown';
  const activatedAt = notificationLog[0]?.time
    ? new Date(notificationLog[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Just now';

  const handleMuteToggle = () => {
    if (alertSoundOn) {
      stopAlertSound();
      notify?.('Alarm sound stopped', 'info');
      return;
    }
    startAlertSound();
  };

  const handleShareLocation = async () => {
    if (!shareLocation) {
      notify?.('Enable manual location-link sharing in Settings before sharing a location.', 'alert');
      return;
    }
    if (!hasRecentGps) {
      if (notify) notify(demoMode ? 'Live Mode and a recent real GPS fix are required to share a location.' : 'No recent GPS fix is available to share.', 'alert');
      return;
    }
    const coordsStr = `${location.latitude},${location.longitude}`;
    const text = `EMERGENCY ALERT: I need assistance. My current coordinates: https://maps.google.com/?q=${coordsStr} (SAHARA AI Emergency Trigger)`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: '🚨 SAHARA AI Emergency Alert',
          text,
          url: `https://maps.google.com/?q=${coordsStr}`,
        });
        if (notify) notify('Location link opened in your device share sheet. Confirm delivery in the app you chose.', 'info');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        notify?.(`Location share sheet failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'alert');
        return;
      }
    }

    if (!navigator.clipboard?.writeText) {
      notify?.('Location sharing is unavailable in this browser; no link was sent.', 'alert');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (notify) notify('Location link copied. Choose who to send it to.', 'info');
    } catch (error) {
      if (notify) notify(`Location link could not be copied: ${error instanceof Error ? error.message : 'Unknown error'}`, 'alert');
    }
  };

  const checkDuressPin = (e) => {
    e.preventDefault();
    const accepted = Boolean(duressPin) && pin === duressPin;
    setPinMessage(
      accepted
        ? 'Duress PIN accepted. Discretely activating emergency mode.'
        : duressPin
          ? 'PIN not recognized.'
          : 'Set a Duress PIN in Settings for this browser session first.'
    );
    if (accepted) {
      activateEmergency();
    }
    setPin('');
  };

  const closeActivation = () => {
    if (activationCountdown != null) {
      cancelEmergencySequence();
    }
    setConfirming(false);
  };

  return (
    <div className={`page-content sos-view-wrap ${emergency ? 'is-emergency-active' : ''}`}>
      {/* Top Banner if Emergency Active */}
      {emergency && (
        <div className="active-emergency-header">
          <div className="emergency-header-content">
            <span className="emergency-siren-pulse">
              <Siren size={24} />
            </span>
            <div>
              <h1>Active emergency</h1>
              <p>Emergency mode is active on this device. Prototype — service not connected; no contact or emergency-service delivery is confirmed.</p>
            </div>
          </div>
          <div className="emergency-header-actions">
            <button
              className={`button ${soundMuted ? 'button--outline' : 'button--light'}`}
              onClick={handleMuteToggle}
            >
              {soundMuted ? (
                <>
                  <VolumeX size={16} /> Alert sound off
                </>
              ) : (
                <>
                  <Volume2 size={16} /> Alert sound on
                </>
              )}
            </button>
            <button className="button button--cancel-sos" onClick={() => setCancelConfirm(true)}>
              <X size={16} /> CANCEL EMERGENCY
            </button>
          </div>
        </div>
      )}

      {!emergency && (
        <div className="page-header">
          <div>
            <div className="eyebrow">INSTANT SAFETY RESPONSE</div>
            <h1>Emergency & SOS Center</h1>
            <p>Activate an on-device emergency workflow. GPS and contact delivery are shown only when actually available.</p>
          </div>
          <div className="header-meta">
            <span className={`status-pill ${demoMode || !hasRecentGps ? 'status-pill--warning' : 'status-pill--safe'}`}>
              <span />
              {demoMode ? 'DEMO MODE' : hasRecentGps ? 'RECENT GPS FIX' : 'GPS UNAVAILABLE'}
            </span>
          </div>
        </div>
      )}

      <div className="sos-layout">
        {/* Main SOS Trigger / Status Panel */}
        <section className={`panel sos-panel ${emergency ? 'sos-panel--active' : ''}`}>
          <div className="sos-glow" />
          <div className="sos-panel-content">
            <span className="eyebrow">
              {emergency ? 'CRITICAL INCIDENT ACTIVE' : 'EMERGENCY PROTOCOL · READY'}
            </span>

            <div
              className={`emergency-status-mark ${
                emergency ? 'emergency-status-mark--active' : ''
              }`}
            >
              <Siren size={40} />
              <span>{emergency ? 'SOS ACTIVE' : 'READY'}</span>
            </div>

            <h2>{emergency ? 'Emergency Response Active' : 'Need Immediate Help?'}</h2>
            <p>
              {emergency
                ? 'Your device is in emergency mode. Prototype — service not connected; no call or message is placed automatically.'
                : 'Start a 3-second cancellation countdown before activating the local emergency state. No call or message is sent.'}
            </p>

            {emergency && (
              <div className="emergency-summary-box">
                <div className="summary-row">
                  <MapPin size={16} />
                  <div>
                    <b>Coordinates:</b> {coordinates}{' '}
                    <small>({hasRecentGps ? `Accuracy ${accuracyText}` : demoMode ? 'GPS paused in Demo Mode' : 'Location unavailable'})</small>
                  </div>
                </div>
                <div className="summary-row">
                  <Clock3 size={16} />
                  <div>
                    <b>Triggered At:</b> {activatedAt}
                  </div>
                </div>
                <div className="summary-row">
                  <Radio size={16} />
                  <div>
                    <b>Active Duration:</b> {String(Math.floor(countdown / 60)).padStart(2, '0')}:
                    {String(countdown % 60).padStart(2, '0')}
                  </div>
                </div>
                <div className="summary-row">
                  <Users size={16} />
                  <div>
                    <b>Circle Sharing:</b> {shareLocation ? 'Enabled locally' : 'Paused'}
                  </div>
                </div>
              </div>
            )}

            {emergency ? (
              <div className="sos-active-controls">
                <button
                  className={`button button--large ${
                    soundMuted ? 'button--outline' : 'button--light'
                  }`}
                  onClick={handleMuteToggle}
                >
                  {soundMuted ? (
                    <>
                      <VolumeX size={18} /> 🔇 ALERT SOUND OFF
                    </>
                  ) : (
                    <>
                      <Volume2 size={18} /> 🔊 ALERT SOUND ON
                    </>
                  )}
                </button>

                <button className="button button--hot button--large" onClick={handleShareLocation}>
                  <Share2 size={18} /> SHARE LOCATION LINK
                </button>

                <button
                  className="button button--dark-outline button--large"
                  onClick={() => setCancelConfirm(true)}
                >
                  <X size={18} /> CANCEL EMERGENCY
                </button>
              </div>
            ) : (
              <div className="sos-standby-controls">
                <button
                  className="button button--sos-giant"
                  onClick={() => setConfirming(true)}
                  aria-label="Activate SOS"
                >
                  <Siren size={28} />
                  <span>ACTIVATE SOS</span>
                </button>
                <small className="sos-hint">Starts a 3-second cancellation countdown</small>
              </div>
            )}
          </div>

          <div className="sos-footer">
            <span>
              <LockKeyhole size={14} /> SIH 2026 Prototype · Direct tel: / sms: device links
            </span>
            <span className="footer-tag">{demoMode ? 'GPS PAUSED' : 'ON-DEVICE WEB FLOW'}</span>
          </div>
        </section>

        {/* Aside: Trusted Contacts, Emergency Event Log, Duress PIN */}
        <div className="sos-aside">
          {/* Trusted Contacts Panel */}
          <section className="panel contact-panel">
            <div className="section-title">
              <h2>Trusted Circle Contacts</h2>
              <Link className="quiet-link" to="/profile">
                Edit Circle <ArrowRight size={13} />
              </Link>
            </div>
            <p className="panel-subtitle">
              Prototype — service not connected. Calls and messages open your device apps and require your confirmation; a location link is included only when sharing is enabled and a recent GPS fix is available.
            </p>

            <div className="contact-list">
              {contacts.map((contact, index) => {
                const event = notificationLog.find((entry) => entry.contact === contact.name);
                const canIncludeLocation = shareLocation && hasRecentGps;
                const smsText = `I need help. Please contact me. ${canIncludeLocation
                  ? `My current location: https://maps.google.com/?q=${location.latitude},${location.longitude}. `
                  : ''}Shared from SAHARA AI; this message is not sent until you confirm it in your messaging app.`;
                const smsBody = encodeURIComponent(smsText);

                return (
                  <div className="contact-card-row" key={`${contact.name}-${index}`}>
                    <div className="avatar avatar--medium">
                      {contact.initials || contact.name[0]}
                    </div>
                    <div className="contact-info">
                      <b>{contact.name}</b>
                      <span>{contact.relation}</span>
                      <small>{contact.phone || 'No phone number'}</small>
                    </div>

                    <div className="contact-quick-actions">
                      <a
                        href={contact.phone ? `tel:${contact.phone.replace(/\s+/g, '')}` : undefined}
                        className={`action-btn action-btn--call ${!contact.phone ? 'disabled' : ''}`}
                        title={`Call ${contact.name}`}
                        aria-label={`Call ${contact.name}`}
                        aria-disabled={!contact.phone}
                        tabIndex={contact.phone ? undefined : -1}
                      >
                        <Phone size={15} />
                        <span>CALL</span>
                      </a>
                      <a
                        href={
                          contact.phone
                            ? `sms:${contact.phone.replace(/\s+/g, '')}?body=${smsBody}`
                            : undefined
                        }
                        className={`action-btn action-btn--sms ${!contact.phone ? 'disabled' : ''}`}
                        title={`Message ${contact.name}`}
                        aria-label={`Message ${contact.name}`}
                        aria-disabled={!contact.phone}
                        tabIndex={contact.phone ? undefined : -1}
                      >
                        <MessageCircle size={15} />
                        <span>SMS</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Emergency Event Timeline */}
          {emergency && (
            <section className="panel timeline-panel">
              <div className="section-title">
                <h2>Emergency Event Log</h2>
                <span className="demo-badge">LOCAL EVENT LOG</span>
              </div>
              <p className="panel-subtitle">Chronological record of emergency triggers on this device.</p>

              <div className="timeline-items">
                {notificationLog.length > 0 ? (
                  notificationLog.map((entry, idx) => (
                    <div className="timeline-item" key={idx}>
                      <div className="timeline-marker">
                        <CheckCircle2 size={14} />
                      </div>
                      <div className="timeline-content">
                        <div className="timeline-head">
                          <b>{entry.title || entry.contact || 'Emergency Event'}</b>
                          <span className="timeline-time">
                            {new Date(entry.time).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </span>
                        </div>
                        <p>{entry.detail || entry.status || 'Action processed locally'}</p>
                        <span className="timeline-tag">
                          {demoMode ? 'DEMO MODE · LOCAL EVENT' : 'LOCAL EVENT'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-activity">
                    Timeline initialised. Actions will appear chronologically.
                  </div>
                )}
              </div>
              <p className="small-note">
                Notice: Network SMS/dispatch requires telecom hardware API integration. Device
                links open your native phone app.
              </p>
            </section>
          )}

          {/* Duress PIN */}
          <section className="panel duress-panel">
            <div className="duress-icon">
              <ShieldAlert size={20} />
            </div>
            <div>
              <span className="eyebrow">DISCREET DURESS TRIGGER</span>
              <h3>Silent Duress Demo</h3>
              <p>
                Enter your configured session PIN to activate the local emergency state. Prototype — service not connected.
              </p>
              <form className="pin-form" onSubmit={checkDuressPin}>
                <input
                  aria-label="Duress PIN"
                  type="password"
                  inputMode="numeric"
                  maxLength="8"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                />
                <button className="button button--dark" type="submit">
                  Check PIN <ArrowRight size={14} />
                </button>
              </form>
              {pinMessage && <small className="form-feedback">{pinMessage}</small>}
            </div>
          </section>

          <div className="feature-note">
            <LockKeyhole size={16} />
            <p>
              <b>Prototype Safety Architecture.</b> Standalone web browsers cannot capture physical
              lock-screen hardware triggers or dial emergency services without user permission.
            </p>
          </div>
        </div>
      </div>

      {/* Countdown Modal before Activation */}
      {confirming && (
        <Dialog title="Confirm Emergency Activation" onClose={closeActivation}>
          <p className="modal-copy">
            Starting emergency mode activates this device’s audible alert and submits an SOS request
            only when a backend is configured. It does not automatically call or message anyone.
            Cancel now if this was pressed in error.
          </p>

          {activationCountdown != null ? (
            <div className="activation-countdown-box">
              <div className="countdown-number">{activationCountdown}</div>
              <span className="countdown-sub">Emergency activates when timer expires</span>
              <button className="button button--cancel-large" onClick={closeActivation}>
                <X size={18} /> CANCEL ACTIVATION
              </button>
            </div>
          ) : (
            <>
              <div className="modal-contact-preview">
                <span className="preview-label">Trusted contacts on this device:</span>
                {contacts.slice(0, 3).map((contact) => (
                  <div className="preview-contact" key={contact.name}>
                    <CheckCircle2 size={14} />
                    <span>{contact.name}</span>
                    <small>({contact.relation})</small>
                  </div>
                ))}
              </div>

              <div className="modal-actions">
                <button className="button button--outline" onClick={() => setConfirming(false)}>
                  Not now
                </button>
                <button className="button button--hot" onClick={beginEmergencySequence}>
                  <Siren size={16} /> START COUNTDOWN (3s)
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}

      {/* Cancel Confirmation Modal */}
      {cancelConfirm && (
        <Dialog title="Cancel Emergency Mode?" onClose={() => setCancelConfirm(false)}>
          <p className="modal-copy">
            Cancelling will immediately stop the audio siren and reset emergency state. If you are in
            an actual dangerous situation, please contact 112 or local police directly.
          </p>
          <div className="modal-actions">
            <button className="button button--outline" onClick={() => setCancelConfirm(false)}>
              Keep Emergency Active
            </button>
            <button
              className="button button--hot"
              onClick={() => {
                resolveEmergency();
                setCancelConfirm(false);
              }}
            >
              <CheckCircle2 size={16} /> Confirm Cancel Emergency
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
