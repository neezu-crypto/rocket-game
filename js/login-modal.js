(function () {
  var backdrop = document.getElementById('login-backdrop');
  var closeBtn = document.getElementById('login-modal-close');
  var googleBtn = document.getElementById('login-google-btn');
  if (!backdrop) return;

  function openModal() { backdrop.classList.add('open'); }
  function closeModal() { backdrop.classList.remove('open'); }

  window.rgOpenLoginModal = openModal;
  window.rgCloseLoginModal = closeModal;

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  googleBtn.addEventListener('click', function () {
    window.rgSignIn && window.rgSignIn();
  });

  document.addEventListener('rg-auth-changed', function (e) {
    if (e.detail.realUser) closeModal();
  });
})();
