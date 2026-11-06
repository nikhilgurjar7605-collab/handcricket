import { useEffect } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type Position = [number, number];
type Props = {
  position: Position | null;
  radius: number;
  onPick: (point: { lat: number; lng: number }) => void;
};

const pinIcon = L.divIcon({
  className: 'locatr-map-pin-wrap',
  html: '<span class="locatr-map-pin"><i></i></span>',
  iconSize: [28, 36],
  iconAnchor: [14, 34],
});

function MapController({ position }: { position: Position | null }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 16), { animate: true });
  }, [map, position?.[0], position?.[1]]);
  return null;
}

function MapClickHandler({ onPick }: { onPick: Props['onPick'] }) {
  useMapEvents({
    click(event) {
      onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    },
  });
  return null;
}

export default function MapPicker({ position, radius, onPick }: Props) {
  const fallback: Position = [20.5937, 78.9629];
  const center = position || fallback;
  return (
    <section className="locatr-map-picker" aria-label="Interactive location picker">
      <div className="locatr-map-toolbar">
        <span><b>PIN YOUR GEOFENCE</b><small>Tap anywhere on the map or drag the marker</small></span>
        <span className="map-live-indicator">INTERACTIVE MAP</span>
      </div>
      <MapContainer center={center} zoom={position ? 16 : 5} scrollWheelZoom className="locatr-leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController position={position} />
        <MapClickHandler onPick={onPick} />
        {position && (
          <>
            <Marker
              position={position}
              icon={pinIcon}
              draggable
              eventHandlers={{
                dragend(event) {
                  const point = event.target.getLatLng();
                  onPick({ lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) });
                },
              }}
            />
            <Circle center={position} radius={radius} pathOptions={{ color: '#9888ff', weight: 2, fillColor: '#8b7cff', fillOpacity: 0.16 }} />
          </>
        )}
      </MapContainer>
      <div className="locatr-map-footer">
        <span>{position ? position[0].toFixed(6) + ', ' + position[1].toFixed(6) : 'No pin selected yet'}</span>
        <span>{position ? radius.toLocaleString() + ' m radius preview' : 'Select a point to preview the radius'}</span>
      </div>
    </section>
  );
}
