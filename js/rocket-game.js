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

  // ---------- 방 생성(로비에 바로 노출되는 인라인 폼 — 모달 없음) ----------
  // 기본 닉네임은 프로필(js/profile-modal.js)에 저장해둔 닉네임을 그대로 쓰고, 프로필
  // 닉네임을 아직 저장한 적 없으면 빈칸으로 둔다(로그인 전에는 rg-profile-changed 자체가
  // 안 뜨므로 자연히 빈칸 상태 그대로 유지됨).
  document.addEventListener('rg-profile-changed', function (e) {
    createNicknameInput.value = (e.detail && e.detail.nickname) || '';
  });

  createSubmitBtn.addEventListener('click', function () {
    if (!window.rgTrusted) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
    var nickname = createNicknameInput.value.trim();
    var entryFee = Number(createEntryFeeInput.value);
    if (!nickname) { createStatusEl.textContent = '닉네임을 입력해 주세요.'; return; }
    createSubmitBtn.disabled = true;
    createStatusEl.textContent = '방을 만드는 중...';
    fb.httpsCallable('createRocketRoom')({ nickname: nickname, entryFee: entryFee }).then(function (res) {
      rememberNickname(nickname);
      createSubmitBtn.disabled = false;
      createStatusEl.textContent = '';
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
  var EXPLOSION_DURATION_MS = 900;
  var EXPLOSION_COLORS = ['#ffb347', '#ff6b4a', '#00f2ea', '#a855f7', '#fff6c8'];
  var explosionParticles = [];
  var lastExplosionKey = null; // roomId:launchedAt — 같은 라운드에서 재렌더링될 때 폭발 이펙트를 다시 재생하지 않기 위한 가드.
  var frozenExplosionElapsedMs = 0; // 폭발 순간 카메라를 고정할 고도(elapsedMs) — lastExplosionKey와 함께 갱신.

  function spawnExplosionParticles() {
    explosionParticles = [];
    for (var i = 0; i < 18; i++) {
      var angle = Math.random() * Math.PI * 2;
      explosionParticles.push({
        dx: Math.cos(angle), dy: Math.sin(angle),
        speed: 40 + Math.random() * 80,
        r: 2 + Math.random() * 3,
        color: EXPLOSION_COLORS[i % EXPLOSION_COLORS.length],
      });
    }
  }

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
  // explosionT: undefined면 평소 로켓 렌더링, 0~1이면 그 진행도만큼 폭발 이펙트를 그리고
  // 로켓 몸체/불꽃은 그리지 않는다(로켓 파괴). 카메라 정지 — elapsedMs는 폭발 순간의
  // 고도로 고정된 값이 호출부에서 넘어오므로 이 함수는 그 자리에서만 그린다(더 안 올라감).
  function drawFrame(elapsedMs, escaped, explosionT) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    if (explosionT != null && explosionT < 0.25) {
      // 폭발 초반 짧게 화면 전체가 흔들리는 충격 연출.
      var shakeMag = (0.25 - explosionT) * 40;
      ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
    }

    var sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#020505');
    sky.addColorStop(1, '#0a1c1c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,242,234,0.55)';
    for (var i = 0; i < 40; i++) {
      var sx = (i * 97 + (elapsedMs * 0.01)) % w;
      var sy = (i * 53) % (h * 0.7);
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }

    var groundY = h - 24;
    ctx.fillStyle = '#081210';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.strokeStyle = 'rgba(0,242,234,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(w, groundY); ctx.stroke();

    var dataHeight = heightAtElapsed(elapsedMs);
    var maxScreenRise = h - 110;
    var screenRise = maxScreenRise * (1 - Math.exp(-dataHeight / 420));
    var rocketX = w / 2;
    var rocketY = groundY - screenRise;

    if (explosionT != null) {
      drawExplosion(ctx, rocketX, rocketY, Math.min(1, explosionT));
      ctx.restore();
      return;
    }

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

    ctx.fillStyle = '#00f2ea';
    ctx.beginPath(); ctx.moveTo(-12, -2); ctx.lineTo(-22, 16); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(22, 16); ctx.lineTo(12, 12); ctx.closePath(); ctx.fill();

    ctx.fillStyle = 'rgba(168,85,247,0.9)';
    ctx.beginPath(); ctx.arc(0, -10, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // 로켓 파괴 폭발 이펙트 — 화면 플래시 + 충격파 링 + 코어 파이어볼 + 사방으로 튀는 잔해
  // 파티클. t(0~1)가 1에 가까워질수록 옅어지다가 1을 넘기면(runExplosionLoop가 clamp해서
  // 넘겨줌) 잔해도 다 사그라든 정지 화면만 남는다(카메라 정지 상태 유지).
  function drawExplosion(ctx, x, y, t) {
    var flashAlpha = Math.max(0, 1 - t * 4);
    if (flashAlpha > 0) {
      ctx.fillStyle = 'rgba(255,240,200,' + (flashAlpha * 0.35).toFixed(3) + ')';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    var ringRadius = 10 + t * 90;
    var ringAlpha = Math.max(0, 1 - t);
    if (ringAlpha > 0) {
      ctx.strokeStyle = 'rgba(255,179,71,' + ringAlpha.toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    var coreRadius = Math.max(0, 26 * (1 - t * 0.8));
    if (coreRadius > 0) {
      var coreGrad = ctx.createRadialGradient(x, y, 0, x, y, coreRadius);
      coreGrad.addColorStop(0, 'rgba(255,246,200,' + Math.max(0, 1 - t * 1.2).toFixed(3) + ')');
      coreGrad.addColorStop(0.5, 'rgba(255,140,60,' + Math.max(0, 0.9 - t).toFixed(3) + ')');
      coreGrad.addColorStop(1, 'rgba(226,85,79,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.arc(x, y, coreRadius, 0, Math.PI * 2); ctx.fill();
    }

    var debrisAlpha = Math.max(0, 1 - t);
    if (debrisAlpha > 0) {
      ctx.globalAlpha = debrisAlpha;
      explosionParticles.forEach(function (p) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x + p.dx * t * p.speed, y + p.dy * t * p.speed + t * t * 40, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
  }

  // onFrame(elapsedMs): 매 프레임 그리기와 같은 타이밍에 호출(높이 표시 등). animHandle을
  // 통해 stopCanvasLoop()로 항상 취소되므로, 별도의 독립 requestAnimationFrame 체인을
  // 만들지 않는다(예전엔 높이 갱신용 루프를 따로 돌렸는데, 그 루프는 취소 로직이 없어서
  // 방이 재렌더링될 때마다 새 루프가 추가로 쌓이고 하나도 멈추지 않는 버그가 있었다 —
  // 라운드가 끝난 뒤에도 계속 살아남은 옛 루프가 매 프레임 높이를 계속 갱신해서 폭발
  // 연출/결과 표시와 뒤섞이는 원인이었다).
  function runCanvasLoop(getElapsedMs, isEscaped, onFrame) {
    resizeCanvas();
    function frame() {
      var elapsedMs = getElapsedMs();
      drawFrame(elapsedMs, isEscaped());
      if (onFrame) onFrame(elapsedMs);
      animHandle = requestAnimationFrame(frame);
    }
    frame();
  }

  // 폭발 순간의 고도(frozenElapsedMs)에 카메라를 고정한 채로, 실제 시각 기준
  // animStartAt으로부터 흐른 시간만큼만 폭발 애니메이션 진행도를 계산해 그린다
  // (비행 elapsedMs는 더 이상 흐르지 않음 — 카메라 정지).
  function runExplosionLoop(frozenElapsedMs, animStartAt) {
    resizeCanvas();
    function frame() {
      var t = (Date.now() - animStartAt) / EXPLOSION_DURATION_MS;
      drawFrame(frozenElapsedMs, true, Math.max(0, t));
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
    lastExplosionKey = null;
    frozenExplosionElapsedMs = 0;
    if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
    if (stageEl.__rocketTapHandler) {
      stageEl.removeEventListener('click', stageEl.__rocketTapHandler);
      stageEl.__rocketTapHandler = null;
    }
  }

  // onTap: 탭한 그 순간 바로 호출(체감 지연 없는 즉시 반응 — "탈출하는 중" 표시용).
  // onSuccess/onFail: escapeRocket의 실제 서버 판정 결과가 도착하면 호출된다("탈출 성공!"으로
  // 바꾸거나, 재시도 가능하게 되돌리는 용도). 실제 탈출 유효성 판정은 항상 서버가 한다.
  function attachEscapeHandler(roomId, onTap, onSuccess, onFail) {
    var handler = function () {
      if (onTap) onTap();
      fb.httpsCallable('escapeRocket')({ roomId: roomId }).then(function () {
        if (onSuccess) onSuccess();
      }).catch(function (e) {
        statusMsgEl.textContent = e.message || '탈출에 실패했어요.';
        if (onFail) onFail(e);
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
    if (room.pot) {
      // 발사 이후엔 서버가 확정한 판돈(사람 참가자 수 * 판돈 — 봇은 실제 화폐를 안 냄)을 그대로.
      potReadoutEl.textContent = '판돈 ' + Number(room.pot).toLocaleString('ko-KR') + '원';
    } else if (room.status === 'waiting') {
      // 발사 전엔 서버가 아직 pot을 계산해두지 않으므로, 지금까지 탑승한 사람 수 기준으로
      // 클라이언트가 미리 보여준다(봇은 실제 화폐를 안 내므로 인원 수에서 제외).
      var humanBoardedCount = Object.keys(participants).filter(function (pUid) { return !participants[pUid].isBot; }).length;
      var estimatedPot = humanBoardedCount * Number(room.entryFee || 0);
      potReadoutEl.textContent = '현재 판돈 ' + estimatedPot.toLocaleString('ko-KR') + '원(탑승 ' + humanBoardedCount + '명)';
    } else {
      potReadoutEl.textContent = '';
    }
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
        if (!window.rgTrusted) {
          waitingInfoEl.style.display = '';
          waitingInfoEl.textContent = '로그인(또는 스트리머 인증)하면 탑승할 수 있어요.';
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

    if (room.status === 'flying') {
      var launchedAt = room.launchedAt;
      startPolling(roomId);
      var escaped = !!(me && room.escapes && room.escapes[uid]);
      runCanvasLoop(function () { return Date.now() - launchedAt; }, function () { return escaped; }, function (elapsedMs) {
        heightReadoutEl.textContent = Math.round(heightAtElapsed(elapsedMs)).toLocaleString('ko-KR') + 'm';
      });

      // 탭 → "탈출하는 중"(즉시, 서버 응답 전) → 서버가 실제로 성공 처리하면 "탈출 성공!"으로
      // 바뀐다. 네트워크 지연 때문에 실제로는 폭발 이후(서버 수신 기준)로 판정돼 거절당할 수도
      // 있는데, 그 경우("이미 폭발했습니다")는 곧바로 뒤따라올 resolving/resolved 렌더가 실제
      // 결과로 덮어쓰고, 그 외의 실패(네트워크 오류 등)는 다시 탭할 수 있게 되돌린다.
      var armEscapeTap = function () {
        attachEscapeHandler(roomId, function () {
          if (stageEl.__rocketTapHandler) {
            stageEl.removeEventListener('click', stageEl.__rocketTapHandler);
            stageEl.__rocketTapHandler = null;
          }
          tapHintEl.style.display = 'none';
          waitingInfoEl.style.display = '';
          waitingInfoEl.textContent = '탈출하는 중...';
        }, function () {
          // 캔버스 루프가 매 프레임 escaped 변수를 다시 읽으므로, 여기서 true로 바꾸면
          // 다음 프레임부터 곧장 '탈출' 상태(불꽃 꺼짐)로 그려진다.
          escaped = true;
          waitingInfoEl.textContent = '탈출 성공! 결과를 기다리는 중...';
        }, function (e) {
          if (e && /이미 폭발/.test(e.message || '')) {
            waitingInfoEl.textContent = '이미 폭발했어요...';
            return;
          }
          if (currentRoomId !== roomId) return; // 이미 다른 방으로 이동함
          waitingInfoEl.style.display = 'none';
          tapHintEl.style.display = '';
          armEscapeTap();
        });
        tapHintEl.style.display = '';
      };
      if (me && !escaped) {
        armEscapeTap();
      } else if (!me) {
        var reserved = room.spectators && room.spectators[uid] && room.spectators[uid].wantsNextRound;
        spectateReserveBtn.style.display = '';
        spectateReserveBtn.textContent = reserved ? '다음 라운드 참가 예약 취소' : '다음 라운드 참가 예약';
        spectateReserveBtn.onclick = function () {
          if (!window.rgTrusted) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
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

    // resolving/resolved — 로켓이 폭발한 순간. 서버는 status를 flying→resolving(정산
    // 진행 중)→resolved(정산 완료) 순으로 전이시키는데, escapeRocket은 status가 flying이
    // 아니면 즉시 거절하므로(functions/src/rocket.js) 탈출 가능 여부는 이미 그 시점부터
    // 서버에서 막혀 있다 — 클라이언트도 같은 순간부터(resolving부터) 탈출 버튼/힌트를
    // 없애고 높이를 그 자리에 고정해 서버 판정과 화면이 어긋나지 않게 한다. resolving을
    // resolved와 동일하게 취급해 폭발 연출을 즉시 재생하고, 최종 정산 문구만 resolution
    // 필드가 도착한 뒤(=resolved) 채운다.
    stopPolling();
    heightReadoutEl.textContent = '💥 폭발!';
    var res = room.resolution || {};
    var explosionKey = roomId + ':' + room.launchedAt;
    if (lastExplosionKey !== explosionKey) {
      lastExplosionKey = explosionKey;
      frozenExplosionElapsedMs = Math.min(MAX_FLIGHT_MS, Math.max(0, Date.now() - room.launchedAt));
      spawnExplosionParticles();
      runExplosionLoop(frozenExplosionElapsedMs, Date.now());
    } else {
      // 이미 재생한 라운드(재렌더링) — 애니메이션을 다시 재생하지 않고 다 사그라든
      // 정지 화면만 유지한다.
      runExplosionLoop(frozenExplosionElapsedMs, Date.now() - EXPLOSION_DURATION_MS - 1);
    }
    resultBannerEl.style.display = '';
    if (room.status === 'resolving') {
      resultBannerEl.textContent = '💥 폭발! 정산 중...';
    } else if (res.winnerUid && !res.isBot) {
      resultBannerEl.textContent = '👑 ' + res.winnerNickname + '님이 ' + Number(res.amount).toLocaleString('ko-KR') + '원을 획득했습니다!';
    } else if (res.winnerUid && res.isBot) {
      resultBannerEl.textContent = '🤖 봇(' + res.winnerNickname + ')이 마지막까지 버텨 판돈이 사라졌습니다.';
    } else {
      resultBannerEl.textContent = '💥 아무도 탈출하지 못해 판돈이 사라졌습니다.';
    }
    if (isHost && room.status === 'resolved') restartBtn.style.display = '';
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
    if (!window.rgTrusted) { window.rgOpenLoginModal && window.rgOpenLoginModal(); return; }
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
