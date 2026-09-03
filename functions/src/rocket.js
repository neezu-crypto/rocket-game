const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireTrustedAccount, assertNotBanned, isAdmin } = require('./lib/auth');
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
  ROCKET_CRASH_MID_START_MS,
  ROCKET_CRASH_MID_END_MS,
  ROCKET_CRASH_MID_WEIGHT,
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

// 폭발 시점(ms) — 3구간 가중 샘플링(1.5~5초 25% / 5~15초 50% / 15~30초 25%, 각 구간
// 내부는 균등분포)으로 뽑는다. 발사 시 한 번만 뽑아 rocketGame/roomsSecrets에만 저장 —
// 클라이언트가 미리 알면 "폭발 직전에만 탈출"하는 치팅이 가능해지므로 라운드가 끝나기
// 전까지는 절대 공개하지 않는다.
function sampleCrashElapsedMs() {
  const sideWeight = (1 - ROCKET_CRASH_MID_WEIGHT) / 2;
  const u = Math.random();
  if (u < sideWeight) {
    return Math.round(ROCKET_MIN_FLIGHT_MS + Math.random() * (ROCKET_CRASH_MID_START_MS - ROCKET_MIN_FLIGHT_MS));
  }
  if (u < sideWeight + ROCKET_CRASH_MID_WEIGHT) {
    return Math.round(ROCKET_CRASH_MID_START_MS + Math.random() * (ROCKET_CRASH_MID_END_MS - ROCKET_CRASH_MID_START_MS));
  }
  return Math.round(ROCKET_CRASH_MID_END_MS + Math.random() * (ROCKET_MAX_FLIGHT_MS - ROCKET_CRASH_MID_END_MS));
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
  const uid = await requireTrustedAccount(request);
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
  const uid = await requireTrustedAccount(request);
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
  const uid = await requireTrustedAccount(request);
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
    // 봇의 예정 탈출 시각이 실제 폭발 시각(secret.crashElapsedMs)보다 늦으면 그 봇은
    // 로켓이 터지기 전에 탈출하지 못한 것이다 — 탈출 기록을 남기면 안 된다. 이 체크가
    // 없으면 "폭발 후 시각에 탈출한 걸로 기록된 봇"이 승자 판정에서 실제로 폭발 전에
    // 탈출한 사람보다 더 늦게(더 높게) 잘못 집계돼 진짜 승자 대신 뽑히는 사고가 생긴다
    // (실제 운영에서 발생 확인 — 사람이 6.4초에 탈출했는데 21.7초에 "탈출"한 걸로
    // 기록된 봇이 승자로 뽑혀 판돈이 잘못 소멸될 뻔함).
    if (escapeMs <= elapsedMs && escapeMs <= secret.crashElapsedMs && !escapes[botUid] && room.participants[botUid]) {
      botReveals[botUid] = { escapedAtMs: escapeMs, nickname: room.participants[botUid].nickname, isBot: true };
    }
  });
  if (Object.keys(botReveals).length) {
    await roomRef(roomId).child('escapes').update(botReveals);
    Object.assign(escapes, botReveals);
  }

  console.log('[rocket] 폭발 시점 지남, 정산 시도', {
    roomId, elapsedMs, crashElapsedMs: secret.crashElapsedMs, launchedAt: room.launchedAt,
  });

  // 폭발 시점이 지났다 — 정산 트리거. status 필드를 'flying'→'resolving'으로
  // transaction() 전이시켜, 이 전이에 실제로 성공한(committed && 결과가 'resolving')
  // 호출 단 하나만 정산을 진행하고 나머지는 자연히 빠진다(increment 카운터 방식은
  // "1번만 진행"을 보장하려다 되레 정산 담당자가 죽으면 그 라운드가 영영 정산 못 되는
  // 문제가 있어서 기각 — 로컬 fakedb 테스트로 실제 재현됨).
  //
  // current가 null로 오는 경우에 대한 방어: 실제 운영에서 이 트랜잭션 콜백이 같은 경로에
  // 실제로 'flying' 값이 있는데도 간헐적으로 current를 null로 잘못 인식하는 firebase-admin
  // 버그가 확인됐다(functions/src/lib/wallet.js의 adjustBalance 주석과 동일 증상 —
  // firebase database:get으로 직접 조회하면 status:"flying"이 뚜렷한데 콜백은 계속 null을
  // 봐서 "이미 처리 중"으로 오판, 라운드가 영영 정산되지 못하는 실사고가 있었다). 이 콜백이
  // 처음 이 경로를 읽는 게 아니라(위에서 이미 이 room을 통째로 get()해서 status가 정말
  // 'flying'이었음을 확인한 뒤라서), current가 null이면 그 오탐으로 보고 이미 검증된
  // room.status를 대신 신뢰한다. current가 null이 아닌 다른 값(예: 'resolving'/'resolved')
  // 이면 그건 다른 호출이 이미 성공적으로 바꿔놓은 진짜 최신 정보이므로 그대로 존중해서
  // 중단한다 — transaction()의 쓰기 충돌 시 자동 재시도가 실제 최신 값으로 콜백을 다시
  // 부르는 표준 동작이라, 동시 호출 중 실제로 먼저 성공한 쪽이 있다면 이 콜백은 결국 그
  // 정확한 값을 보게 된다(재시도 자체가 아니라 "처음 읽은 값이 틀렸다"는 것만 버그였음).
  const statusTx = await roomRef(roomId).child('status').transaction((current) => {
    const effectiveCurrent = current === null ? 'flying' : current;
    if (effectiveCurrent !== 'flying') return; // undefined 반환 = 트랜잭션 중단(다른 호출이 이미 처리 중/완료)
    return 'resolving';
  });
  console.log('[rocket] 정산 트랜잭션 결과', {
    roomId, committed: statusTx.committed, resultStatus: statusTx.snapshot.val(),
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
  const uid = await requireTrustedAccount(request);
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
