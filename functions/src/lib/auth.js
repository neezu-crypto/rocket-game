const { HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { ADMIN_EMAIL } = require('../constants');

// uid 위변조 검증 원칙 — 대상 uid는 항상 request.auth.uid에서만 가져온다.
function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

// 페이지 접속 시 자동으로 생성되는 익명 계정은 방 목록 등 공개 데이터를 읽을 수 있게
// 하기 위한 것으로, 재화가 걸린 기능(방 생성·참가·재시작)은 실제(비익명) 계정만 쓸 수
// 있다 — StreamBet-Market과 동일한 원칙(functions/src/lib/auth.js 참고).
function isRealAccount(request) {
  const provider = request.auth && request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
  return provider !== 'anonymous';
}

function requireRealAccount(request) {
  const uid = requireAuth(request);
  if (!isRealAccount(request)) {
    throw new HttpsError('permission-denied', '게스트(익명) 계정은 이 기능을 사용할 수 없습니다. Google 로그인 후 다시 시도해 주세요.');
  }
  return uid;
}

// 정지 계정 확인 — soop-stock-market 자매 저장소들과 공유하는 uid 기준 원장
// (bannedAccounts/{uid}, RTDB 루트)을 그대로 본다. 정지는 기본이 게임별이라 all이
// 없으면 games.rocketGame만 확인한다.
async function assertNotBanned(uid) {
  const db = getDatabase();
  const snap = await db.ref('bannedAccounts/' + uid).get();
  if (!snap.exists()) return;
  const ban = snap.val();
  if (ban.all) {
    throw new HttpsError('permission-denied', '정지된 계정입니다' + (ban.allReason ? ' (사유: ' + ban.allReason + ')' : '') + '.');
  }
  if (ban.games && ban.games.rocketGame) {
    throw new HttpsError('permission-denied', '정지된 계정입니다' + (ban.games.rocketGame.reason ? ' (사유: ' + ban.games.rocketGame.reason + ')' : '') + '.');
  }
}

// 관리자 판별 — StreamBet-Market·soop-stock-market·interior-3d-viewer와 동일하게
// 공유 adminCenter/adminUids uid 조회를 기준으로 하고, uid 미등록 시에만 이메일로
// 폴백한다(admin-center와 같은 전환 방식).
async function isAdminUid(uid) {
  const db = getDatabase();
  const snap = await db.ref('adminCenter/adminUids/' + uid).get();
  return snap.val() === true;
}

async function isAdmin(uid, email) {
  if (await isAdminUid(uid)) return true;
  if (email && email === ADMIN_EMAIL) {
    console.warn('관리자 판별 이메일 폴백 사용됨(uid 미등록):', uid);
    return true;
  }
  return false;
}

// 05번 스트리머 인증 — 공유 streamerVerifications 노드(자매 저장소들과 공유,
// uid로 인덱싱)의 uid로 판별한다.
async function isVerifiedStreamerUid(uid) {
  const db = getDatabase();
  const snap = await db.ref('streamerVerifications').orderByChild('uid').equalTo(uid).limitToFirst(1).get();
  return snap.exists();
}

// 스트리머 인증 제도의 목적 — 구글·카카오 로그인을 꺼리는 스트리머도 관리자 검수만
// 통과하면 로그인 없이(익명 세션이어도) 실계정과 완전히 동일하게 재화가 걸린
// 기능을 쓸 수 있어야 한다(StreamBet-Market의 isTrustedAccount와 동일 원칙).
async function isTrustedAccount(request) {
  if (isRealAccount(request)) return true;
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (await isAdmin(uid, email)) return true;
  return isVerifiedStreamerUid(uid);
}

async function requireTrustedAccount(request) {
  const uid = requireAuth(request);
  if (!(await isTrustedAccount(request))) {
    throw new HttpsError('permission-denied', '게스트(익명) 계정은 이 기능을 사용할 수 없습니다. Google/카카오 로그인 또는 스트리머 인증 후 다시 시도해 주세요.');
  }
  return uid;
}

module.exports = {
  requireAuth,
  requireRealAccount,
  isRealAccount,
  assertNotBanned,
  isAdminUid,
  isAdmin,
  isVerifiedStreamerUid,
  isTrustedAccount,
  requireTrustedAccount,
};
