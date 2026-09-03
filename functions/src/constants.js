// XSS 방지 — 닉네임에 <, >, 제어문자를 넣어 저장형 스크립트 주입을 시도하는 것을
// 서버에서부터 차단(StreamBet-Market과 동일한 정규식).
const NICKNAME_FORBIDDEN_RE = /[<>\x00-\x1F\x7F]/;

const AUDIT_LOG_CAP = 200; // "최근 처리 내역" — 이 개수를 넘는 오래된 항목은 매 기록 시 삭제

// 로켓 크래시 게임 — 승자독식(마지막 탈출자가 판돈 전액 획득) 겜블링 미니게임.
// 하우스 수수료를 따로 떼지 않는 대신, 방마다 고정 2~3명의 봇이 실제 참가자처럼
// 경쟁하되 실제 화폐는 갖지 않는다 — 봇이 마지막 탈출자가 되면 그 라운드의 판돈은
// 누구에게도 지급되지 않고 사라진다(순환에서 빠짐).
const ROCKET_ENTRY_STEP = 10000; // 판돈 입력 단위
const ROCKET_ENTRY_MIN = 10000;
const ROCKET_ENTRY_MAX = 1000000;
const ROCKET_ROOM_NICKNAME_MAX_LENGTH = 6; // 방 전용 짧은 닉네임(프로필 개념 없음 — 이 값이 유일한 닉네임)
const ROCKET_MAX_PARTICIPANTS = 20; // UI 렌더링 성능 소프트 캡
const ROCKET_BOT_COUNT_MIN = 2;
const ROCKET_BOT_COUNT_MAX = 3; // 방마다 2~3명 고정
const ROCKET_MIN_FLIGHT_MS = 1500; // 즉시 폭발 방지 하한
const ROCKET_MAX_FLIGHT_MS = 30000; // 라운드 길이 상한(30초)
const ROCKET_CRASH_LAMBDA = 1 / 8000; // 폭발 시점 지수분포 파라미터(중앙값 약 5.5초, MAX로 clamp)
const ROCKET_ASCENT_LINEAR = 8; // height(t) = a·t + b·t² (t=초, a=초반 속도)
const ROCKET_ASCENT_QUADRATIC = 6; // b — 갈수록 가속

module.exports = {
  NICKNAME_FORBIDDEN_RE,
  AUDIT_LOG_CAP,
  ROCKET_ENTRY_STEP,
  ROCKET_ENTRY_MIN,
  ROCKET_ENTRY_MAX,
  ROCKET_ROOM_NICKNAME_MAX_LENGTH,
  ROCKET_MAX_PARTICIPANTS,
  ROCKET_BOT_COUNT_MIN,
  ROCKET_BOT_COUNT_MAX,
  ROCKET_MIN_FLIGHT_MS,
  ROCKET_MAX_FLIGHT_MS,
  ROCKET_CRASH_LAMBDA,
  ROCKET_ASCENT_LINEAR,
  ROCKET_ASCENT_QUADRATIC,
};
