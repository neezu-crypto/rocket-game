// 스트리머 인증(구글·카카오를 꺼리는 유저를 위한 대체 계정 보호 경로) —
// requestStreamerVerification은 이 저장소 소스에 없는, 같은 프로젝트에 이미
// 배포된 공용 함수를 그대로 호출한다(신청/재확인을 겸하는 단일 엔드포인트라
// "신청하기"와 "승인됐는지 확인하기" 버튼 둘 다 같은 함수를 부른다 —
// streamer-life-game과 동일 패턴).
(function () {
  var backdrop = document.getElementById('verify-backdrop');
  var closeBtn = document.getElementById('verify-modal-close');
  var form = document.getElementById('verify-form');
  var pending = document.getElementById('verify-pending');
  var pendingText = document.getElementById('verify-pending-text');
  var nicknameInput = document.getElementById('verify-nickname');
  var soopIdInput = document.getElementById('verify-soopid');
  var submitBtn = document.getElementById('verify-submit-btn');
  var checkBtn = document.getElementById('verify-check-btn');
  if (!backdrop) return;

  function openModal() {
    form.style.display = '';
    pending.style.display = 'none';
    nicknameInput.value = '';
    soopIdInput.value = '';
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }
  window.rgOpenVerifyModal = openModal;

  document.addEventListener('click', function (e) {
    if (e.target.closest('#login-verify-btn')) {
      window.rgCloseLoginModal && window.rgCloseLoginModal();
      openModal();
    }
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  function showPending(nickname, isSwitch) {
    form.style.display = 'none';
    pending.style.display = '';
    pendingText.textContent = isSwitch
      ? '"' + nickname + '" 계정 전환 신청이 관리자에게 전달됐어요. 확인 후 이 기기에서도 기존 계정을 이어서 쓸 수 있어요.'
      : '"' + nickname + '" 인증 신청이 관리자에게 전달됐어요. 확인 후 승인해드려요.';
  }

  async function submitOrCheck(data) {
    try {
      var result = await window.rgRequestStreamerVerification(data);
      var action = result.data.action, nickname = result.data.nickname, isSwitch = result.data.isSwitch, customToken = result.data.customToken;
      if (action === 'switch') {
        closeModal();
        await window.rgCompleteAccountSwitch(customToken);
      } else if (action === 'already-verified') {
        // 'switch'와 달리 이 경로는 uid가 그대로라 완전한 페이지 갱신이 필요 없어
        // 보였지만, window.rgIsVerifiedStreamer/rgTrusted는 로그인 시점에 한 번만
        // 계산돼서 여기서 다시 계산해주지 않으면 "인증 완료" 알림만 뜨고 실제로는
        // 화면이 계속 게스트 취급되는 버그가 있었다(2026-09-05, streamer-gallery에서
        // 사용자가 실제 재현). completeAccountSwitch와 동일하게 새로고침한다.
        closeModal();
        alert('✅ 이미 스트리머 인증이 완료된 계정이에요.');
        window.location.reload();
      } else {
        showPending(nickname, isSwitch);
        if (!data.nickname) alert('아직 관리자 확인 전이에요. 잠시 후 다시 확인해주세요.');
      }
    } catch (e) {
      alert('스트리머 인증 처리 중 오류가 발생했습니다: ' + (e.message || e));
    }
  }

  submitBtn.addEventListener('click', function () {
    var nickname = nicknameInput.value.trim();
    if (!nickname) { alert('닉네임을 입력해 주세요.'); return; }
    var soopId = soopIdInput.value.trim();
    if (!/^[a-z0-9]{2,20}$/.test(soopId)) { alert('SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.'); return; }
    submitOrCheck({ nickname: nickname, soopId: soopId });
  });
  checkBtn.addEventListener('click', function () { submitOrCheck({}); });
})();
