## 이 프로젝트의 위치

`rocket-game`은 승자독식(마지막 탈출자가 판돈 전액 획득) 겜블링 미니게임 단일 목적
사이트다. StreamBet-Market·streamer-life-game·soop-stock-market·interior-3d-viewer와
**같은 Firebase 프로젝트(`soop-stock-market`)와 같은 RTDB(`soop-stock-market-default-rtdb`)를
공유**하지만, 독립된 화폐 시스템(`rocketGame/wallets/*`, 초기 자산 100만원)을 갖는다 —
다른 게임과 잔액을 공유하지 않는다.

## 커밋·푸시

- 커밋을 완료하면 별도로 push 여부를 다시 묻지 않고 바로 `git push`까지 진행한다. 커밋
  자체를 언제 할지는 별개 — 사용자가 명시적으로 요청했을 때만 커밋한다는 원칙은 그대로다.

## 구현 후 검증 필수

- 코드를 구현한 뒤 배포·커밋으로 넘어가기 전에 반드시 검증 단계를 거친다. 필드명·파라미터명·
  상태값을 추측하지 말고 실제로 그 데이터를 쓰는 소스 코드를 재확인한다.
- 특히 화폐(지갑 잔액)가 걸린 로직은 `functions/src/lib/wallet.js`의 `ensureWallet`을
  빼먹으면 지갑이 없는 계정의 첫 액션이 항상 실패한다(실제로 한 번 발생했던 버그) —
  잔액을 건드리는 모든 새 Function은 시작부에 `ensureWallet(uid)`를 호출하는지 확인.
- 동시 요청 가드는 증가 카운터(`increment` 후 값이 정확히 1인지 확인) 방식을 쓰지 말 것 —
  카운터가 1을 넘는 순간 다시 1이 될 수 없어 영구 정산 불가 상태에 빠질 수 있다(실제로
  재현되어 `status` 필드 자체를 트랜잭션으로 전이시키는 방식으로 교체했다). 새로운 "정확히
  한 번만 처리" 로직이 필요하면 이 트랜잭션 락 패턴을 그대로 재사용할 것.

## Firebase Functions 배포 주의사항

- 이 저장소의 `functions/`는 `firebase.json`에서 `"codebase": "rocketgame"`으로 격리돼 있다 —
  같은 프로젝트를 쓰는 다른 앱(StreamBet-Market·soop-stock-market은 `default` 코드베이스,
  streamer-life-game은 `lifegame`, interior-3d-viewer는 `presetgallery`, streamer-gallery는
  `gallery`)의 함수와 절대 섞이지 않는다. 그래도 안전하게
  `firebase deploy --only functions:rocketgame:<함수명>,...` 형태로 변경/추가한 함수만
  지정해서 배포한다(코드베이스 접두사 포함).
- **주의(2026-09-04 실제 발생): `codebase`는 firebase-tools가 로컬에서 "어느 소스가 어느
  배포 단위인지" 구분하는 개념일 뿐, 실제 GCP에 배포되는 Cloud Function 리소스 이름은
  codebase로 네임스페이스되지 않는다 — 프로젝트+리전 전체에서 함수 이름이 유일해야 한다.**
  이 저장소의 `whoAmI`가 streamer-gallery의 `whoAmI`(둘 다 같은 이름으로 export)에 실제로
  한 번 덮어써진 적 있음(로직이 우연히 동일해서 기능 손상은 없었음, 이름을
  `galleryCheckAdmin`으로 바꿔서 해결). 새 함수를 추가할 때 이름이 다른 자매 저장소와
  겹치지 않는지 `firebase functions:list --project soop-stock-market`으로 먼저 확인할 것.

## database.rules.json 동기화 필수 (2026-09-04 갱신)

- 이 파일은 같은 RTDB를 공유하는 6개 저장소(StreamBet-Market·soop-stock-market·
  streamer-life-game·interior-3d-viewer·rocket-game·streamer-gallery)가 전부 바이트
  단위로 동일한 사본을 갖고 있어야 한다. 이 중 아무 저장소에서나 재배포하면 그 저장소
  로컬 파일 내용으로 실제 서버 규칙이 통째로 덮어써지기 때문 — 하나만 고치고 넘어가면
  나중에 다른 저장소에서 무심코 재배포했을 때 방금 추가한 변경이 조용히 사라진다.
- **이 파일을 수정할 때마다 나머지 5개 저장소의 `database.rules.json`에도 동일한 변경을
  그대로 복사(`cp`)해서 diff 0줄 확인 후 커밋한다.**
