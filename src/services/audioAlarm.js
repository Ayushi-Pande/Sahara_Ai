/**
 * Web Audio API Emergency Alarm Service
 * Generates an audible siren / repeating alert tone without external audio dependencies.
 * Complies with browser autoplay policies by requiring explicit user interaction before starting.
 */

class EmergencyAlarmService {
  constructor() {
    this.audioCtx = null;
    this.intervalId = null;
    this.isMuted = false;
    this.isPlaying = false;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener({ isPlaying: this.isPlaying, isMuted: this.isMuted });
      } catch (e) {
        console.error('Alarm listener error:', e);
      }
    }
  }

  getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new AudioContextClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  playBeep() {
    if (this.isMuted) return;
    try {
      const ctx = this.getAudioContext();
      if (!ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;

      // Tone 1: High alert beep (960 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(960, now);
      osc1.frequency.exponentialRampToValueAtTime(840, now + 0.16);

      gain1.gain.setValueAtTime(0.0001, now);
      gain1.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.19);

      // Tone 2: Echo alert beep (1200 Hz) slightly delayed
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1200, now + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(1050, now + 0.22);

      gain2.gain.setValueAtTime(0.0001, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.18, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.25);
    } catch (err) {
      console.warn('Audio alarm playback error:', err);
    }
  }

  start() {
    try {
      const ctx = this.getAudioContext();
      if (ctx) {
        ctx.resume();
      }
    } catch {}

    this.isPlaying = true;
    this.isMuted = false;
    this.notify();

    // Play immediate pulse
    this.playBeep();

    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    // Repeating pattern: double beep every 750ms
    this.intervalId = setInterval(() => {
      this.playBeep();
    }, 750);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
    this.notify();
  }

  mute() {
    this.isMuted = true;
    this.notify();
  }

  unmute() {
    this.isMuted = false;
    try {
      this.getAudioContext()?.resume();
    } catch {}
    this.notify();
  }

  toggleMute() {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
  }

  // Play a quick friendly feedback pip (e.g. check-in, button feedback)
  playNoticeTone() {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.08); // A5
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {}
  }
}

export const emergencyAlarm = new EmergencyAlarmService();
export default emergencyAlarm;

