const { onCall } = require('firebase-functions/v2/https');
const { requireAuth, isAdmin } = require('./lib/auth');

// 클라이언트가 관리자 UI 판별을 위해 호출하는 가벼운 전용 함수 — StreamBet-Market·
// interior-3d-viewer와 동일한 패턴. adminCenter/adminUids는 .read:false라 클라이언트가
// 직접 읽을 수 없으므로, 판별 결과만 반환한다.
const whoAmI = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  return { isAdmin: await isAdmin(uid, email) };
});

module.exports = { whoAmI };
