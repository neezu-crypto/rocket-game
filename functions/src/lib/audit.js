const { getDatabase } = require('firebase-admin/database');
const { trimToLast } = require('./capped-log');
const { AUDIT_LOG_CAP } = require('../constants');

// 감사 로그는 클라이언트가 아니라 서버(Cloud Functions)가 직접 기록해야 신뢰할 수 있다.
// 삭제 로직 없이 push만 하면 무한히 쌓이므로, 기록할 때마다 최근 AUDIT_LOG_CAP개로 잘라낸다.
async function logAudit(actorUid, actorName, action, detail) {
  const logsRef = getDatabase().ref('rocketGame/auditLog');
  const ref = logsRef.push();
  await ref.set({ actorUid, actorName: actorName || actorUid, action, detail: detail || '', at: Date.now() });
  await trimToLast(logsRef, AUDIT_LOG_CAP);
}

module.exports = { logAudit };
