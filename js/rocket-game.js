// 🚀 로켓 게임 — 승자독식 겜블링 미니게임. 서버(functions/src/rocket.js)가 폭발 시점을
// 발사 순간 비공개로 미리 정해두고, 클라이언트는 그 시점을 몰라도 되도록 height(t)
// 공식만으로 로켓 상승을 로컬 렌더링한다(실제 탈출 유효성은 항상 서버 판정).
(function () {
  if (!window.rgFirebase) return;
  var fb = window.rgFirebase;

  // 서버(functions/src/constants.js)의 ROCKET_ASCENT_LINEAR/QUADRATIC과 같은 값 —
  // 번들러 없는 정적 HTML 구조라 상수를 공유할 수 없어 그대로 복제해둔다.
  var ASCENT_LINEAR = 8;
  var ASCENT_QUADRATIC = 6;
  var MAX_FLIGHT_MS = 30000;
  var POLL_INTERVAL_MS = 1500;
  var NICKNAME_STORAGE_KEY = 'rgRocketNickname';

  var lobbyListEl = document.getElementById('rocket-room-list');
  var lobbyEl = document.getElementById('rocket-lobby');
  var roomScreenEl = document.getElementById('rocket-room-screen');
  var roomTitleEl = document.getElementById('rocket-room-title');
  var backBtn = document.getElementById('rocket-back-to-lobby');
  var closeRoomBtn = document.getElementById('rocket-close-room-btn');
  var canvas = document.getElementById('rocket-canvas');
  var stageEl = document.getElementById('rocket-stage');
  var heightReadoutEl = document.getElementById('rocket-height-readout');
  var potReadoutEl = document.getElementById('rocket-pot-readout');
  var escapeLogEl = document.getElementById('rocket-escape-log');
  var resultBannerEl = document.getElementById('rocket-result-banner');
  var tapHintEl = document.getElementById('rocket-tap-hint');
  var boardingFormEl = document.getElementById('rocket-boarding-form');
  var joinNicknameInput = document.getElementById('rocket-join-nickname');
  var joinSubmitBtn = document.getElementById('rocket-join-submit-btn');
  var waitingInfoEl = document.getElementById('rocket-waiting-info');
  var launchBtn = document.getElementById('rocket-launch-btn');
  var spectateReserveBtn = document.getElementById('rocket-spectate-reserve-btn');
  var restartBtn = document.getElementById('rocket-restart-btn');
  var statusMsgEl = document.getElementById('rocket-room-status-msg');
  var openCreateModalBtn = document.getElementById('open-rocket-create-modal');
  var createBackdrop = document.getElementById('rocket-create-backdrop');
  var createModalCloseBtn = document.getElementById('rocket-create-modal-close');
  var createNicknameInput = document.getElementById('rocket-create-nickname');
  var createEntryFeeInput = document.getElementById('rocket-create-entry-fee');
  var createSubmitBtn = document.getElementById('rocket-create-submit-btn');
  var createStatusEl = document.getElementById('rocket-create-status');
  if (!lobbyListEl || !roomScreenEl || !canvas) return;

  function rememberNickname(name) { try { localStorage.setItem(NICKNAME_STORAGE_KEY, name); } catch (e) {} }
  function recalledNickname() { try { return localStorage.getItem(NICKNAME_STORAGE_KEY) || ''; } catch (e) { return ''; } }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function heightAtElapsed(elapsedMs) {
    var t = elapsedMs / 1000;
    return Math.max(0, ASCENT_LINEAR * t + ASCENT_QUADRATIC * t * t);
  }

  // ---------- 로비(방 목록) ----------
  function statusLabel(status) {
    if (status === 'waiting') return { text: '탑승 중', cls: 'rocket-badge-waiting' };
    if (status === 'flying' || status === 'resolving') return { text: '비행 중 · 관전 가능', cls: 'rocket-badge-flying' };
    return { text: '종료', cls: 'rocket-badge-resolved' };
  }

  function renderRoomList(rooms) {
    var ids = Object.keys(rooms || {}).sort(function (a, b) { return (rooms[b].createdAt || 0) - (rooms[a].createdAt || 0); });
    if (!ids.length) {
      lobbyListEl.innerHTML = '<p class="empty-msg">아직 열린 방이 없어요. 첫 방을 만들어보세요!</p>';
      return;
    }
    lobbyListEl.innerHTML = ids.map(function (roomId) {
      var room = rooms[roomId];
      var humanCount = Object.keys(room.participants || {}).filter(function (uid) { return !room.participants[uid].isBot; }).length;
      var botCount = Object.keys(room.participants || {}).filter(function (uid) { return room.participants[uid].isBot; }).length;
      var badge = statusLabel(room.status);
      return '<div class="rocket-room-card" data-room-id="' + roomId + '">' +
        '<div class="rocket-room-card-head"><b>' + escapeHtml(room.hostNickname) + '</b>님의 방' +
        '<span class="rocket-badge ' + badge.cls + '">' + badge.text + '</span></div>' +
        '<div class="rocket-room-card-meta">판돈 ' + Number(room.entryFee).toLocaleString('ko-KR') + '원 · 탑승 ' + humanCount + '명(+봇 ' + botCount + ')</div>' +
        '</div>';
    }).join('');
    lobbyListEl.querySelectorAll('.rocket-room-card').forEach(function (card) {
      card.addEventListener('click', function () { openRoom(card.getAttribute('data-room-id')); });
    });
  }

  fb.onValue(fb.ref(window.rgDb, 'rocketGame/rooms'), function (snap) {
    renderRoomList(snap.val());
  });

  // ---------- 방 생성 모달 ----------
  function openCreateModal() {
    if (!window.rgRealUser) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
    createNicknameInput.value = recalledNickname();
    createEntryFeeInput.value = '10000';
    createStatusEl.textContent = '';
    createBackdrop.classList.add('open');
  }
  function closeCreateModal() { createBackdrop.classList.remove('open'); }
  if (openCreateModalBtn) openCreateModalBtn.addEventListener('click', openCreateModal);
  if (createModalCloseBtn) createModalCloseBtn.addEventListener('click', closeCreateModal);
  createBackdrop.addEventListener('click', function (e) { if (e.target === createBackdrop) closeCreateModal(); });

  createSubmitBtn.addEventListener('click', function () {
    var nickname = createNicknameInput.value.trim();
    var entryFee = Number(createEntryFeeInput.value);
    if (!nickname) { createStatusEl.textContent = '닉네임을 입력해 주세요.'; return; }
    createSubmitBtn.disabled = true;
    createStatusEl.textContent = '방을 만드는 중...';
    fb.httpsCallable('createRocketRoom')({ nickname: nickname, entryFee: entryFee }).then(function (res) {
      rememberNickname(nickname);
      createSubmitBtn.disabled = false;
      closeCreateModal();
      openRoom(res.data.roomId);
    }).catch(function (e) {
      createSubmitBtn.disabled = false;
      createStatusEl.textContent = e.message || '방 만들기에 실패했어요.';
    });
  });

  // ---------- 방 화면 ----------
  var currentRoomId = null;
  var unsubscribeRoom = null;
  var pollTimer = null;
  var animHandle = null;
  var particles = [];

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function startPolling(roomId) {
    stopPolling();
    pollTimer = setInterval(function () {
      fb.httpsCallable('pollRocketRoom')({ roomId: roomId }).catch(function () {});
    }, POLL_INTERVAL_MS);
  }

  function stopCanvasLoop() { if (animHandle) { cancelAnimationFrame(animHandle); animHandle = null; } }

  function resizeCanvas() {
    var rect = stageEl.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  // "고화질" 로켓 몸체+불꽃을 순수 Canvas 2D로 그린다(번들러 없는 정적 HTML 구조라
  // 외부 이미지/엔진 대신 직접 드로잉). screenY는 데이터상 고도(height)와 별개로
  // 화면 안에서 점근적으로만 상승하게 매핑해, 라운드가 길어져도 로켓이 항상 화면
  // 안에 보이면서 "끝없이 올라간다"는 느낌을 준다.
  function drawFrame(elapsedMs, escaped) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1030');
    sky.addColorStop(1, '#1b2550');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var i = 0; i < 40; i++) {
      var sx = (i * 97 + (elapsedMs * 0.01)) % w;
      var sy = (i * 53) % (h * 0.7);
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    var groundY = h - 24;
    ctx.fillStyle = '#12331f';
    ctx.fillRect(0, groundY, w, h - groundY);

    var dataHeight = heightAtElapsed(elapsedMs);
    var maxScreenRise = h - 110;
    var screenRise = maxScreenRise * (1 - Math.exp(-dataHeight / 420));
    var rocketX = w / 2;
    var rocketY = groundY - screenRise;

    if (!escaped) {
      var flicker = 0.75 + 0.25 * Math.sin(elapsedMs / 60);
      var flameLen = 34 * flicker;
      var grad = ctx.createLinearGradient(rocketX, rocketY + 20, rocketX, rocketY + 20 + flameLen);
      grad.addColorStop(0, '#fff6c8');
      grad.addColorStop(0.4, '#ffb347');
      grad.addColorStop(1, 'rgba(226,85,79,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(rocketX - 9, rocketY + 20);
      ctx.quadraticCurveTo(rocketX, rocketY + 20 + flameLen, rocketX + 9, rocketY + 20);
      ctx.closePath();
      ctx.fill();

      if (Math.random() < 0.6) {
        particles.push({ x: rocketX + (Math.random() - 0.5) * 10, y: rocketY + 24, vy: 1.2 + Math.random(), r: 2 + Math.random() * 2, life: 1 });
      }
    }
    particles.forEach(function (p) {
      p.y += p.vy; p.life -= 0.035;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = '#ffcf6b';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    particles = particles.filter(function (p) { return p.life > 0; });

    ctx.save();
    ctx.translate(rocketX, rocketY);
    var bodyGrad = ctx.createLinearGradient(-12, 0, 12, 0);
    bodyGrad.addColorStop(0, '#8b93a1');
    bodyGrad.addColorStop(0.5, '#eef0f2');
    bodyGrad.addColorStop(1, '#8b93a1');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.quadraticCurveTo(12, -10, 12, 12);
    ctx.lineTo(-12, 12);
    ctx.quadraticCurveTo(-12, -10, 0, -34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(11,13,16,0.35)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = '#d9a441';
    ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-22, 16); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(22, 16); ctx.lineTo(12, 12); ctx.closePath(); ctx.fill();

    ctx.fillStyle = 'rgba(63,182,137,0.85)';
    ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function runCanvasLoop(getElapsedMs, isEscaped) {
    resizeCanvas();
    function frame() {
      drawFrame(getElapsedMs(), isEscaped());
      animHandle = requestAnimationFrame(frame);
    }
    frame();
  }

  function renderEscapeLog(room) {
    var escapes = room.escapes || {};
    var winnerUid = room.resolution && room.resolution.winnerUid;
    var rows = Object.keys(escapes).map(function (uid) { return Object.assign({ uid: uid }, escapes[uid]); })
      .sort(function (a, b) { return b.escapedAtMs - a.escapedAtMs; });
    if (!rows.length) { escapeLogEl.innerHTML = '<p class="empty-msg">아직 탈출한 사람이 없어요.</p>'; return; }
    escapeLogEl.innerHTML = rows.map(function (r) {
      var isWinner = r.uid === winnerUid;
      return '<div class="rocket-escape-row' + (isWinner ? ' rocket-escape-winner' : '') + '">' +
        '<span>' + (isWinner ? '👑 ' : '') + escapeHtml(r.nickname) + (r.isBot ? ' 🤖' : '') + '</span>' +
        '<span>' + Math.round(heightAtElapsed(r.escapedAtMs)).toLocaleString('ko-KR') + 'm</span></div>';
    }).join('');
  }

  function tearDownRoomView() {
    stopPolling();
    stopCanvasLoop();
    particles = [];
    if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
    if (stageEl.__rocketTapHandler) {
      stageEl.removeEventListener('click', stageEl.__rocketTapHandler);
      stageEl.__rocketTapHandler = null;
    }
  }

  function attachEscapeHandler(roomId) {
    var handler = function () {
      fb.httpsCallable('escapeRocket')({ roomId: roomId }).catch(function (e) {
        statusMsgEl.textContent = e.message || '탈출에 실패했어요.';
      });
    };
    stageEl.__rocketTapHandler = handler;
    stageEl.addEventListener('click', handler);
  }

  function renderRoom(room, roomId) {
    var uid = window.rgUser && window.rgUser.uid;
    var participants = room.participants || {};
    var me = uid && participants[uid];
    var isHost = uid && room.hostUid === uid;
    // 통합관리센터 관리자는 호스트가 아니어도, 비행 중이어도 방을 강제로 닫을 수 있다
    // (서버 closeRocketRoom도 동일하게 허용 — functions/src/rocket.js 참고).
    var isAdmin = !!window.rgIsAdmin;

    roomTitleEl.textContent = room.hostNickname + '님의 방 · 판돈 ' + Number(room.entryFee || 0).toLocaleString('ko-KR') + '원';
    potReadoutEl.textContent = room.pot ? '판돈 ' + Number(room.pot).toLocaleString('ko-KR') + '원' : '';
    closeRoomBtn.textContent = isHost ? '방 닫기' : '방 강제 종료(관리자)';
    closeRoomBtn.style.display = (isAdmin || (isHost && room.status === 'waiting')) ? '' : 'none';
    boardingFormEl.style.display = 'none';
    waitingInfoEl.style.display = 'none';
    launchBtn.style.display = 'none';
    spectateReserveBtn.style.display = 'none';
    restartBtn.style.display = 'none';
    resultBannerEl.style.display = 'none';
    tapHintEl.style.display = 'none';
    statusMsgEl.textContent = '';
    renderEscapeLog(room);

    if (stageEl.__rocketTapHandler) {
      stageEl.removeEventListener('click', stageEl.__rocketTapHandler);
      stageEl.__rocketTapHandler = null;
    }
    stopCanvasLoop();

    if (room.status === 'waiting') {
      heightReadoutEl.textContent = '발사 대기 중';
      runCanvasLoop(function () { return 0; }, function () { return true; });
      if (!me) {
        if (!window.rgRealUser) {
          waitingInfoEl.style.display = '';
          waitingInfoEl.textContent = 'Google 로그인하면 탑승할 수 있어요.';
        } else {
          boardingFormEl.style.display = '';
          joinNicknameInput.value = recalledNickname();
        }
      } else if (isHost) {
        launchBtn.style.display = '';
        waitingInfoEl.style.display = '';
        waitingInfoEl.textContent = '탑승 인원이 준비되면 발사하세요.';
      } else {
        waitingInfoEl.style.display = '';
        waitingInfoEl.textContent = '호스트가 발사할 때까지 기다려 주세요.';
      }
      return;
    }

    if (room.status === 'flying' || room.status === 'resolving') {
      // 'resolving'은 서버가 승자를 계산하는 아주 짧은 찰나의 중간 상태 — 화면은
      // 그냥 비행 중과 동일하게 보여준다(곧바로 resolved로 넘어감).
      var launchedAt = room.launchedAt;
      startPolling(roomId);
      var escaped = !!(me && room.escapes && room.escapes[uid]);
      runCanvasLoop(function () { return Date.now() - launchedAt; }, function () { return escaped; });
      var loopHeight = function () {
        if (!roomScreenEl || roomScreenEl.style.display === 'none') return;
        var elapsed = Date.now() - launchedAt;
        heightReadoutEl.textContent = Math.round(heightAtElapsed(elapsed)).toLocaleString('ko-KR') + 'm';
        requestAnimationFrame(loopHeight);
      };
      loopHeight();

      if (me && !escaped) {
        attachEscapeHandler(roomId);
        tapHintEl.style.display = '';
      } else if (!me) {
        var reserved = room.spectators && room.spectators[uid] && room.spectators[uid].wantsNextRound;
        spectateReserveBtn.style.display = '';
        spectateReserveBtn.textContent = reserved ? '다음 라운드 참가 예약 취소' : '다음 라운드 참가 예약';
        spectateReserveBtn.onclick = function () {
          if (!window.rgRealUser) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
          var nickname = reserved ? '' : (recalledNickname() || room.hostNickname);
          fb.httpsCallable('spectateNextRound')({ roomId: roomId, nickname: nickname, wantsNextRound: !reserved }).catch(function (e) {
            statusMsgEl.textContent = e.message || '처리에 실패했어요.';
          });
        };
      } else if (escaped) {
        waitingInfoEl.style.display = '';
        waitingInfoEl.textContent = '탈출했어요! 결과를 기다리는 중...';
      }
      return;
    }

    // resolved
    heightReadoutEl.textContent = '라운드 종료';
    var res = room.resolution || {};
    runCanvasLoop(function () { return MAX_FLIGHT_MS; }, function () { return true; });
    resultBannerEl.style.display = '';
    if (res.winnerUid && !res.isBot) {
      resultBannerEl.textContent = '👑 ' + res.winnerNickname + '님이 ' + Number(res.amount).toLocaleString('ko-KR') + '원을 획득했습니다!';
    } else if (res.winnerUid && res.isBot) {
      resultBannerEl.textContent = '🤖 봇(' + res.winnerNickname + ')이 마지막까지 버텨 판돈이 사라졌습니다.';
    } else {
      resultBannerEl.textContent = '💥 아무도 탈출하지 못해 판돈이 사라졌습니다.';
    }
    if (isHost) restartBtn.style.display = '';
  }

  function openRoom(roomId) {
    tearDownRoomView();
    currentRoomId = roomId;
    lobbyEl.style.display = 'none';
    roomScreenEl.style.display = '';
    unsubscribeRoom = fb.onValue(fb.ref(window.rgDb, 'rocketGame/rooms/' + roomId), function (snap) {
      if (!snap.exists()) {
        statusMsgEl.textContent = '방이 닫혔습니다.';
        setTimeout(backToLobby, 1200);
        return;
      }
      renderRoom(snap.val(), roomId);
    });
  }

  function backToLobby() {
    tearDownRoomView();
    currentRoomId = null;
    roomScreenEl.style.display = 'none';
    lobbyEl.style.display = '';
  }
  backBtn.addEventListener('click', backToLobby);
  window.addEventListener('resize', function () { if (currentRoomId) resizeCanvas(); });

  joinSubmitBtn.addEventListener('click', function () {
    if (!window.rgRealUser) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
    var nickname = joinNicknameInput.value.trim();
    if (!nickname) { statusMsgEl.textContent = '닉네임을 입력해 주세요.'; return; }
    joinSubmitBtn.disabled = true;
    fb.httpsCallable('joinRocketRoom')({ roomId: currentRoomId, nickname: nickname }).then(function () {
      rememberNickname(nickname);
      joinSubmitBtn.disabled = false;
    }).catch(function (e) {
      joinSubmitBtn.disabled = false;
      statusMsgEl.textContent = e.message || '탑승에 실패했어요.';
    });
  });

  launchBtn.addEventListener('click', function () {
    launchBtn.disabled = true;
    fb.httpsCallable('launchRocketRoom')({ roomId: currentRoomId }).catch(function (e) {
      launchBtn.disabled = false;
      statusMsgEl.textContent = e.message || '발사에 실패했어요.';
    });
  });

  restartBtn.addEventListener('click', function () {
    restartBtn.disabled = true;
    fb.httpsCallable('restartRocketRoom')({ roomId: currentRoomId }).catch(function (e) {
      restartBtn.disabled = false;
      statusMsgEl.textContent = e.message || '재시작에 실패했어요.';
    });
  });

  closeRoomBtn.addEventListener('click', function () {
    if (!confirm('정말 방을 닫으시겠어요? 탑승한 사람 전원에게 탑승비가 환불됩니다.')) return;
    closeRoomBtn.disabled = true;
    fb.httpsCallable('closeRocketRoom')({ roomId: currentRoomId }).then(function () {
      backToLobby();
    }).catch(function (e) {
      closeRoomBtn.disabled = false;
      statusMsgEl.textContent = e.message || '방 닫기에 실패했어요.';
    });
  });
})();
