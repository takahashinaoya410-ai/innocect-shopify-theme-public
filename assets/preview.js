/* INNOCECT theme preview — router, Shopify API stand-ins and notices. Loaded before theme.js. */
(function () {
  'use strict';
  var KEY = 'innocect-preview-cart-v1';
  var storage = {
    get: function () { try { var v = window.localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (c) { try { window.localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* memory only */ } }
  };
  var runtime = window.createThemeRuntime({ Liquid: window.liquidjs.Liquid, files: window.THEME_FILES, catalog: window.THEME_CATALOG, storage: storage });
  window.__preview = runtime;

  /* ---------- notice ---------- */
  var noticeTimer;
  function notice(msg) {
    var el = document.getElementById('preview-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'preview-notice';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { el.classList.remove('is-show'); }, 3600);
  }
  window.__previewNotice = notice;

  /* ---------- Shopify endpoints (in-browser) ---------- */
  function respond(body, status, type) {
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: status || 200, headers: { 'Content-Type': type || 'application/json' }
    }));
  }
  function parseBody(init) {
    if (!init || !init.body) return {};
    try { return JSON.parse(init.body); } catch (e) { return {}; }
  }
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    try {
      if (/\/recommendations\/products/.test(url)) {
        var pid = (url.match(/product_id=(\d+)/) || [])[1];
        return respond(runtime.recommendations(pid), 200, 'text/html');
      }
      if (/[?&]section_id=/.test(url)) return respond(runtime.renderCartSection(), 200, 'text/html');
      if (/\/cart\.js(\?|$)/.test(url)) return respond(runtime.cart.get());
      if (/\/cart\/add(\.js)?(\?|$)/.test(url)) return respond(runtime.cart.add(parseBody(init)));
      if (/\/cart\/change(\.js)?(\?|$)/.test(url)) return respond(runtime.cart.change(parseBody(init)));
      if (/\/cart\/update(\.js)?(\?|$)/.test(url)) return respond(runtime.cart.update(parseBody(init)));
    } catch (err) {
      return respond({ status: err.status || 500, message: err.description || 'エラー', description: err.description || String(err) }, err.status || 500);
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };

  /* ---------- router (hash) ---------- */
  function pathToHash(path) {
    var p = path.split('?')[0].replace(/\/+$/, '') || '/';
    var m;
    if (p === '/') return 'home';
    if ((m = p.match(/^\/collections\/([\w-]+)$/))) return 'c-' + m[1];
    if ((m = p.match(/^\/(?:collections\/[\w-]+\/)?products\/([\w-]+)$/))) return 'p-' + m[1];
    if (p === '/cart') return 'cart';
    if ((m = p.match(/^\/pages\/([\w-]+)$/))) return 'page-' + m[1];
    return null;
  }
  function hashToPath(h) {
    h = (h || '').replace(/^#/, '');
    if (!h || h === 'home') return '/';
    if (h === 'cart') return '/cart';
    if (h.indexOf('c-') === 0) return '/collections/' + h.slice(2);
    if (h.indexOf('p-') === 0) return '/products/' + h.slice(2);
    if (h.indexOf('page-') === 0) return '/pages/' + h.slice(5);
    return null;
  }

  var current = null;
  var suppressHash = false;
  function show(path, opts) {
    opts = opts || {};
    var result;
    try { result = runtime.renderPath(path); } catch (err) { console.error(err); result = null; }
    var main = document.getElementById('MainContent');
    if (!result) {
      if (!main.innerHTML.trim() || main.innerHTML.indexOf('PREVIEW_MAIN') !== -1) return show('/', opts);
      notice('このページはプレビューに含まれていません（Shopifyの管理画面で作成するページです）');
      return false;
    }
    main.innerHTML = result.html;
    document.title = result.title;
    current = pathToHash(path);
    document.body.className = document.body.className.replace(/template-\S+/, 'template-' + (current || 'home').split('-')[0]);
    document.body.classList.remove('has-sticky-atc');
    Array.prototype.forEach.call(document.querySelectorAll('details[open]'), function (d) { d.removeAttribute('open'); });
    if (!opts.keepScroll) window.scrollTo(0, 0);
    if (opts.updateHash && current && ('#' + current) !== window.location.hash) {
      suppressHash = true;
      try { window.location.hash = current; } catch (e) { suppressHash = false; }
    }
    if (window.INNOCECT) window.INNOCECT.init(main);
    return true;
  }
  window.addEventListener('hashchange', function () {
    if (suppressHash) { suppressHash = false; return; }
    var path = hashToPath(window.location.hash);
    if (path !== null && pathToHash(path) !== current) show(path);
  });

  /* links: runs after theme.js handlers (window, bubble), so links theme.js already handled are skipped */
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href.charAt(0) === '#') {
      e.preventDefault();
      var target = href.length > 1 && document.getElementById(href.slice(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (href.charAt(0) === '/' && href.charAt(1) !== '/') {
      e.preventDefault();
      if (/^\/(account|search|policies|checkout)/.test(href)) {
        notice(/^\/account/.test(href) ? '会員ページはShopifyの機能で表示されます（プレビュー対象外）' : 'このページはShopify上で表示されます（プレビュー対象外）');
        return;
      }
      if (pathToHash(href) && pathToHash(href) === current && href.indexOf('?') !== -1) {
        notice('絞り込み・並び替えはShopify上で動きます（プレビューでは表示のみ）');
        return;
      }
      show(href, { updateHash: true });
    }
  });
  window.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    var f = e.target;
    if (f.matches('[data-facets-form]')) notice('絞り込み・並び替えはShopify上で動きます（プレビューでは表示のみ）');
    else if (f.id === 'CartForm') notice('プレビューのため、購入手続きには進めません');
    else if (/search/.test(f.getAttribute('action') || '')) notice('検索はShopify上で動きます（プレビュー対象外）');
    else notice('プレビューのため送信できません');
  });

  /* reset */
  window.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-preview-reset]')) {
      e.preventDefault();
      try { window.localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
      runtime.cart.update({ discount: '' });
      var c = runtime.cart.get();
      for (var i = c.items.length; i > 0; i--) runtime.cart.change({ line: i, quantity: 0 });
      if (window.INNOCECT) window.INNOCECT.refreshCount();
      show(hashToPath('#' + (current || 'home')) || '/', { keepScroll: true });
      notice('カートを空にしました');
    }
  });

  /* first render (synchronous, before theme.js boots) */
  show(hashToPath(window.location.hash) || '/', { keepScroll: true });
})();
