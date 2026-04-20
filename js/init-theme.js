(function () {
    var m = localStorage.getItem('site_mode') || 'light';
    var t = localStorage.getItem('theme') || 'light';
    var d = document.documentElement;
    d.setAttribute('data-mode', m);
    d.setAttribute('data-theme', t);
    var c = { 'dark:light': '#1A1A1A', 'dark:quiet': '#2D2D2F', 'dark:paper': '#2A2824', 'dark:bold': '#000', 'dark:calm': '#3B3326', 'dark:focus': '#000', 'light:light': '#F8F9F5', 'light:quiet': '#404043', 'light:paper': '#EFE8D6', 'light:bold': '#FFF', 'light:calm': '#DFCDAE', 'light:focus': '#FFF' };
    var bg = c[m + ':' + t] || (m === 'dark' ? '#121212' : '#F8F9F5');
    d.style.backgroundColor = bg;
})();
