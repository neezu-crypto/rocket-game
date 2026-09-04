const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');

// 게임별 정지 관리(2026-09-05 추가, 신규 게임 온보딩 체크리스트) — StreamBet-Market의
// banAccount/unbanAccount와 동일 패턴이지만 이름은 다르게 짓는다. Cloud Functions
// 리소스 이름은 codebase로 네임스페이스되지 않아(2026-09-04 whoAmI 충돌 사고로 확인)
// banAccount/unbanAccount는 이미 StreamBet-Market이 선점 중이라 그대로 쓰면 그 함수를
// 덮어쓴다. bannedAccounts/{uid}/games/rocketGame에 쓰고, assertNotBanned(lib/auth.js)가
// 이미 이 경로를 읽고 있으므로 별도 검증 로직 변경은 필요 없다 — 지금까지는 이 경로에
// 값을 쓸 방법 자체가 없었을 뿐.
async function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!(await isAdmin(uid, email))) {
    throw new HttpsError('permission-denied', '관리자만 사용할 수 있습니다.');
  }
  return uid;
}

const banRocketGameAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid, reason } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (!reason || !reason.trim()) throw new HttpsError('invalid-argument', '정지 사유를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/rocketGame').set({
    reason: reason.trim(),
    bannedAt: Date.now(),
    bannedBy: adminUid,
    bannedByName: adminName,
  });
  await logAudit(adminUid, adminName, '계정 정지', uid + ' · ' + reason.trim());
  return { status: 'banned' };
});

const unbanRocketGameAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || adminUid;
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/rocketGame').remove();
  await logAudit(adminUid, adminName, '계정 정지 해제', uid);
  return { status: 'unbanned' };
});

module.exports = { banRocketGameAccount, unbanRocketGameAccount };
