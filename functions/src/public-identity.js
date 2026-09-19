const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onValueWritten } = require('firebase-functions/v2/database');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isAdmin } = require('./lib/auth');

function publicIdFor(uid) {
  return `ROC-${crypto.createHash('sha256').update(`rocket:${uid}`).digest('base64url').slice(0, 14)}`;
}
async function ensurePublicId(db, uid) {
  const id = publicIdFor(uid);
  await db.ref(`privateUserIds/rocket/byUid/${uid}`).set(id);
  await db.ref(`privateUserIds/rocket/byPublicId/${id}`).set(uid);
  return id;
}
function sanitizeMap(map, field) {
  const out = {};
  Object.entries(map || {}).forEach(([uid, value]) => {
    const copy = Object.assign({}, value || {});
    delete copy.uid;
    out[publicIdFor(uid)] = copy;
  });
  return out;
}
const syncRocketRoomPublic = onValueWritten('rocketGame/rooms/{roomId}', async (event) => {
  const db = getDatabase();
  if (!event.data.after.exists()) {
    await db.ref(`rocketGame/roomsPublic/${event.params.roomId}`).remove();
    return;
  }
  const source = event.data.after.val() || {};
  const publicRoom = Object.assign({}, source);
  if (source.hostUid) {
    publicRoom.hostPublicId = publicIdFor(source.hostUid);
    delete publicRoom.hostUid;
    await ensurePublicId(db, source.hostUid);
  }
  publicRoom.participants = sanitizeMap(source.participants, 'participants');
  publicRoom.spectators = sanitizeMap(source.spectators, 'spectators');
  publicRoom.escapes = sanitizeMap(source.escapes, 'escapes');
  if (source.resolution) {
    publicRoom.resolution = Object.assign({}, source.resolution);
    if (source.resolution.winnerUid) {
      publicRoom.resolution.winnerPublicId = publicIdFor(source.resolution.winnerUid);
      delete publicRoom.resolution.winnerUid;
      await ensurePublicId(db, source.resolution.winnerUid);
    }
  }
  await db.ref(`rocketGame/roomsPublic/${event.params.roomId}`).set(publicRoom);
});
const getRocketPublicId = onCall(async (request) => ({ publicId: await ensurePublicId(getDatabase(), requireAuth(request)) }));
const migrateRocketPublicIdentityData = onCall(async (request) => {
  const uid = requireAuth(request);
  if (!(await isAdmin(uid, request.auth.token && request.auth.token.email))) throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  const db = getDatabase();
  const snap = await db.ref('rocketGame/rooms').get();
  for (const child of Object.values(snap.val() || {})) {
    if (child && child.hostUid) await ensurePublicId(db, child.hostUid);
  }
  const updates = {};
  for (const [roomId, source] of Object.entries(snap.val() || {})) {
    if (!source) continue;
    const publicRoom = Object.assign({}, source);
    if (source.hostUid) { publicRoom.hostPublicId = publicIdFor(source.hostUid); delete publicRoom.hostUid; }
    publicRoom.participants = sanitizeMap(source.participants);
    publicRoom.spectators = sanitizeMap(source.spectators);
    publicRoom.escapes = sanitizeMap(source.escapes);
    if (source.resolution) {
      publicRoom.resolution = Object.assign({}, source.resolution);
      if (source.resolution.winnerUid) { publicRoom.resolution.winnerPublicId = publicIdFor(source.resolution.winnerUid); delete publicRoom.resolution.winnerUid; }
    }
    updates[`rocketGame/roomsPublic/${roomId}`] = publicRoom;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { migrated: Object.keys(updates).length };
});
module.exports = { publicIdFor, ensurePublicId, syncRocketRoomPublic, getRocketPublicId, migrateRocketPublicIdentityData };
