# LOCATR

Consent-based location sharing and geofence notifications.

## Included in this export
- React + Vite frontend and dark UI
- Authenticated backend API routes
- Consent-based invitations and sharing controls
- Server-side geofence entry/exit detection
- Google Places text search and Google Maps short-link coordinate resolver
- Event history and notification attempts

## Run / deploy
This source was exported from the LOCATR AppDeploy project. It uses the AppDeploy client and SDK runtime, so it must run in an AppDeploy-compatible environment unless those integrations are replaced.

1. Install dependencies with `npm install`.
2. Configure `GOOGLE_MAPS_API_KEY` securely in the hosting provider.
3. Enable Google Places API (New) and billing in Google Cloud.
4. Build with `npm run build`.

The real API key is intentionally not stored in this repository.

## Privacy and tracking limitations
Sharing is opt-in. An invited person must accept and explicitly enable sharing, and can stop sharing. Current browser tracking depends on the browser remaining active; it does not guarantee Android background tracking. A native Android background service is a separate implementation step.

## Pending map-picker work
The proposed embedded Leaflet/OpenStreetMap picker, draggable pin, radius preview, and in-app Maps-link workflow are not included in this source snapshot yet.