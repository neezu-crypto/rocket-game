// devbar 게임 링크를 RTDB(devbarLinks, admin-center에서 관리)에서 가져와 하드코딩된
// 링크를 대체한다. 노드가 비어있거나 조회 실패 시 기존 하드코딩된 data-game-id 링크를
// 그대로 둔다(devbar가 통째로 사라지는 사고 방지) — "방송국" 링크는 devbarLinks 대상이
// 아니라 항상 하드코딩 그대로 유지된다. StreamBet-Market과 동일한 패턴(SELF_GAME_ID만
// 이 저장소 기준으로 변경).
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

const SELF_GAME_ID = 'rocketGame';

(async function () {
  try {
    const db = getDatabase();
    const snap = await get(ref(db, 'devbarLinks'));
    const data = snap.val();
    if (!data) return;

    const links = Object.keys(data)
      .filter(function (id) { return id !== SELF_GAME_ID && data[id] && data[id].url; })
      .map(function (id) { return Object.assign({ id: id }, data[id]); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (!links.length) return;

    const track = document.getElementById('devbar-track');
    if (!track) return;
    track.querySelectorAll('a[data-game-id]').forEach(function (el) { el.remove(); });
    links.forEach(function (link) {
      const a = document.createElement('a');
      a.className = 'dev-game-link';
      a.dataset.gameId = link.id;
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = link.label;
      track.appendChild(a);
    });
    window.dispatchEvent(new Event('resize')); // js/devbar.js의 마퀴 재계산 트리거
  } catch (e) {
    console.error('devbar 링크 갱신 실패(기존 링크 유지):', e);
  }
})();
