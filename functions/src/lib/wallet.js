const { getDatabase, ServerValue } = require('firebase-admin/database');
const { HttpsError } = require('firebase-functions/v2/https');

// StreamBet-Market 등 자매 저장소와 동일한 초기 자산 컨벤션 — 단, 이 게임 전용 독립
// 화폐 시스템이라 다른 게임과 잔액을 공유하지 않는다.
const INITIAL_BALANCE = 1000000;

function walletRef(uid) {
  return getDatabase().ref('rocketGame/wallets/' + uid);
}

async function ensureWallet(uid) {
  const ref = walletRef(uid);
  const result = await ref.transaction((current) => {
    if (current) return current;
    return { balance: INITIAL_BALANCE, accountCreatedAt: Date.now() };
  });
  return result.snapshot.val();
}

async function getWallet(uid) {
  return ensureWallet(uid);
}

// ref.transaction()이 같은 지갑 경로에서 실제 값이 있는데도 간헐적으로 current를 null로
// 잘못 인식하는 firebase-admin 버그를 피하기 위해(StreamBet-Market에서 확인된 이슈,
// functions/src/lib/wallet.js 주석 참고) balance 필드만 ServerValue.increment로 원자적으로
// 증감하고, 음수가 되면 되돌리는 방식을 쓴다.
async function adjustBalance(uid, delta) {
  const ref = walletRef(uid).child('balance');
  await ref.set(ServerValue.increment(delta));
  const snap = await ref.get();
  const balance = snap.val() || 0;
  if (balance < 0) {
    await ref.set(ServerValue.increment(-delta)); // 되돌리기
    throw new HttpsError('failed-precondition', '잔액이 부족합니다.');
  }
  return { balance };
}

module.exports = {
  INITIAL_BALANCE,
  walletRef,
  ensureWallet,
  getWallet,
  adjustBalance,
};
