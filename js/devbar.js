// 상단 devbar(사이트명 + 다른 게임 링크)가 화면 폭보다 넓으면 자동으로 가로 스크롤(마퀴)되게 한다.
(function () {
  var viewport = document.getElementById('devbar-viewport');
  var track = document.getElementById('devbar-track');
  if (!viewport || !track) return;

  function setup() {
    track.classList.remove('auto-scroll');
    track.querySelectorAll('[data-clone]').forEach(function (el) { el.remove(); });

    var overflowing = track.scrollWidth > viewport.clientWidth + 4;
    if (!overflowing) return;

    var originalWidth = track.scrollWidth;
    var originalChildren = Array.prototype.slice.call(track.children);
    originalChildren.forEach(function (child) {
      var clone = child.cloneNode(true);
      clone.setAttribute('data-clone', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('tabindex', '-1');
      track.appendChild(clone);
    });

    var pxPerSecond = 40;
    var duration = Math.max(originalWidth / pxPerSecond, 8);
    track.style.setProperty('--devbar-duration', duration + 's');
    track.classList.add('auto-scroll');
  }

  setup();
  window.addEventListener('resize', function () {
    clearTimeout(window.__devbarResizeTimer);
    window.__devbarResizeTimer = setTimeout(setup, 200);
  });
})();
