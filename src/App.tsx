import { useEffect, useMemo, useState } from 'react';
import MapPicker from './MapPicker';
import { auth, api, notifications } from '@appdeploy/client';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Fingerprint,
  Globe2,
  LocateFixed,
  LogOut,
  MapPin,
  Menu,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
  X,
  Zap,
} from 'lucide-react';

type User = { userId: string; email?: string; name?: string; picture?: string };
type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  events: string[];
  createdAt: string;
};
type Person = {
  id: string;
  name: string;
  email: string;
  inviteCode: string;
  status: string;
  createdAt: string;
};
type EventItem = {
  id: string;
  title: string;
  detail: string;
  kind: string;
  createdAt: string;
};
type MapPlace = { placeId: string; name: string; address: string; lat: number; lng: number };

const fmt = (date: string) =>
  new Date(date).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const initials = (name: string) =>
  name
    .split(' ')
    .map(v => v[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function parseMapsLink(value: string) {
  const decoded = value.replace(/&amp;/g, '&');
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Overview');
  const [places, setPlaces] = useState<Place[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showPlace, setShowPlace] = useState(false);
  const [showPerson, setShowPerson] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [placeAddress, setPlaceAddress] = useState('');
  const [mapsUrl, setMapsUrl] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('250');
  const [personName, setPersonName] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [toast, setToast] = useState('');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [memberships, setMemberships] = useState<any[]>([]);
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [trackingState, setTrackingState] = useState('off');
  const [lastLocationAt, setLastLocationAt] = useState('');
  const [mapsSearchQuery, setMapsSearchQuery] = useState('');
  const [mapsResults, setMapsResults] = useState<MapPlace[]>([]);
  const [mapsSearching, setMapsSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<MapPlace | null>(null);
  const [mapsResolving, setMapsResolving] = useState(false);

  const refresh = async () => {
    const response = await api.get('/api/bootstrap');
    setPlaces(response.data.places || []);
    setPeople(response.data.people || []);
    setEvents(response.data.events || []);
    setMemberships(response.data.myShares || []);
    setSharingEnabled((response.data.myShares || []).some((share: any) => share.sharing === true));
  };

  useEffect(() => {
    let alive = true;
    auth
      .getUser()
      .then(async value => {
        if (!alive) return;
        setUser(value as User | null);
        if (value) {
          try {
            await refresh();
          } catch {
            setToast('Could not load your workspace. Refresh to retry.');
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!sharingEnabled || !user) { setTrackingState('off'); return; }
    if (!navigator.geolocation) { setTrackingState('unsupported'); setToast('This browser does not support location services.'); return; }
    let lastSent = 0;
    setTrackingState('requesting');
    const watchId = navigator.geolocation.watchPosition(async position => {
      setTrackingState('active');
      const now = Date.now();
      if (now - lastSent < 15000) return;
      lastSent = now;
      try {
        await api.post('/api/location', { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy });
        setLastLocationAt(new Date().toISOString());
      } catch (e) { setTrackingState('error'); setToast(e instanceof Error ? e.message : 'Location update failed.'); }
    }, err => {
      setTrackingState('error');
      setToast(err.code === 1 ? 'Location permission was denied. Enable it in your browser settings.' : 'Could not get your location. Check GPS and try again.');
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [sharingEnabled, user?.userId]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filteredPlaces = useMemo(
    () =>
      places.filter(p =>
        (p.name + ' ' + p.address).toLowerCase().includes(query.toLowerCase())
      ),
    [places, query]
  );
  const activePlaces = places.length;
  const sharingPeople = people.filter(p => p.status === 'Sharing').length;

  const signIn = async () => {
    try {
      await auth.signInWithRedirect();
    } catch (e) {
      setToast(
        e instanceof Error ? e.message : 'Sign-in could not start. Try again.'
      );
    }
  };

  const addPlace = async () => {
    if (!placeName.trim()) {
      setToast('Give this location a name first.');
      return;
    }
    const coords = selectedPlace
      ? { lat: selectedPlace.lat, lng: selectedPlace.lng }
      : mapsUrl
        ? parseMapsLink(mapsUrl)
        : null;
    const finalLat = coords?.lat ?? (lat.trim() === '' ? NaN : Number(lat));
    const finalLng = coords?.lng ?? (lng.trim() === '' ? NaN : Number(lng));
    if (
      !Number.isFinite(finalLat) ||
      !Number.isFinite(finalLng) ||
      Math.abs(finalLat) > 90 ||
      Math.abs(finalLng) > 180
    ) {
      setToast('Add valid coordinates from the Google Maps link.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/places', {
        name: placeName.trim(),
        address: placeAddress.trim() || placeName.trim(),
        lat: finalLat,
        lng: finalLng,
        radius: Number(radius),
        events: ['entry', 'exit'],
      });
      await refresh();
      setShowPlace(false);
      setPlaceName('');
      setPlaceAddress('');
      setMapsUrl('');
      setLat('');
      setLng('');
      setSelectedPlace(null);
      setMapsSearchQuery('');
      setMapsResults([]);
      setRadius('250');
      setToast(
        'Geofence saved. Accepted members can now share their location to trigger entry and exit alerts.'
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not save location.');
    } finally {
      setBusy(false);
    }
  };

  const addPerson = async () => {
    if (!personName.trim()) {
      setToast('Enter the person’s name.');
      return;
    }
    setBusy(true);
    try {
      const response = await api.post('/api/people', {
        name: personName.trim(),
        email: personEmail.trim(),
      });
      await refresh();
      setShowPerson(false);
      setPersonName('');
      setPersonEmail('');
      if (response.data.inviteCode) {
        await navigator.clipboard
          ?.writeText(response.data.inviteCode)
          .catch(() => undefined);
        setToast(
          'Invite code created and copied. Sharing starts only after they accept.'
        );
      } else setToast('Invite created.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not create invite.');
    } finally {
      setBusy(false);
    }
  };

  const acceptInvite = async () => {
    if (!joinCode.trim()) { setToast('Enter the invite code first.'); return; }
    setBusy(true);
    try {
      await api.post('/api/sharing/accept', { code: joinCode.trim() });
      setJoinCode('');
      await refresh();
      setToast('Invite accepted. You can now choose whether to share your location.');
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not accept invite.'); }
    finally { setBusy(false); }
  };

  const changeSharing = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.post(enabled ? '/api/sharing/start' : '/api/sharing/stop', {});
      setSharingEnabled(enabled);
      setToast(enabled ? 'Location sharing enabled. Keep LOCATR open for active web tracking.' : 'Location sharing stopped.');
      await refresh();
    } catch (e) { setToast(e instanceof Error ? e.message : 'Could not change sharing.'); }
    finally { setBusy(false); }
  };

  const deletePlace = async (id: string) => {
    try {
      await api.delete('/api/places/' + id);
      await refresh();
      setToast('Location removed.');
    } catch {
      setToast('Could not remove this location.');
    }
  };

  const enablePush = async () => {
    try {
      await notifications.subscribe();
      setPushEnabled(true);
      setToast('Notifications enabled on this device.');
    } catch (e) {
      setToast(
        e instanceof Error ? e.message : 'Notifications could not be enabled.'
      );
    }
  };

  const testAlert = async () => {
    try {
      await api.post('/api/test-notification', {});
      setToast('Test notification sent to your signed-in account.');
    } catch (e) {
      setToast(
        e instanceof Error ? e.message : 'Could not send test notification.'
      );
    }
  };

  const searchGooglePlaces = async () => {
    if (!mapsSearchQuery.trim()) { setToast('Type a place name, landmark or full address first.'); return; }
    setSelectedPlace(null);
    setMapsSearching(true);
    try {
      const response = await api.post('/api/maps/search', { query: mapsSearchQuery.trim() });
      setMapsResults(response.data.places || []);
      if (!(response.data.places || []).length) setToast('No matching places found. Try a more specific search.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Google Maps search is not available.');
    } finally { setMapsSearching(false); }
  };

  const chooseGooglePlace = (place: MapPlace) => {
    setSelectedPlace(place);
    setPlaceName(place.name);
    setPlaceAddress(place.address);
    setLat(String(place.lat));
    setLng(String(place.lng));
    setMapsUrl('');
    setMapsResults([]);
    setMapsSearchQuery(place.name);
    setToast('Place selected. Review the address and radius, then save.');
  };

  const resolveGoogleMapsLink = async () => {
    if (!mapsUrl.trim()) { setToast('Paste a Google Maps share link first.'); return; }
    const direct = parseMapsLink(mapsUrl);
    if (direct) {
      const place: MapPlace = { placeId: 'maps-link', name: placeName.trim() || 'Pinned location', address: placeAddress.trim() || 'Coordinates from Google Maps link', ...direct };
      setSelectedPlace(place);
      setPlaceName(place.name);
      setPlaceAddress(place.address);
      setLat(String(place.lat));
      setLng(String(place.lng));
      setToast('Coordinates detected. Review the pin and radius on the map.');
      return;
    }
    setMapsResolving(true);
    try {
      const response = await api.post('/api/maps/resolve', { url: mapsUrl.trim() });
      const place = response.data.place as MapPlace;
      if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) throw new Error('The share link did not return valid coordinates.');
      setSelectedPlace(place);
      setPlaceName(placeName.trim() || place.name);
      setPlaceAddress(place.address);
      setLat(String(place.lat));
      setLng(String(place.lng));
      setToast('Google Maps pin resolved. Adjust it on the map if needed.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not resolve this Google Maps link.');
    } finally {
      setMapsResolving(false);
    }
  };

  const chooseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setToast('Location is not supported by this browser. Search for a place instead.');
      return;
    }
    setMapsSearching(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        const place: MapPlace = {
          placeId: 'current-location',
          name: 'Current location',
          address: 'Coordinates from this device',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setSelectedPlace(place);
        setPlaceName('Current location');
        setPlaceAddress('Coordinates from this device');
        setLat(String(place.lat));
        setLng(String(place.lng));
        setMapsUrl('');
        setMapsResults([]);
        setMapsSearchQuery('');
        setMapsSearching(false);
        setToast('Current location selected. Give it a name before saving.');
      },
      error => {
        setMapsSearching(false);
        setToast(error.code === 1
          ? 'Location permission was denied. Allow location access in browser settings.'
          : 'Could not get your current location. Turn on GPS and try again.');
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
  };

  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Crosshair size={25} />
        </div>
        <span>LOCATR</span>
        <div className="loader-line" />
      </div>
    );
  if (!user)
    return (
      <div className="auth-shell">
        <div className="auth-art">
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="auth-grid" />
          <div className="auth-brand">
            <div className="brand-mark">
              <Crosshair size={24} />
            </div>
            <span>LOCATR</span>
          </div>
          <div className="auth-message">
            <div className="eyebrow">
              <span className="pulse-dot" /> LOCATION INTELLIGENCE
            </div>
            <h1>
              Know when
              <br />
              they <em>arrive.</em>
              <br />
              Know when
              <br />
              they leave.
            </h1>
            <p>
              Thoughtful location alerts for the people and places that matter.
              Always permission-based. Always in your control.
            </p>
            <div className="auth-foot">
              <ShieldCheck size={16} /> Consent-first location sharing{' '}
              <span>•</span> Private by design
            </div>
          </div>
          <div className="auth-coordinates">
            28°55' N&nbsp;&nbsp; 75°08' E <span>LIVE SYSTEM / READY</span>
          </div>
        </div>
        <div className="auth-panel">
          <div className="panel-top">
            <span>YOUR COMMAND CENTER</span>
            <span className="secure">
              <ShieldCheck size={14} /> SECURE ACCESS
            </span>
          </div>
          <div className="auth-form">
            <div className="mini-icon">
              <Fingerprint size={23} />
            </div>
            <h2>Welcome to LOCATR</h2>
            <p>Sign in to manage your places, people and location alerts.</p>
            <button className="primary-btn full" onClick={signIn}>
              Continue with secure sign-in <ArrowUpRight size={17} />
            </button>
            <div className="auth-divider">
              <span />
              PRIVATE WORKSPACE
              <span />
            </div>
            <div className="auth-benefits">
              <div>
                <MapPin size={17} />
                <span>Smart geofences</span>
              </div>
              <div>
                <Bell size={17} />
                <span>Instant arrival & exit alerts</span>
              </div>
              <div>
                <Users size={17} />
                <span>People you choose</span>
              </div>
            </div>
            <small>
              By continuing, you agree to use location sharing only with each
              person's informed consent.
            </small>
          </div>
          <div className="panel-bottom">
            LOCATR <span>BUILT FOR PEACE OF MIND</span>
          </div>
        </div>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileNav ? 'open' : '')}>
        <div className="side-brand">
          <div className="brand-mark">
            <Crosshair size={21} />
          </div>
          <span>LOCATR</span>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          WORKSPACE <ChevronDown size={13} />
        </div>
        <div className="workspace-card">
          <div className="workspace-avatar">
            {initials(user.name || user.email || 'Me')}
          </div>
          <div>
            <b>{user.name || 'My workspace'}</b>
            <small>Personal workspace</small>
          </div>
          <span className="online-dot" />
        </div>
        <div className="nav-label">MONITOR</div>
        {[
          { name: 'Overview', icon: Activity },
          { name: 'My locations', icon: MapPin },
          { name: 'People', icon: Users },
          { name: 'Alert history', icon: BellRing },
        ].map(item => (
          <button
            key={item.name}
            className={'nav-item ' + (tab === item.name ? 'selected' : '')}
            onClick={() => {
              setTab(item.name);
              setMobileNav(false);
            }}
          >
            <item.icon size={17} />
            {item.name}
            {item.name === 'Alert history' && events.length > 0 && (
              <span className="nav-count">{events.length}</span>
            )}
          </button>
        ))}
        <div className="nav-label settings-label">PREFERENCES</div>
        <button
          className={'nav-item ' + (tab === 'Settings' ? 'selected' : '')}
          onClick={() => {
            setTab('Settings');
            setMobileNav(false);
          }}
        >
          <Settings2 size={17} />
          Settings
        </button>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <CircleHelp size={17} />
            </div>
            <b>Need a hand?</b>
            <p>Learn how geofences and sharing work.</p>
            <button
              onClick={() =>
                setToast(
                  'Each person must accept an invite and enable location sharing on their device.'
                )
              }
            >
              How it works <ArrowUpRight size={13} />
            </button>
          </div>
          <div className="user-row">
            <div className="user-avatar">
              {initials(user.name || user.email || 'Me')}
            </div>
            <div className="user-meta">
              <b>{user.name || 'Account'}</b>
              <small>{user.email || 'Signed in'}</small>
            </div>
            <button
              title="Sign out"
              onClick={() => auth.signOut().then(() => setUser(null))}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <div className="scrim" onClick={() => setMobileNav(false)} />
      )}
      <main className="main-area">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMobileNav(true)}>
            <Menu size={19} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span> <b>{tab}</b>
          </div>
          <div className="top-actions">
            <div className="system-status">
              <span className="pulse-dot" /> SYSTEM READY
            </div>
            <button
              className="icon-btn"
              onClick={enablePush}
              title="Enable notifications"
            >
              <Bell size={17} />
            </button>
            <div className="top-avatar">
              {initials(user.name || user.email || 'Me')}
            </div>
          </div>
        </header>
        <div className="content">
          {tab === 'Overview' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    FRIDAY, NOVEMBER 6, 2026 <span className="heading-dot" />{' '}
                    YOUR LOCATION NETWORK
                  </div>
                  <h1>
                    Your world, <em>in view.</em>
                  </h1>
                  <p>
                    One place to keep track of the places and people you care
                    about.
                  </p>
                </div>
                <button
                  className="primary-btn"
                  onClick={() => setShowPlace(true)}
                >
                  <Plus size={17} /> Add a location
                </button>
              </div>
              <div className="notice">
                <div className="notice-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <b>Location sharing is always opt-in.</b>
                  <span>
                    People must accept your invite and enable location sharing
                    before any entry or exit can be detected.
                  </span>
                </div>
                <button
                  onClick={() =>
                    setToast(
                      'LOCATR only receives location from users who have accepted an invite and enabled sharing.'
                    )
                  }
                >
                  Learn more <ArrowUpRight size={13} />
                </button>
              </div>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-top">
                    <span>SAVED LOCATIONS</span>
                    <div className="stat-icon violet">
                      <MapPin size={17} />
                    </div>
                  </div>
                  <div className="stat-value">
                    {activePlaces.toString().padStart(2, '0')}
                  </div>
                  <div className="stat-foot">
                    <span className="stat-muted">Geofences configured</span>
                    <span className="stat-arrow">
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>CONNECTED PEOPLE</span>
                    <div className="stat-icon blue">
                      <Users size={17} />
                    </div>
                  </div>
                  <div className="stat-value">
                    {sharingPeople.toString().padStart(2, '0')}
                  </div>
                  <div className="stat-foot">
                    <span className="stat-muted">
                      {people.length} invited in total
                    </span>
                    <span className="stat-arrow">
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>ALERTS TODAY</span>
                    <div className="stat-icon amber">
                      <BellRing size={17} />
                    </div>
                  </div>
                  <div className="stat-value">
                    {events
                      .filter(
                        e =>
                          new Date(e.createdAt).toDateString() ===
                          new Date().toDateString()
                      )
                      .length.toString()
                      .padStart(2, '0')}
                  </div>
                  <div className="stat-foot">
                    <span className="stat-muted">Entry & exit activity</span>
                    <span className="stat-arrow">
                      <Activity size={14} />
                    </span>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-top">
                    <span>NETWORK STATUS</span>
                    <div className="stat-icon green">
                      <Radio size={17} />
                    </div>
                  </div>
                  <div className="stat-value status-value">Standby</div>
                  <div className="stat-foot">
                    <span className="stat-muted">Awaiting shared devices</span>
                    <span className="status-pill">
                      <span /> READY
                    </span>
                  </div>
                </div>
              </div>
              <div className="section-grid">
                <section className="surface locations-surface">
                  <div className="surface-head">
                    <div>
                      <div className="section-kicker">YOUR GEOZONES</div>
                      <h3>
                        Saved locations{' '}
                        <span className="count-badge">{places.length}</span>
                      </h3>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setTab('My locations')}
                    >
                      View all <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {places.length ? (
                    <div className="place-list">
                      {places.slice(0, 4).map(place => (
                        <div className="place-row" key={place.id}>
                          <div className="place-pin">
                            <MapPin size={18} />
                          </div>
                          <div className="place-info">
                            <b>{place.name}</b>
                            <span>{place.address}</span>
                            <small>
                              <Crosshair size={12} /> {place.radius}m radius ·
                              Entry & exit
                            </small>
                          </div>
                          <a
                            className="map-link"
                            href={
                              'https://www.google.com/maps/search/?api=1&query=' +
                              place.lat +
                              ',' +
                              place.lng
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={15} />
                          </a>
                          <button
                            className="row-delete"
                            onClick={() => deletePlace(place.id)}
                            title="Remove location"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-visual">
                        <MapPin size={26} />
                        <span />
                      </div>
                      <b>No locations saved yet</b>
                      <p>
                        Add a place from Google Maps and set the radius you want
                        to monitor.
                      </p>
                      <button
                        className="outline-btn"
                        onClick={() => setShowPlace(true)}
                      >
                        <Plus size={15} /> Create your first geofence
                      </button>
                    </div>
                  )}
                </section>
                <section className="surface activity-surface">
                  <div className="surface-head">
                    <div>
                      <div className="section-kicker">LIVE FEED</div>
                      <h3>Recent activity</h3>
                    </div>
                    <span className="live-tag">
                      <span /> LIVE
                    </span>
                  </div>
                  {events.length ? (
                    <div className="activity-list">
                      {events.slice(0, 5).map(event => (
                        <div className="activity-row" key={event.id}>
                          <div className={'activity-icon ' + event.kind}>
                            {event.kind === 'entry' ? (
                              <ArrowDownRight size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </div>
                          <div className="activity-copy">
                            <b>{event.title}</b>
                            <span>{event.detail}</span>
                          </div>
                          <time>{fmt(event.createdAt)}</time>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-activity">
                      <div className="activity-orbit">
                        <Activity size={23} />
                      </div>
                      <b>Nothing happening. Yet.</b>
                      <p>
                        When an invited person shares their location and crosses
                        a geofence, their entry or exit alert will appear here.
                      </p>
                    </div>
                  )}
                </section>
              </div>
              <div className="bottom-grid">
                <section className="surface people-surface">
                  <div className="surface-head">
                    <div>
                      <div className="section-kicker">YOUR CIRCLE</div>
                      <h3>
                        People{' '}
                        <span className="count-badge">{people.length}</span>
                      </h3>
                    </div>
                    <button
                      className="text-action"
                      onClick={() => setShowPerson(true)}
                    >
                      <Plus size={14} /> Invite
                    </button>
                  </div>
                  {people.length ? (
                    <div className="people-list">
                      {people.slice(0, 4).map(person => (
                        <div className="person-row" key={person.id}>
                          <div className="person-avatar">
                            {initials(person.name)}
                          </div>
                          <div className="person-info">
                            <b>{person.name}</b>
                            <span>{person.email || 'Invite link pending'}</span>
                          </div>
                          <span
                            className={
                              'person-status ' +
                              (person.status === 'Sharing' ? 'sharing' : '')
                            }
                          >
                            <i />
                            {person.status}
                          </span>
                          <button
                            className="copy-btn"
                            onClick={() =>
                              navigator.clipboard
                                ?.writeText(person.inviteCode)
                                .then(() => setToast('Invite code copied.'))
                            }
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="compact-empty">
                      <Users size={22} />
                      <span>No people added</span>
                      <button onClick={() => setShowPerson(true)}>
                        Invite someone <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="setup-card">
                  <div className="setup-glow" />
                  <div className="setup-top">
                    <div className="setup-icon">
                      <Smartphone size={19} />
                    </div>
                    <span>GET CONNECTED</span>
                  </div>
                  <h3>
                    Bring your
                    <br />
                    <em>people online.</em>
                  </h3>
                  <p>
                    Invite someone to LOCATR. They can accept the invite and
                    choose when to share their location.
                  </p>
                  <button onClick={() => setShowPerson(true)}>
                    Invite a person <ArrowUpRight size={15} />
                  </button>
                  <div className="setup-progress">
                    <span />
                    <span />
                    <span />
                  </div>
                  <small>DEVICE CONNECTION IS THE NEXT STEP</small>
                </section>
              </div>
            </>
          )}
          {tab === 'My locations' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GEOFENCE MANAGEMENT</div>
                  <h1>
                    Places that <em>matter.</em>
                  </h1>
                  <p>
                    Set a boundary around a place and choose who can share
                    activity there.
                  </p>
                </div>
                <button
                  className="primary-btn"
                  onClick={() => setShowPlace(true)}
                >
                  <Plus size={17} /> Add a location
                </button>
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search saved locations"
                  />
                </div>
                <span className="result-count">
                  {filteredPlaces.length} LOCATIONS
                </span>
              </div>
              <div className="location-cards">
                {filteredPlaces.map(p => (
                  <div className="surface location-card" key={p.id}>
                    <div className="location-card-top">
                      <div className="place-pin">
                        <MapPin size={19} />
                      </div>
                      <button
                        className="row-delete"
                        onClick={() => deletePlace(p.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <h3>{p.name}</h3>
                    <p>{p.address}</p>
                    <div className="radius-line">
                      <Crosshair size={14} /> {p.radius} metre radius
                    </div>
                    <div className="location-card-bottom">
                      <a
                        href={
                          'https://www.google.com/maps/search/?api=1&query=' +
                          p.lat +
                          ',' +
                          p.lng
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Google Maps <ExternalLink size={13} />
                      </a>
                      <span className="pending-tag">AWAITING DEVICE</span>
                    </div>
                  </div>
                ))}
                {!filteredPlaces.length && (
                  <div className="surface empty-state wide-empty">
                    <MapPin size={26} />
                    <b>
                      {query ? 'No matching locations' : 'Your map starts here'}
                    </b>
                    <p>
                      {query
                        ? 'Try another search.'
                        : 'Save your first Google Maps location to create a geofence.'}
                    </p>
                    <button
                      className="outline-btn"
                      onClick={() => setShowPlace(true)}
                    >
                      <Plus size={15} /> Add location
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {tab === 'People' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SHARED ACCESS</div>
                  <h1>
                    Your trusted <em>circle.</em>
                  </h1>
                  <p>
                    Only people who accept your invite can share their location
                    with you.
                  </p>
                </div>
                <button
                  className="primary-btn"
                  onClick={() => setShowPerson(true)}
                >
                  <Plus size={17} /> Invite someone
                </button>
              </div>
              <div className="notice">
                <div className="notice-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <b>Sharing is controlled by each person.</b>
                  <span>
                    An invite does not activate tracking. The invited person
                    must accept and explicitly enable location sharing.
                  </span>
                </div>
              </div>
              <section className="surface setting-card" style={{ marginBottom: 14 }}>
                <div className="section-kicker">JOIN A LOCATION NETWORK</div>
                <h3>Have an invite code?</h3>
                <p>Enter the code shared by the person who invited you. Accepting does not turn on location sharing.</p>
                <div className="join-row"><input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="XXXXX-XXXXX" maxLength={20}/><button className="primary-btn" disabled={busy} onClick={acceptInvite}>Accept invite <ArrowUpRight size={14}/></button></div>
                {memberships.length > 0 && <div className="sharing-control"><div><b>Your location sharing</b><span>{sharingEnabled ? 'Sharing is enabled for accepted connections.' : 'Your location is not being shared.'}</span></div><button className={sharingEnabled ? 'stop-sharing-btn' : 'primary-btn'} disabled={busy} onClick={() => changeSharing(!sharingEnabled)}>{sharingEnabled ? 'Stop sharing' : 'Enable sharing'}</button></div>}
                {sharingEnabled && <div className="tracking-status"><span className={trackingState === 'active' ? 'tracking-dot' : 'tracking-dot idle'}/>{trackingState === 'active' ? 'Location updates active while this page is open' : trackingState === 'error' ? 'Location permission or GPS error' : trackingState === 'unsupported' ? 'Location is not supported in this browser' : 'Waiting for location permission'}{lastLocationAt && <small>Last update {fmt(lastLocationAt)}</small>}</div>}
              </section>
              <section className="surface people-table">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">
                      INVITATIONS & CONNECTIONS
                    </div>
                    <h3>People you've invited</h3>
                  </div>
                  <span className="count-badge">{people.length}</span>
                </div>
                {people.length ? (
                  people.map(p => (
                    <div className="person-row table-person" key={p.id}>
                      <div className="person-avatar">{initials(p.name)}</div>
                      <div className="person-info">
                        <b>{p.name}</b>
                        <span>{p.email || 'No email added'}</span>
                      </div>
                      <span
                        className={
                          'person-status ' +
                          (p.status === 'Sharing' ? 'sharing' : '')
                        }
                      >
                        <i />
                        {p.status}
                      </span>
                      <div className="invite-code">
                        CODE <b>{p.inviteCode}</b>
                      </div>
                      <button
                        className="copy-btn"
                        onClick={() =>
                          navigator.clipboard
                            ?.writeText(p.inviteCode)
                            .then(() => setToast('Invite code copied.'))
                        }
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <Users size={26} />
                    <b>Your circle is empty</b>
                    <p>
                      Invite a person to start building your location network.
                    </p>
                    <button
                      className="outline-btn"
                      onClick={() => setShowPerson(true)}
                    >
                      <Plus size={15} /> Create invite
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === 'Alert history' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ENTRY & EXIT EVENTS</div>
                  <h1>
                    Every move, <em>accounted for.</em>
                  </h1>
                  <p>
                    A chronological record of geofence activity shared with you.
                  </p>
                </div>
                <button className="outline-btn" onClick={testAlert}>
                  <BellRing size={15} /> Send test alert
                </button>
              </div>
              <section className="surface history-surface">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">ACTIVITY LOG</div>
                    <h3>All notifications</h3>
                  </div>
                  <span className="count-badge">{events.length}</span>
                </div>
                {events.length ? (
                  events.map(e => (
                    <div className="activity-row history-row" key={e.id}>
                      <div className={'activity-icon ' + e.kind}>
                        {e.kind === 'entry' ? (
                          <ArrowDownRight size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}
                      </div>
                      <div className="activity-copy">
                        <b>{e.title}</b>
                        <span>{e.detail}</span>
                      </div>
                      <time>{fmt(e.createdAt)}</time>
                    </div>
                  ))
                ) : (
                  <div className="empty-activity">
                    <div className="activity-orbit">
                      <BellRing size={23} />
                    </div>
                    <b>No alerts yet</b>
                    <p>
                      Entry and exit alerts are generated when an opted-in person shares location from a supported device and crosses a saved geofence.
                    </p>
                    <button className="outline-btn" onClick={testAlert}>
                      Send a test notification
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === 'Settings' && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PREFERENCES & SECURITY</div>
                  <h1>
                    Control <em>center.</em>
                  </h1>
                  <p>Manage notifications and your LOCATR account.</p>
                </div>
              </div>
              <div className="notice"><div className="notice-icon"><ShieldCheck size={18}/></div><div><b>Web tracking limitation</b><span>Browser location updates work while LOCATR remains open and the browser allows location access. For dependable locked-screen/background tracking, a native Android companion is required.</span></div></div>
              <div className="settings-grid">
                <section className="surface setting-card">
                  <div className="setting-icon">
                    <BellRing size={19} />
                  </div>
                  <h3>Push notifications</h3>
                  <p>
                    Receive entry and exit alerts on this browser or installed
                    PWA.
                  </p>
                  <div className="setting-action">
                    <span>
                      {pushEnabled
                        ? 'Enabled on this device'
                        : 'Not enabled on this device'}
                    </span>
                    <button className="outline-btn" onClick={enablePush}>
                      {pushEnabled ? 'Enable again' : 'Enable notifications'}
                    </button>
                  </div>
                </section>
                <section className="surface setting-card">
                  <div className="setting-icon">
                    <ShieldCheck size={19} />
                  </div>
                  <h3>Privacy & consent</h3>
                  <p>
                    LOCATR does not silently locate people. Every person must
                    accept an invitation and turn on location sharing.
                  </p>
                  <span className="privacy-pill">
                    <Check size={13} /> Consent-first by design
                  </span>
                </section>
                <section className="surface setting-card">
                  <div className="setting-icon">
                    <Smartphone size={19} />
                  </div>
                  <h3>Android companion</h3>
                  <p>
                    Reliable background geofencing requires a native Android
                    companion with explicit background-location permission.
                  </p>
                  <span className="coming-pill">NEXT DEVELOPMENT PHASE</span>
                </section>
                <section className="surface setting-card">
                  <div className="setting-icon">
                    <Globe2 size={19} />
                  </div>
                  <h3>Google Maps</h3>
                  <p>
                    Use Google Maps to find a place, then paste its share link
                    when creating a geofence.
                  </p>
                  <a
                    className="setting-link"
                    href="https://maps.google.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Google Maps <ExternalLink size={14} />
                  </a>
                </section>
              </div>
            </>
          )}
          <footer className="footer">
            <span>
              LOCATR <i>•</i> LOCATION, WITH PERMISSION.
            </span>
            <span>YOUR DATA. YOUR CIRCLE. YOUR CONTROL.</span>
          </footer>
        </div>
      </main>
      {showPlace && (
        <div
          className="modal-backdrop"
          onMouseDown={e => e.target === e.currentTarget && setShowPlace(false)}
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="section-kicker">NEW GEOFENCE</div>
                <h2>Add a location</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowPlace(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="modal-intro">
              Find a place in Google Maps, copy its share link, and paste it
              below.
            </p>
            <div className="maps-search-link">
              <MapPin size={16} /> Search places or choose a pin directly on the map
              <span className="maps-link-note">No need to leave LOCATR</span>
            </div>
            <div className="maps-picker">
              <div className="maps-picker-row">
                <input value={mapsSearchQuery} onChange={e => { setMapsSearchQuery(e.target.value); setSelectedPlace(null); setLat(''); setLng(''); }} onKeyDown={e => { if (e.key === 'Enter') searchGooglePlaces(); }} placeholder="Search home, school, hospital, shop…" />
                <button className="primary-btn" disabled={mapsSearching} onClick={searchGooglePlaces}>{mapsSearching ? 'Searching…' : 'Search'}</button>
              </div>
              <button className="outline-btn current-location-btn" disabled={mapsSearching} onClick={chooseCurrentLocation}><LocateFixed size={15} /> Use my current location</button>
              {mapsResults.map(place => <button className="maps-result" key={place.placeId} onClick={() => chooseGooglePlace(place)}><MapPin size={16}/><span><b>{place.name}</b><small>{place.address}</small></span><Check size={15}/></button>)}
              {selectedPlace && <div className="selected-place"><div className="selected-place-icon"><Check size={16}/></div><div><b>{selectedPlace.name}</b><small>{selectedPlace.address}</small><small>{selectedPlace.lat.toFixed(6)}, {selectedPlace.lng.toFixed(6)}</small></div><button type="button" onClick={() => { setSelectedPlace(null); setLat(''); setLng(''); setPlaceName(''); setPlaceAddress(''); }} aria-label="Clear selected place"><X size={15}/></button></div>}
              <p className="picker-hint">Choose a search result or use your current GPS position. You can edit the location name before saving.</p>
            </div>
            <MapPicker
              position={selectedPlace ? [selectedPlace.lat, selectedPlace.lng] : (lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? [Number(lat), Number(lng)] : null)}
              radius={Number(radius) || 250}
              onPick={({ lat: pickedLat, lng: pickedLng }) => {
                const place: MapPlace = {
                  placeId: 'map-pin',
                  name: placeName.trim() || 'Pinned location',
                  address: placeAddress.trim() || 'Selected on the map',
                  lat: pickedLat,
                  lng: pickedLng,
                };
                setSelectedPlace(place);
                setPlaceName(place.name);
                setPlaceAddress(place.address);
                setLat(String(pickedLat));
                setLng(String(pickedLng));
                setMapsUrl('');
              }}
            />
            <label>
              LOCATION NAME
              <input
                value={placeName}
                onChange={e => setPlaceName(e.target.value)}
                placeholder="e.g. Home, Office, College"
              />
            </label>
            <label>
              ADDRESS / PLACE DESCRIPTION
              <input
                value={placeAddress}
                onChange={e => setPlaceAddress(e.target.value)}
                placeholder="Street, area or city"
              />
            </label>
            <label>
              GOOGLE MAPS SHARE LINK
              <input
                value={mapsUrl}
                onChange={e => { setMapsUrl(e.target.value); setSelectedPlace(null); setLat(''); setLng(''); }}
                placeholder="Paste a maps.app.goo.gl or Google Maps link"
              />
            </label>
            <button type="button" className="outline-btn resolve-map-link" disabled={mapsResolving || !mapsUrl.trim()} onClick={resolveGoogleMapsLink}>
              {mapsResolving ? 'Resolving link…' : 'Resolve Google Maps pin'}
            </button>
            <div className="coord-grid">
              <label>
                LATITUDE
                <input
                  value={lat}
                  onChange={e => setLat(e.target.value)}
                  placeholder="28.XXXXXX"
                  disabled={!!parseMapsLink(mapsUrl) || !!selectedPlace}
                />
              </label>
              <label>
                LONGITUDE
                <input
                  value={lng}
                  onChange={e => setLng(e.target.value)}
                  placeholder="75.XXXXXX"
                  disabled={!!parseMapsLink(mapsUrl) || !!selectedPlace}
                />
              </label>
            </div>
            {parseMapsLink(mapsUrl) && (
              <div className="parsed-note">
                <Check size={14} /> Coordinates detected from Google Maps link.
              </div>
            )}
            <label>
              GEOFENCE RADIUS
              <select value={radius} onChange={e => setRadius(e.target.value)}>
                <option value="100">100 metres</option>
                <option value="250">250 metres</option>
                <option value="500">500 metres</option>
                <option value="1000">1 kilometre</option>
                <option value="2000">2 kilometres</option>
              </select>
            </label>
            <div className="modal-note">
              <ShieldCheck size={15} /> Entry and exit alerts are enabled.
              Actual monitoring begins only when a person has opted in and a
              supported device is connected.
            </div>
            <div className="modal-actions">
              <button
                className="outline-btn"
                onClick={() => setShowPlace(false)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={busy}
                onClick={addPlace}
              >
                {busy ? 'Saving…' : 'Save geofence'} <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
      {showPerson && (
        <div
          className="modal-backdrop"
          onMouseDown={e =>
            e.target === e.currentTarget && setShowPerson(false)
          }
        >
          <div className="modal">
            <div className="modal-head">
              <div>
                <div className="section-kicker">INVITE TO LOCATR</div>
                <h2>Add a person</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowPerson(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="modal-intro">
              Create a private invite code. The person must accept it and enable
              sharing themselves.
            </p>
            <label>
              PERSON'S NAME
              <input
                value={personName}
                onChange={e => setPersonName(e.target.value)}
                placeholder="Enter their name"
              />
            </label>
            <label>
              EMAIL (OPTIONAL)
              <input
                value={personEmail}
                onChange={e => setPersonEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </label>
            <div className="modal-note">
              <ShieldCheck size={15} /> This invitation does not start tracking.
              Location access stays off until the person accepts and grants
              permission.
            </div>
            <div className="modal-actions">
              <button
                className="outline-btn"
                onClick={() => setShowPerson(false)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                disabled={busy}
                onClick={addPerson}
              >
                {busy ? 'Creating…' : 'Create invite'}{' '}
                <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
          <button onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
export default App;
