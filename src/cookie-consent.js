// Aviso de cookies: o Google Tag Manager (e o Google Analytics configurado nele)
// só é carregado depois de o visitante aceitar.
(function () {
  var GTM_ID = 'GTM-WSLLCJFD';
  var STORAGE_KEY = 'reis-cookie-consent';
  var MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000; // volta a perguntar após 6 meses

  var banner = null;
  var returnFocusTo = null;

  function getChoice() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || (saved.value !== 'accepted' && saved.value !== 'rejected')) return null;
      if (Date.now() - saved.savedAt > MAX_AGE_MS) return null;
      return saved.value;
    } catch (e) {
      return null;
    }
  }

  function saveChoice(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: value, savedAt: Date.now() }));
    } catch (e) {
      // Sem armazenamento, a escolha vale só para esta página.
    }
  }

  function loadGtm() {
    if (window.reisGtmLoaded) return;
    window.reisGtmLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(script);
  }

  // Os cookies do Analytics ficam no domínio principal, por isso tenta-se cada nível.
  function clearAnalyticsCookies() {
    var parts = location.hostname.split('.');
    var domains = [''];
    for (var i = 0; i < parts.length - 1; i++) {
      domains.push('; domain=.' + parts.slice(i).join('.'));
    }
    document.cookie.split(';').forEach(function (cookie) {
      var name = cookie.split('=')[0].trim();
      if (!/^(_ga|_gid|_gat)/.test(name)) return;
      domains.forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; path=/' + domain;
      });
    });
  }

  function addStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '.cc-banner { position: fixed; z-index: 70; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); max-width: 720px; margin: 0 auto; padding: 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 16px; background: #0d0d0d; border: 1px solid rgba(255,255,255,.2); color: rgba(255,255,255,.82); font: 400 14px/1.5 "Inter", system-ui, sans-serif; box-shadow: 0 12px 40px rgba(0,0,0,.6); }',
      '.cc-banner[hidden] { display: none; }',
      '.cc-banner .cc-text { flex: 1 1 320px; margin: 0; font-size: 14px; line-height: 1.5; }',
      '.cc-banner .cc-text a { color: #fcc83d; text-decoration: underline; }',
      '.cc-banner .cc-actions { flex: 1 1 220px; display: flex; gap: 8px; }',
      '.cc-banner .cc-btn { flex: 1; min-height: 44px; padding: 0 16px; background: transparent; border: 1px solid #fcc83d; border-radius: 0; color: #fcc83d; font: 600 14px/1 "Inter", system-ui, sans-serif; cursor: pointer; transition: background-color .2s, color .2s; }',
      '.cc-banner .cc-btn:hover { background: #fcc83d; color: #050505; }',
      '.cc-banner .cc-btn:focus-visible, .cc-banner a:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildBanner() {
    addStyles();
    banner = document.createElement('section');
    banner.className = 'cc-banner';
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.hidden = true;
    banner.innerHTML =
      '<p class="cc-text">Gostávamos de usar cookies do Google Analytics para perceber como o site é visitado. ' +
      'Só são ativados se aceitares. Sabe mais na <a href="politica-de-cookies.html">Política de Cookies</a>.</p>' +
      '<div class="cc-actions">' +
      '<button type="button" class="cc-btn" data-cc-choice="rejected">Rejeitar</button>' +
      '<button type="button" class="cc-btn" data-cc-choice="accepted">Aceitar</button>' +
      '</div>';
    banner.addEventListener('click', function (event) {
      var button = event.target.closest('[data-cc-choice]');
      if (button) choose(button.getAttribute('data-cc-choice'));
    });
    document.body.appendChild(banner);
  }

  function showBanner() {
    if (!banner) buildBanner();
    banner.hidden = false;
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
    if (returnFocusTo) returnFocusTo.focus();
    returnFocusTo = null;
  }

  function choose(value) {
    saveChoice(value);
    if (value === 'accepted') {
      loadGtm();
      hideBanner();
      return;
    }
    clearAnalyticsCookies();
    // Se o GTM já correu nesta página, só recarregar a página o faz parar.
    if (window.reisGtmLoaded) {
      location.reload();
      return;
    }
    hideBanner();
  }

  // Botões "Gerir cookies", em qualquer página.
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-cookie-settings]');
    if (!trigger) return;
    returnFocusTo = trigger;
    showBanner();
    banner.querySelector('.cc-btn').focus();
  });

  var choice = getChoice();
  if (choice === 'accepted') {
    loadGtm();
  } else {
    if (choice === 'rejected') clearAnalyticsCookies();
    if (!choice) showBanner();
  }
})();
