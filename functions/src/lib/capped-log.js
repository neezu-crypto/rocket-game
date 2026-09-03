// push()로 계속 쌓이기만 하고 삭제 로직이 없는 로그성 노드(auditLog 등)를 매 쓰기마다
// 최근 N개로 잘라내는 헬퍼. 매번 트리밍하기 때문에 노드 크기가 항상 cap(+1) 이하로
// 유지되어, 여기서 전체를 읽어도(orderByKey) 비용이 커지지 않는다.
async function trimToLast(ref, cap) {
  const snap = await ref.orderByKey().get();
  const keys = Object.keys(snap.val() || {});
  if (keys.length <= cap) return;
  const updates = {};
  keys.slice(0, keys.length - cap).forEach((key) => { updates[key] = null; });
  await ref.update(updates);
}

module.exports = { trimToLast };
