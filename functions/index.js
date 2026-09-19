const { initializeApp } = require('firebase-admin/app');
initializeApp();

module.exports = {
  ...require('./src/rocket'),
  ...require('./src/whoami'),
  ...require('./src/profile'),
  ...require('./src/admin'),
  // 공개 미러 트리거·callable만 Cloud Functions로 노출한다. publicIdFor와
  // ensurePublicId는 서버 내부 헬퍼라 export 목록에 넣으면 Firebase CLI가
  // 배포 대상 함수로 오인한다.
  ...((({ syncRocketRoomPublic, getRocketPublicId, migrateRocketPublicIdentityData }) => ({
    syncRocketRoomPublic,
    getRocketPublicId,
    migrateRocketPublicIdentityData,
  }))(require('./src/public-identity'))),
};
