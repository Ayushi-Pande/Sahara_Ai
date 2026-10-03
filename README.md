# SAHARA AI

A responsive women's safety and emergency-response prototype built with React, Vite, Tailwind CSS, React Router, Recharts, and Leaflet/OpenStreetMap.

## Run locally

```sh
npm install
npm run dev
```

Create a production build with `npm run build` and preview it with `npm run preview`.

## Demo behavior

The sample account is Ayushi Pandey, with a SHEAT College to Home journey, a 92/100 safety score, and demo location around Varanasi. Profile details, trusted contacts, journey state, reports, evidence metadata, and preferences use browser local storage. Emergency-active state, its contact log, audio state, and the Duress PIN are kept in memory only for the current session.

Choose **Live Mode** to request continuous browser `watchPosition` updates. GPS requires a secure context (`localhost` or HTTPS) and location permission. If access is denied, unsupported, stale, or inaccurate, the UI reports that state instead of labeling sample coordinates as live. Demo Mode uses the controlled Varanasi sample.

Battery percentage and discharge time are shown only when the browser provides them through the Battery Status API. Voice recognition depends on the browser's Web Speech API; typed commands remain available as a local rule-based fallback. Map tiles need an internet connection. Nearby help queries public OpenStreetMap Overpass data around a live fix; if that public service is unavailable, the app reports the failure. Demo Mode uses the labeled sample locations.

Live route deviation is a straight-line prototype check with a configurable threshold (default 150 m), not a certified routing or safety algorithm. Destination lookup uses the public OpenStreetMap Nominatim service when a non-generic destination is entered; the displayed path is a direct-line preview, not turn-by-turn navigation. SOS uses a browser-generated Web Audio tone, local confirmation/countdown, and local contact-event records. It does not call emergency services or deliver network messages. `tel:` and `sms:` actions require an explicit tap and device support. Guardian view is local to this browser; no separate device receives live synchronization. Physical volume buttons, lock-screen actions, and real smartwatch integrations are not available in this prototype.
