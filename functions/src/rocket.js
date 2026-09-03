const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireRealAccount, assertNotBanned, isAdmin } = require('./lib/auth');
const { ensureWallet, adjustBalance } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const {
  ROCKET_ENTRY_STEP,
  ROCKET_ENTRY_MIN,
  ROCKET_ENTRY_MAX,
  ROCKET_ROOM_NICKNAME_MAX_LENGTH,
  ROCKET_MAX_PARTICIPANTS,
  ROCKET_BOT_COUNT_MIN,
  ROCKET_BOT_COUNT_MAX,
  ROCKET_MIN_FLIGHT_MS,
  ROCKET_MAX_FLIGHT_MS,
  ROCKET_CRASH_LAMBDA,
  NICKNAME_FORBIDDEN_RE,
} = require('./constants');

// 로켓 크래시 게임 — 승자독식(마지막 탈출자가 판돈 전액 획득) 겜블링 미니게임.
// 하우스 수수료를 따로 떼지 않는 대신, 방마다 고정 2~3명의 봇이 실제 참가자처럼 경쟁하되
// 실제 화폐는 갖지 않는다 — 봇이 마지막 탈출자가 되면 그 라운드의 판돈(사람이 낸 진짜
// 화폐)은 누구에게도 지급되지 않고 그대로 사라진다(순환에서 빠짐). 반대로 사람이 이기면
// 사람이 낸 판돈만 정상적으로 지급되므로, 이 구조는 어떤 경우에도 화폐를 새로 만들어내지
// 않는다(늘 안전).
const ROOMS_PATH = 'rocketGame/rooms';
const SECRETS_PATH = 'rocketGame/roomsSecrets';

function roomRef(roomId) { return getDatabase().ref(ROOMS_PATH + '/' + roomId); }
function secretRef(roomId) { return getDatabase().ref(SECRETS_PATH + '/' + roomId); }

function validateNickname(nickname) {
  const name = (nickname || '').trim();
  if (!name || name.length > ROCKET_ROOM_NICKNAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', '닉네임은 1~' + ROCKET_ROOM_NICKNAME_MAX_LENGTH + '자로 입력해 주세요.');
  }
  if (NICKNAME_FORBIDDEN_RE.test(name)) {
    throw new HttpsError('invalid-argument', '닉네임에 사용할 수 없는 문자가 포함되어 있습니다.');
  }
  return name;
}

function validateEntryFee(entryFee) {
  const fee = Number(entryFee);
  if (!Number.isFinite(fee) || fee < ROCKET_ENTRY_MIN || fee > ROCKET_ENTRY_MAX || fee % ROCKET_ENTRY_STEP !== 0) {
    throw new HttpsError(
      'invalid-argument',
      '판돈은 ' + ROCKET_ENTRY_MIN.toLocaleString('ko-KR') + '원 단위로 ' + ROCKET_ENTRY_MAX.toLocaleString('ko-KR') + '원 이하로 입력해 주세요.'
    );
  }
  return fee;
}

// 폭발 시점(ms) — 지수분포 역변환 샘플링 후 [MIN,MAX]로 clamp. 발사 시 한 번만 뽑아
// rocketGame/roomsSecrets에만 저장 — 클라이언트가 미리 알면 "폭발 직전에만 탈출"하는
// 치팅이 가능해지므로 라운드가 끝나기 전까지는 절대 공개하지 않는다.
function sampleCrashElapsedMs() {
  const u = Math.random();
  const raw = -Math.log(1 - u) / ROCKET_CRASH_LAMBDA;
  return Math.min(Math.max(Math.round(raw), ROCKET_MIN_FLIGHT_MS), ROCKET_MAX_FLIGHT_MS);
}

// 봇 탈출 시점 — 완전 무작위, 폭발 시점과 무관하게 균등분포로 미리 고정.
function sampleBotEscapeMs() {
  return Math.round(Math.random() * ROCKET_MAX_FLIGHT_MS);
}

function randomBotCount() {
  return ROCKET_BOT_COUNT_MIN + Math.floor(Math.random() * (ROCKET_BOT_COUNT_MAX - ROCKET_BOT_COUNT_MIN + 1));
}

const BOT_NAME_POOL = ['우주비행사', '파일럿', '탐험가', '베테랑', '신입', '조종사', '도전자', '관측병', '항해사', '승무원'];
function randomBotNickname(i) {
  return BOT_NAME_POOL[i % BOT_NAME_POOL.length];
}

function buildBotsForRoom(roomId) {
  const count = randomBotCount();
  const bots = {};
  for (let i = 0; i < count; i++) {
    bots['bot-' + roomId + '-' + i] = randomBotNickname(i);
  }
  return bots;
}

// 방 생성 — 호스트가 판돈을 걸고 자동 탑승, 방마다 고정 봇도 함께 탑승(봇은 실제 화폐를
// 내지 않음 — 위 파일 상단 주석 참고).
const createRocketRoom = onCall(async (request) => {
  const uid = requireRealAccount(request);
  await assertNotBanned(uid);
  await ensureWallet(uid);
  const { nickname, entryFee } = request.data || {};
  const hostNickname = validateNickname(nickname);
  const fee = validateEntryFee(entryFee);

  const ref = getDatabase().ref(ROOMS_PATH).push();
  const roomId = ref.key;
  const bots = buildBotsForRoom(roomId);

  await adjustBalance(uid, -fee); // 잔액 부족 시 여기서 예외 발생, 방은 아직 안 만들어짐

  const participants = {
    [uid]: { nickname: hostNickname, boardedAt: Date.now(), isBot: false, isHost: true },
  };
  Object.keys(bots).forEach((botUid) => {
    participants[botUid] = { nickname: bots[botUid], boardedAt: Date.now(), isBot: true, isHost: false };
  });

  await ref.set({
    hostUid: uid,
    hostNickname,
    entryFee: fee,
    status: 'waiting',
    createdAt: Date.now(),
    participants,
  });
  return { roomId };
});

// 참가 — waiting 상태일 때만.
const joinRocketRoom = onCall(async (request) => {
  const uid = requireRealAccount(request);
  await assertNotBanned(uid);
  await ensureWallet(uid);
  const { roomId, nickname } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');
  const roomName = validateNickname(nickname);

  const snap = await roomRef(roomId).get();
  if (!snap.exists()) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  const room = snap.val();
  if (room.status !== 'waiting') throw new HttpsError('failed-precondition', '지금은 참가할 수 없는 방입니다(이미 출발했어요).');
  if (room.participants && room.participants[uid]) throw new HttpsError('failed-precondition', '이미 탑승 중입니다.');
  const participantCount = Object.keys(room.participants || {}).length;
  if (participantCount >= ROCKET_MAX_PARTICIPANTS) {
    throw new HttpsError('failed-precondition', '방이 가득 찼습니다.');
  }

  await adjustBalance(uid, -room.entryFee);
  await roomRef(roomId).child('participants').child(uid).set({
    nickname: roomName,
    boardedAt: Date.now(),
    isBot: false,
    isHost: false,
  });
  return { ok: true };
});

// 관전 중 "다음 라운드 참가 예약" — 과금 없음, 표시만 해두고 launchRocketRoom이 자동 처리.
const spectateNextRound = onCall(async (request) => {
  const uid = requireRealAccount(request);
  await assertNotBanned(uid);
  const { roomId, nickname, wantsNextRound } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');

  const snap = await roomRef(roomId).get();
  if (!snap.exists()) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  const room = snap.val();
  if (room.status !== 'flying') throw new HttpsError('failed-precondition', '지금은 관전 예약이 필요 없는 방입니다.');

  if (wantsNextRound === false) {
    await roomRef(roomId).child('spectators').child(uid).remove();
    return { ok: true };
  }
  const roomName = validateNickname(nickname);
  await roomRef(roomId).child('spectators').child(uid).set({ nickname: roomName, wantsNextRound: true });
  return { ok: true };
});

// 발사 — 호스트만. 폭발 시점/봇 탈출 시점을 이 순간 뽑아 시크릿 노드에 고정하고,
// "다음 라운드 참가 예약"해둔 관전자를 자동으로 탑승시킨다(잔액 부족 시 조용히 제외).
const launchRocketRoom = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { roomId } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');

  const snap = await roomRef(roomId).get();
  if (!snap.exists()) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  const room = snap.val();
  if (room.hostUid !== uid) throw new HttpsError('permission-denied', '호스트만 발사할 수 있습니다.');
  if (room.status !== 'waiting') throw new HttpsError('failed-precondition', '지금은 발사할 수 없는 상태입니다.');

  const participants = Object.assign({}, room.participants || {});
  const spectators = room.spectators || {};
  const autoJoinedUids = Object.keys(spectators).filter((sUid) => spectators[sUid] && spectators[sUid].wantsNextRound);
  for (const sUid of autoJoinedUids) {
    if (participants[sUid]) continue; // 이미 어떤 경로로든 탑승 중이면 건너뜀
    if (Object.keys(participants).length >= ROCKET_MAX_PARTICIPANTS) break;
    try {
      await ensureWallet(sUid);
      await adjustBalance(sUid, -room.entryFee);
      participants[sUid] = { nickname: spectators[sUid].nickname, boardedAt: Date.now(), isBot: false, isHost: false };
    } catch (e) {
      // 잔액 부족 등으로 자동 참가 실패 — 조용히 제외(방송 흐름을 막지 않음)
    }
  }

  const botEscapePlans = {};
  Object.keys(participants).forEach((pUid) => {
    if (participants[pUid].isBot) botEscapePlans[pUid] = sampleBotEscapeMs();
  });
  const humanCount = Object.keys(participants).filter((pUid) => !participants[pUid].isBot).length;
  const pot = humanCount * room.entryFee;

  await secretRef(roomId).set({ crashElapsedMs: sampleCrashElapsedMs(), botEscapePlans });
  await roomRef(roomId).update({
    status: 'flying',
    launchedAt: Date.now(),
    participants,
    spectators: null,
    pot,
    escapes: null,
    resolution: null,
  });
  return { ok: true };
});

// 발사 이후 라운드 진행 상태를 점검하는 공용 헬퍼 — escapeRocket/pollRocketRoom 양쪽에서 호출.
// 1) 이미 폭발 시점을 지난 봇들의 탈출을 공개 로그(escapes)에 뒤늦게 반영(사전 노출 방지 —
//    실제로 그 시점이 지나야만 기록한다) 2) 폭발 시점 자체가 지났으면 정산을 트리거.
async function checkRoomProgress(roomId) {
  const [roomSnap, secretSnap] = await Promise.all([roomRef(roomId).get(), secretRef(roomId).get()]);
  if (!roomSnap.exists() || !secretSnap.exists()) return null;
  const room = roomSnap.val();
  if (room.status !== 'flying') return room;
  const secret = secretSnap.val();
  const elapsedMs = Date.now() - room.launchedAt;
  const escapes = room.escapes || {};

  const botReveals = {};
  Object.keys(secret.botEscapePlans || {}).forEach((botUid) => {
    const escapeMs = secret.botEscapePlans[botUid];
    if (escapeMs <= elapsedMs && !escapes[botUid] && room.participants[botUid]) {
      botReveals[botUid] = { escapedAtMs: escapeMs, nickname: room.participants[botUid].nickname, isBot: true };
    }
  });
  if (Object.keys(botReveals).length) {
    await roomRef(roomId).child('escapes').update(botReveals);
    Object.assign(escapes, botReveals);
  }

  if (elapsedMs < secret.crashElapsedMs) return Object.assign({}, room, { escapes });

  // 폭발 시점이 지났다 — 정산 트리거. increment 카운터로 "정확히 1번만" 가드하면
  // 카운터가 1을 넘는 순간 두 번 다시 1이 될 수 없어(여러 요청이 동시에 몰리면) 그
  // 라운드가 영영 정산되지 못하는 문제가 있다(로컬 fakedb 테스트로 실제 재현됨).
  // 대신 status 필드 자체를 'flying'→'resolving'으로 트랜잭션 전이시켜, 이 전이에
  // 실제로 성공한(committed && 결과가 'resolving') 호출 단 하나만 정산을 진행하고
  // 나머지는 자연히 빠진다 — 카운터 방식과 달리 다음 폴링에서 항상 다시 시도 가능.
  const statusTx = await roomRef(roomId).child('status').transaction((current) => {
    if (current !== 'flying') return; // undefined 반환 = 트랜잭션 중단(다른 호출이 이미 처리 중)
    return 'resolving';
  });
  if (!statusTx.committed || statusTx.snapshot.val() !== 'resolving') {
    return Object.assign({}, room, { escapes }); // 이미 다른 호출이 정산 처리 중/완료
  }

  let winnerUid = null;
  let winnerBest = -1;
  Object.keys(escapes).forEach((pUid) => {
    const e = escapes[pUid];
    if (e && e.escapedAtMs > winnerBest) {
      winnerBest = e.escapedAtMs;
      winnerUid = pUid;
    }
  });

  const resolvedAt = Date.now();
  if (!winnerUid) {
    // 전멸 — 판돈은 그대로 소멸(사용자 확정), 추가 처리 없음.
    await roomRef(roomId).update({ status: 'resolved', resolution: { winnerUid: null, amount: 0, resolvedAt } });
  } else {
    const winner = room.participants[winnerUid];
    if (winner.isBot) {
      // 봇이 마지막 탈출자 — 판돈(실제 화폐)은 누구에게도 지급하지 않고 소멸.
      await roomRef(roomId).update({
        status: 'resolved',
        resolution: { winnerUid, winnerNickname: winner.nickname, isBot: true, amount: 0, resolvedAt },
      });
    } else {
      await adjustBalance(winnerUid, room.pot);
      await roomRef(roomId).update({
        status: 'resolved',
        resolution: { winnerUid, winnerNickname: winner.nickname, isBot: false, amount: room.pot, resolvedAt },
      });
      await logAudit(winnerUid, winner.nickname, '로켓 게임 우승', room.pot.toLocaleString('ko-KR') + '원');
    }
  }
  const finalSnap = await roomRef(roomId).get();
  return finalSnap.val();
}

// 탈출 — flying 상태일 때만, 서버가 수신한 시각으로만 판정한다(클라이언트 시각 불신).
const escapeRocket = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { roomId } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');

  const preSnap = await roomRef(roomId).get();
  if (!preSnap.exists()) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  const preRoom = preSnap.val();
  if (!preRoom.participants || !preRoom.participants[uid]) {
    throw new HttpsError('permission-denied', '이 방에 탑승하지 않았습니다.');
  }
  if (preRoom.status === 'waiting') throw new HttpsError('failed-precondition', '아직 발사 전입니다.');
  if (preRoom.escapes && preRoom.escapes[uid]) throw new HttpsError('failed-precondition', '이미 탈출했습니다.');

  const secretSnap = await secretRef(roomId).get();
  const secret = secretSnap.val() || {};
  const launchedAt = preRoom.launchedAt;
  const now = Date.now();
  const elapsedMs = now - launchedAt;

  if (preRoom.status !== 'flying' || elapsedMs >= secret.crashElapsedMs) {
    await checkRoomProgress(roomId); // 아직 정산 안 됐으면 이 호출로 정산 트리거
    throw new HttpsError('failed-precondition', '이미 폭발했습니다.');
  }

  await roomRef(roomId).child('escapes').child(uid).set({
    escapedAtMs: elapsedMs,
    nickname: preRoom.participants[uid].nickname,
    isBot: false,
  });
  return { elapsedMs };
});

// 가벼운 상태 점검 — 아무도 escapeRocket을 안 불러도 폭발 시점이 지나면 누군가의 폴링으로
// 정산이 트리거되도록 클라이언트가 주기적으로 호출한다.
const pollRocketRoom = onCall(async (request) => {
  requireAuth(request);
  const { roomId } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');
  const room = await checkRoomProgress(roomId);
  if (!room) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  return { status: room.status };
});

// 재시작 — 호스트만, resolved 상태에서만. 호스트가 다시 탑승비를 내고 새 라운드를 연다.
const restartRocketRoom = onCall(async (request) => {
  const uid = requireRealAccount(request);
  await assertNotBanned(uid);
  await ensureWallet(uid);
  const { roomId } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');

  const snap = await roomRef(roomId).get();
  if (!snap.exists()) throw new HttpsError('not-found', '방을 찾을 수 없습니다.');
  const room = snap.val();
  if (room.hostUid !== uid) throw new HttpsError('permission-denied', '호스트만 재시작할 수 있습니다.');
  if (room.status !== 'resolved') throw new HttpsError('failed-precondition', '지금은 재시작할 수 없는 상태입니다.');

  await adjustBalance(uid, -room.entryFee);
  const bots = buildBotsForRoom(roomId + '-r' + Date.now());
  const participants = {
    [uid]: { nickname: room.hostNickname, boardedAt: Date.now(), isBot: false, isHost: true },
  };
  Object.keys(bots).forEach((botUid) => {
    participants[botUid] = { nickname: bots[botUid], boardedAt: Date.now(), isBot: true, isHost: false };
  });

  await secretRef(roomId).remove();
  await roomRef(roomId).update({
    status: 'waiting',
    launchedAt: null,
    participants,
    spectators: null,
    escapes: null,
    pot: null,
    resolution: null,
  });
  return { ok: true };
});

// 방 닫기 — 호스트만, waiting 상태에서만(비행 중 이탈은 정산 붕괴 우려로 막음). 탑승한
// 사람(호스트 포함)에게 탑승비를 환불하고 방을 삭제한다.
const closeRocketRoom = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { roomId } = request.data || {};
  if (!roomId) throw new HttpsError('invalid-argument', '방을 찾을 수 없습니다.');

  const snap = await roomRef(roomId).get();
  if (!snap.exists()) return { ok: true }; // 이미 없음
  const room = snap.val();
  // 관리자는 통합관리센터(adminCenter/adminUids) 판정으로 호스트가 아니어도, 비행
  // 중이어도 강제로 방을 닫을 수 있다(악용/방치된 방 정리용) — 그 외엔 호스트만,
  // waiting 상태에서만 가능(정산 붕괴 방지).
  const isAdminCaller = await isAdmin(uid, request.auth.token && request.auth.token.email);
  if (room.hostUid !== uid && !isAdminCaller) {
    throw new HttpsError('permission-denied', '호스트만 방을 닫을 수 있습니다.');
  }
  if (room.status !== 'waiting' && !isAdminCaller) {
    throw new HttpsError('failed-precondition', '비행 중에는 방을 닫을 수 없습니다. 라운드가 끝난 뒤 다시 시도해 주세요.');
  }

  const participants = room.participants || {};
  for (const pUid of Object.keys(participants)) {
    if (participants[pUid].isBot) continue;
    await adjustBalance(pUid, room.entryFee); // 환불
  }

  await secretRef(roomId).remove();
  await roomRef(roomId).remove();
  if (isAdminCaller && room.hostUid !== uid) {
    const actorName = (request.auth.token && request.auth.token.name) || uid;
    await logAudit(uid, actorName, '로켓 게임 방 강제 종료', '호스트: ' + room.hostNickname);
  }
  return { ok: true };
});

module.exports = {
  createRocketRoom,
  joinRocketRoom,
  spectateNextRound,
  launchRocketRoom,
  escapeRocket,
  pollRocketRoom,
  restartRocketRoom,
  closeRocketRoom,
};
