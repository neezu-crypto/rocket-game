const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, assertNotBanned } = require('./lib/auth');
const { avatarUrlFor } = require('./lib/avatar');
const { NICKNAME_FORBIDDEN_RE, PROFILE_NICKNAME_MAX_LENGTH, SOOP_ID_RE } = require('./constants');

// 계정 단위 프로필(방 닉네임과 별개) — 닉네임/SOOP 아이디 둘 다 선택 입력이라 StreamBet-Market의
// updateProfile과 달리 닉네임 필수 검증·닉네임 변경 쿨다운/차단 로직은 없다(이 게임엔 그 정도
// 규모의 닉네임 신고/모더레이션 체계가 없음 — 필요해지면 그때 추가).
const updateProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { nickname, soopId } = request.data || {};
  const name = (nickname || '').trim();
  const rawSoopId = (soopId || '').trim();

  if (name) {
    if (name.length > PROFILE_NICKNAME_MAX_LENGTH) {
      throw new HttpsError('invalid-argument', '닉네임은 ' + PROFILE_NICKNAME_MAX_LENGTH + '자 이하로 입력해 주세요.');
    }
    if (NICKNAME_FORBIDDEN_RE.test(name)) {
      throw new HttpsError('invalid-argument', '닉네임에 사용할 수 없는 문자가 포함되어 있습니다.');
    }
  }
  if (rawSoopId && !SOOP_ID_RE.test(rawSoopId)) {
    throw new HttpsError('invalid-argument', 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.');
  }

  const update = { nickname: name, soopId: rawSoopId, avatarUrl: avatarUrlFor(rawSoopId) };
  await getDatabase().ref('rocketGame/profiles/' + uid).update(update);
  return update;
});

module.exports = { updateProfile };
