// XSS 방지 — 닉네임에 <, >, 제어문자를 넣어 저장형 스크립트 주입을 시도하는 것을
// 서버에서부터 차단(StreamBet-Market과 동일한 정규식).
const NICKNAME_FORBIDDEN_RE = /[<>\x00-\x1F\x7F]/;

// 프로필(방과 무관한 계정 단위 닉네임/SOOP 아이디) — 둘 다 선택 입력. SOOP_ID_RE는
// StreamBet-Market과 동일 규칙(영문 소문자/숫자 2~20자)이라야 avatarUrlFor 공식이 실제
// SOOP 프로필 이미지 경로와 맞는다.
const PROFILE_NICKNAME_MAX_LENGTH = 12;
const SOOP_ID_RE = /^[a-z0-9]{2,20}$/;

// 관리자 판별 이메일 폴백(자매 저장소들과 동일 — adminCenter/adminUids에 uid가
// 아직 등록 안 됐을 때만 쓰인다).
const ADMIN_EMAIL = 'skftodwocks2@gmail.com';

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
// 폭발 시점 분포 — "5~15초 구간에 50%, 양쪽(1.5~5초/15~30초)에 각 25%"를 정확히 맞추기
// 위해 단일 지수분포 대신 3구간 가중 샘플링을 쓴다(구간 내부는 균등분포).
const ROCKET_CRASH_MID_START_MS = 5000;
const ROCKET_CRASH_MID_END_MS = 15000;
const ROCKET_CRASH_MID_WEIGHT = 0.5; // 나머지 50%는 양쪽 구간에 25%씩 균등 배분
const ROCKET_ASCENT_LINEAR = 8; // height(t) = a·t + b·t² (t=초, a=초반 속도)
const ROCKET_ASCENT_QUADRATIC = 6; // b — 갈수록 가속

module.exports = {
  NICKNAME_FORBIDDEN_RE,
  PROFILE_NICKNAME_MAX_LENGTH,
  SOOP_ID_RE,
  ADMIN_EMAIL,
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
  ROCKET_CRASH_MID_START_MS,
  ROCKET_CRASH_MID_END_MS,
  ROCKET_CRASH_MID_WEIGHT,
  ROCKET_ASCENT_LINEAR,
  ROCKET_ASCENT_QUADRATIC,
};
