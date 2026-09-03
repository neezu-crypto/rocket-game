(function () {
  if (!window.rgFirebase) return;
  var fb = window.rgFirebase;
  var walletAmountEl = document.getElementById('wallet-amount');
  var unsubscribeWallet = null;

  document.addEventListener('rg-auth-changed', function (e) {
    if (unsubscribeWallet) { unsubscribeWallet(); unsubscribeWallet = null; }
    var user = e.detail.user;
    if (!user) {
      if (walletAmountEl) walletAmountEl.innerHTML = '0<small>원</small>';
      return;
    }
    unsubscribeWallet = fb.onValue(fb.ref(window.rgDb, 'rocketGame/wallets/' + user.uid), function (snap) {
      var wallet = snap.val() || { balance: 1000000 };
      if (walletAmountEl) walletAmountEl.innerHTML = Math.round(wallet.balance || 0).toLocaleString('ko-KR') + '<small>원</small>';
    });
  });
})();
