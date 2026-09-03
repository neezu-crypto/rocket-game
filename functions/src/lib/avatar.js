// SOOP 프로필 이미지 URL 규칙 — StreamBet-Market과 동일 공식(폴더는 아이디 앞 2글자).
function avatarUrlFor(soopId) {
  if (!soopId) return '';
  const folder = soopId.slice(0, 2);
  return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
}

module.exports = { avatarUrlFor };
