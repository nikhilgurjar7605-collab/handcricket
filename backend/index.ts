import { router, json, error, requireAuth, db, notifications, secrets } from '@appdeploy/sdk';

const GLOBAL_INVITES = 'locatr_invites_global';
function key(userId: string) { return userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 96); }
function table(prefix: string, userId: string) { return prefix + '_' + key(userId); }
function validText(v: unknown, max = 180): v is string { return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max; }
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
async function updateRecord(t: string, recordId: string, record: Record<string, unknown>) {
  const [old] = await db.get<Record<string, unknown>>(t, [recordId], { consistent: true });
  if (!old) return false;
  const [ok] = await db.update(t, [{ id: recordId, record: { ...old, ...record } }]);
  return !!ok;
}
async function updateOwnerPerson(ownerId: string, personId: string, patch: Record<string, unknown>) {
  const t = table('locatr_people', ownerId);
  const [person] = await db.get<Record<string, unknown>>(t, [personId], { consistent: true });
  if (person) await db.update(t, [{ id: personId, record: { ...person, ...patch } }]);
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ ok: true, service: 'LOCATR' })],

  'POST /api/maps/resolve': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    if (!validText(b.url, 2000)) return error('Paste a valid Google Maps share link first.', 400);
    let parsed: URL;
    try { parsed = new URL(b.url.trim()); } catch { return error('That is not a valid share URL.', 400); }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !['maps.app.goo.gl', 'goo.gl'].includes(host)) {
      return error('Paste a Google Maps short share link, such as maps.app.goo.gl/…', 400);
    }
    const shortPath = parsed.pathname.slice(1, 301);
    if (!shortPath || !/^[a-zA-Z0-9_/-]+$/.test(shortPath)) return error('The Google Maps share link format is not supported.', 400);
    try {
      const shortHost = host === 'goo.gl' ? 'https://goo.gl/' : 'https://maps.app.goo.gl/';
      const response = await fetch(shortHost + shortPath, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LOCATR/1.0)', 'Accept': 'text/html' } });
      const finalUrl = response.url || '';
      const html = response.ok ? (await response.text()).slice(0, 1000000) : '';
      const source = (finalUrl + '\n' + html).replace(/&amp;/g, '&');
      const patterns: Array<{ regex: RegExp; swap?: boolean }> = [
        { regex: /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/ },
        { regex: /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/ },
        { regex: /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/, swap: true },
        { regex: /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/ }
      ];
      for (const pattern of patterns) {
        const match = source.match(pattern.regex);
        if (!match) continue;
        const first = Number(match[1]), second = Number(match[2]);
        const lat = pattern.swap ? second : first;
        const lng = pattern.swap ? first : second;
        if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          let name = 'Shared Google Maps place';
          const placePart = finalUrl.split('/place/')[1];
          if (placePart) {
            try { name = decodeURIComponent(placePart.split('/')[0].split('?')[0].replace(/\+/g, ' ')).slice(0, 100); } catch { /* Use fallback. */ }
          }
          return json({ place: { placeId: 'maps-share-' + lat + '-' + lng, name, address: 'Resolved from your Google Maps share link', lat, lng } });
        }
      }
      return error('Google Maps opened the link but did not expose its pin coordinates. Try Google Maps → Share → Copy link again, or search for the place by name.', 422);
    } catch {
      return error('Could not open this Google Maps share link. Check your connection or search for the place by name.', 502);
    }
  }],

  'GET /api/maps/status': [requireAuth(), async () => {
    const names = await secrets.listSecretNames();
    return json({ configured: names.includes('GOOGLE_MAPS_API_KEY') });
  }],

  'POST /api/maps/search': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    if (!validText(b.query, 140)) return error('Enter a place or address to search.', 400);
    const names = await secrets.listSecretNames();
    if (!names.includes('GOOGLE_MAPS_API_KEY')) return error('Google Maps search is not configured yet. Add a Google Maps API key in AppDeploy secrets.', 503);
    const apiKey = await secrets.readSecret('GOOGLE_MAPS_API_KEY');
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location' },
      body: JSON.stringify({ textQuery: b.query.trim(), maxResultCount: 6 })
    });
    if (!response.ok) return error('Google Places could not complete the search. Check API access and billing.', 502);
    const payload = await response.json() as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } }> };
    const results = (payload.places || []).filter(p => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude)).map(p => ({ placeId: p.id || '', name: p.displayName?.text || 'Selected place', address: p.formattedAddress || '', lat: p.location!.latitude, lng: p.location!.longitude }));
    return json({ places: results });
  }],

  'GET /api/bootstrap': [requireAuth(), async ctx => {
    const uid = ctx.user!.userId;
    const [places, people, events, myShares, livePage] = await Promise.all([
      db.list(table('locatr_places', uid), { limit: 100 }),
      db.list(table('locatr_people', uid), { limit: 100 }),
      db.list(table('locatr_events', uid), { limit: 50 }),
      db.list(table('locatr_shares', uid), { limit: 50 }),
      db.list(table('locatr_live', uid), { limit: 100 })
    ]);
    const live = livePage.items.map(location => {
      const person = people.items.find(p => p.acceptedUserId === location.userId);
      return { ...location, personName: person?.name || location.name || 'Shared member' };
    });
    return json({ places: places.items, people: people.items, events: events.items, myShares: myShares.items, livePeople: live });
  }],

  'POST /api/places': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    if (!validText(b.name, 100) || !validText(b.address, 240)) return error('Enter a valid place name and address.', 400);
    const lat = Number(b.lat), lng = Number(b.lng), radius = Number(b.radius);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return error('Coordinates are invalid.', 400);
    if (![100, 250, 500, 1000, 2000].includes(radius)) return error('Choose a supported radius.', 400);
    const record = { name: b.name.trim(), address: b.address.trim(), lat, lng, radius, events: ['entry', 'exit'], createdAt: new Date().toISOString() };
    const [saved] = await db.add(table('locatr_places', ctx.user!.userId), [record]);
    if (!saved) return error('Could not save this location.', 500);
    return json({ place: { ...record, id: saved } }, 201);
  }],

  'DELETE /api/places/:id': [requireAuth(), async ctx => {
    const [ok] = await db.delete(table('locatr_places', ctx.user!.userId), [ctx.params.id]);
    return ok ? json({ ok: true }) : error('Location not found.', 404);
  }],

  'POST /api/people': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    if (!validText(b.name, 100)) return error('Enter a valid name.', 400);
    if (b.email !== undefined && typeof b.email !== 'string') return error('Invalid email.', 400);
    const ownerId = ctx.user!.userId;
    const person = { name: b.name.trim(), email: typeof b.email === 'string' ? b.email.trim().slice(0, 160) : '', inviteCode: '', status: 'Invite pending', createdAt: new Date().toISOString() };
    const [personId] = await db.add(table('locatr_people', ownerId), [person]);
    if (!personId) return error('Could not create invite.', 500);
    const invite = { ownerId, personId, ownerName: ctx.user!.name || ctx.user!.email || 'A LOCATR user', status: 'pending', createdAt: new Date().toISOString() };
    const [inviteCode] = await db.add(GLOBAL_INVITES, [invite]);
    if (!inviteCode) {
      await db.delete(table('locatr_people', ownerId), [personId]);
      return error('Could not register invitation. Try again.', 500);
    }
    await updateOwnerPerson(ownerId, personId, { inviteCode });
    return json({ inviteCode, person: { ...person, id: personId, inviteCode } }, 201);
  }],

  'POST /api/sharing/accept': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    const code = typeof b.code === 'string' ? b.code.trim() : '';
    if (code.length < 8 || code.length > 100) return error('Enter a valid invitation code.', 400);
    const [invite] = await db.get<Record<string, unknown>>(GLOBAL_INVITES, [code], { consistent: true });
    if (!invite || invite.status !== 'pending') return error('This invitation is invalid, expired, or already used.', 404);
    if (invite.ownerId === ctx.user!.userId) return error('You cannot accept your own invitation.', 400);
    const share = { ownerId: invite.ownerId, ownerName: invite.ownerName, personId: invite.personId, inviteCode: code, status: 'accepted', sharing: false, acceptedAt: new Date().toISOString() };
    const [saved] = await db.add(table('locatr_shares', ctx.user!.userId), [share]);
    if (!saved) return error('Could not accept this invitation.', 409);
    await updateRecord(GLOBAL_INVITES, code, { status: 'accepted', acceptedUserId: ctx.user!.userId, acceptedAt: new Date().toISOString() });
    await updateOwnerPerson(String(invite.ownerId), String(invite.personId), { status: 'Connected', acceptedUserId: ctx.user!.userId, acceptedAt: new Date().toISOString() });
    return json({ ok: true, share: { ...share, id: saved } });
  }],

  'POST /api/sharing/start': [requireAuth(), async ctx => {
    const uid = ctx.user!.userId;
    const page = await db.list(table('locatr_shares', uid), { limit: 50 });
    const accepted = page.items.filter(s => s.status === 'accepted');
    if (!accepted.length) return error('Accept an invitation before sharing your location.', 400);
    for (const share of accepted) {
      await updateRecord(table('locatr_shares', uid), share.id, { sharing: true });
      await updateOwnerPerson(String(share.ownerId), String(share.personId), { status: 'Sharing', acceptedUserId: uid, sharingSince: new Date().toISOString() });
    }
    return json({ ok: true, sharing: true });
  }],

  'POST /api/sharing/stop': [requireAuth(), async ctx => {
    const uid = ctx.user!.userId;
    const page = await db.list(table('locatr_shares', uid), { limit: 50 });
    for (const share of page.items) {
      await updateRecord(table('locatr_shares', uid), share.id, { sharing: false });
      await updateOwnerPerson(String(share.ownerId), String(share.personId), { status: 'Connected' });
      const liveTable = table('locatr_live', String(share.ownerId));
      const livePage = await db.list(liveTable, { limit: 100 });
      const live = livePage.items.find(item => item.userId === uid);
      if (live) await db.delete(liveTable, [live.id]);
    }
    return json({ ok: true, sharing: false });
  }],

  'POST /api/location': [requireAuth(), async ctx => {
    const b = (ctx.body || {}) as Record<string, unknown>;
    const lat = Number(b.lat), lng = Number(b.lng), accuracy = Number(b.accuracy || 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return error('Invalid location coordinates.', 400);
    if (Number.isFinite(accuracy) && accuracy > 10000) return error('Location accuracy is too low to use safely.', 400);
    const uid = ctx.user!.userId;
    const shares = await db.list(table('locatr_shares', uid), { limit: 50 });
    const activeShares = shares.items.filter(s => s.sharing === true && s.status === 'accepted');
    if (!activeShares.length) return error('Location sharing is not enabled.', 403);
    const timestamp = new Date().toISOString();
    for (const share of activeShares) {
      const ownerId = String(share.ownerId);
      const places = await db.list(table('locatr_places', ownerId), { limit: 100 });
      const liveTable = table('locatr_live', ownerId);
      const livePage = await db.list(liveTable, { limit: 100 });
      const oldLive = livePage.items.find(item => item.userId === uid);
      const liveRecord = { userId: uid, name: ctx.user!.name || ctx.user!.email || 'Shared member', lat, lng, accuracy, updatedAt: timestamp };
      if (oldLive) await db.update(liveTable, [{ id: oldLive.id, record: { ...oldLive, ...liveRecord } }]);
      else await db.add(liveTable, [liveRecord]);

      const stateTable = table('locatr_geostate', ownerId + '_' + key(uid));
      const states = await db.list(stateTable, { limit: 100 });
      for (const place of places.items) {
        const meters = distanceMeters(lat, lng, Number(place.lat), Number(place.lng));
        const inside = meters <= Number(place.radius);
        const oldState = states.items.find(s => s.placeId === place.id);
        if (!oldState) {
          await db.add(stateTable, [{ inside, userId: uid, placeId: place.id, updatedAt: timestamp }]);
          continue;
        }
        if (oldState.inside === inside) continue;
        await db.update(stateTable, [{ id: oldState.id, record: { ...oldState, inside, updatedAt: timestamp } }]);
        const kind = inside ? 'entry' : 'exit';
        const personName = ctx.user!.name || ctx.user!.email || 'Shared member';
        const event = { title: personName + (inside ? ' arrived' : ' left'), detail: (inside ? 'Entered ' : 'Exited ') + place.name, kind, personId: uid, personName, placeId: place.id, placeName: place.name, distanceMeters: Math.round(meters), createdAt: timestamp };
        await db.add(table('locatr_events', ownerId), [event]);
        try {
          await notifications.send({ userIds: [ownerId], notification: { title: 'LOCATR · ' + (inside ? 'Arrived' : 'Left'), body: personName + (inside ? ' entered ' : ' left ') + place.name }, data: { kind, placeId: String(place.id), personId: uid } });
        } catch { /* Event history remains available if push delivery is unavailable. */ }
      }
    }
    return json({ ok: true, updatedAt: timestamp, monitoredPlaces: 'active' });
  }],

  'POST /api/test-notification': [requireAuth(), async ctx => {
    const result = await notifications.send({ userIds: [ctx.user!.userId], notification: { title: 'LOCATR test alert', body: 'Notifications are connected on this device.' }, data: { kind: 'test', source: 'locatr' } });
    return json({ ok: true, sent: result.sent, failed: result.failed });
  }]
});