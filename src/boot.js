// The first script to run. A classic script, not a module, so it still works if
// module loading itself is what failed. It lives in a file because the page's
// Content-Security-Policy allows no inline script.
(function () {
    var reload = document.getElementById('boot-reload');
    if (reload) reload.addEventListener('click', function () { location.reload(); });
    if (typeof window.THREE === 'undefined' || typeof window.CANNON === 'undefined') {
        document.getElementById('boot-error').style.display = 'flex';
        console.error('[HundredBlockDash] Engine libraries missing — THREE:', typeof window.THREE, 'CANNON:', typeof window.CANNON);
        return;
    }
    var m = document.createElement('script');
    m.type = 'module';
    m.src = 'src/main.js';
    document.body.appendChild(m);
})();
