// 카카오 로그인 — 자매 저장소들과 완전히 같은 흐름을 재사용한다.
// linkKakaoAccount Cloud Function은 이미 이 프로젝트(soop-stock-market)에 배포되어
// 있는 함수를 그대로 호출한다(백엔드 새로 안 만듦). 카카오 유저 ID는 Kakao "앱"
// 단위로 스코프되므로, 자매 저장소들과 반드시 같은 JS 키를 써야 기존 kakaoLinks
// 매핑과 연결된다.
(function () {
  var KAKAO_JS_KEY = 'ed4f01d6903ca41d5dc0ab32b6ae143c';
  var btn = document.getElementById('kakao-login-btn');
  if (!btn) return;

  if (typeof Kakao !== 'undefined' && !Kakao.isInitialized()) {
    Kakao.init(KAKAO_JS_KEY);
  }

  btn.addEventListener('click', function () {
    if (typeof Kakao === 'undefined' || !Kakao.isInitialized()) {
      alert('카카오 로그인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    Kakao.Auth.login({
      // 서버는 계정 식별에 카카오 고유 ID만 쓰고 닉네임·프로필은 저장하지 않는다 -
      // 실명 노출을 꺼리는 스트리머 유저의 진입장벽을 낮추기 위해 프로필 동의
      // 항목은 아예 요청하지 않는다.
      success: async function (authObj) {
        try {
          var result = await window.rgLinkKakaoAccount(authObj.access_token);
          if (result.data.action === 'switch') {
            // 카카오 팝업 직후 곧바로 뜨는 confirm()도 firebase-init.js의 구글 로그인과
            // 같은 이유(팝업 종료 직후 "활성 탭 아님" 오판으로 인한 억제)로 조용히
            // 취소될 수 있어 동일한 커스텀 확인 모달을 재사용한다. 로그인 모달을 먼저
            // 안 닫으면 같은 z-index(500)라 로그인 모달이 확인 모달을 가려버린다
            // (2026-09-05, streamer-gallery에서 실제로 재현된 것과 동일한 원인).
            window.rgCloseLoginModal && window.rgCloseLoginModal();
            if (!(await window.rgConfirmModal('이미 연동된 카카오 계정이에요. 그 계정으로 이어서 플레이할까요?\n(이 기기에서 익명으로 쌓인 기록은 옮겨지지 않아요)'))) return;
            await window.rgCompleteAccountSwitch(result.data.customToken);
          } else if (result.data.action === 'linked') {
            alert('✅ 카카오 연동이 완료됐습니다.');
            window.rgCloseLoginModal && window.rgCloseLoginModal();
          } else {
            alert('이미 연동된 계정입니다.');
            window.rgCloseLoginModal && window.rgCloseLoginModal();
          }
        } catch (err) {
          alert('카카오 연동 중 오류가 발생했습니다: ' + (err && err.message ? err.message : err));
        }
      },
      fail: function () {
        alert('카카오 로그인이 취소되었거나 실패했습니다.');
      },
    });
  });
})();
