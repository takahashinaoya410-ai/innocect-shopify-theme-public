/* INNOCECT Store — theme.js（依存ライブラリなし） */
(function () {
  'use strict';

  var T = window.theme || { routes: {}, settings: {} };
  var S = T.settings || {};

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function formatMoney(cents) {
    var value = Number(cents) || 0;
    var format = T.moneyFormat || '¥{{amount_no_decimals}}';
    function delimit(n, decimals) {
      var fixed = (n / 100).toFixed(decimals);
      var parts = fixed.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return parts.join('.');
    }
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, function (_, key) {
      switch (key) {
        case 'amount': return delimit(value, 2);
        case 'amount_no_decimals': return delimit(value, 0);
        case 'amount_with_comma_separator': return delimit(value, 2).replace(/,/g, '#').replace('.', ',').replace(/#/g, '.');
        case 'amount_no_decimals_with_comma_separator': return delimit(value, 0).replace(/,/g, '.');
        default: return delimit(value, 0);
      }
    });
  }
  function yen(cents) { return Math.round((Number(cents) || 0) / 100).toLocaleString('ja-JP'); }

  function fetchJSON(url, options) {
    options = options || {};
    var base = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (options.body) base['Content-Type'] = 'application/json';
    options.headers = Object.assign(base, options.headers || {});
    return fetch(url, options).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.description || data.message || 'エラーが発生しました');
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  var Cart = {
    get: function () { return fetchJSON(T.routes.cart + '.js', { method: 'GET' }); },
    add: function (items) { return fetchJSON(T.routes.cartAdd + '.js', { method: 'POST', body: JSON.stringify({ items: items }) }); },
    change: function (payload) { return fetchJSON(T.routes.cartChange + '.js', { method: 'POST', body: JSON.stringify(payload) }); },
    update: function (payload) { return fetchJSON(T.routes.cartUpdate + '.js', { method: 'POST', body: JSON.stringify(payload) }); },
    count: 0,
    onetimeCount: 0
  };

  function refreshCount(cart) {
    var p = cart ? Promise.resolve(cart) : Cart.get();
    return p.then(function (c) {
      Cart.count = c.item_count;
      Cart.onetimeCount = c.items.reduce(function (sum, item) { return sum + (item.selling_plan_allocation ? 0 : item.quantity); }, 0);
      $$('[data-cart-count]').forEach(function (el) {
        el.textContent = c.item_count;
        el.hidden = c.item_count === 0;
      });
      $$('[data-cart-link]').forEach(function (el) { el.setAttribute('aria-label', 'カート（' + c.item_count + '点）'); });
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: c }));
      return c;
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(message) {
    var el = $('[data-toast]');
    if (!el) return;
    $('[data-toast-msg]', el).textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 5000);
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-toast-close]')) $('[data-toast]').hidden = true;
  });

  /* ---------- header: drawer / search ---------- */
  document.addEventListener('click', function (e) {
    var close = e.target.closest('[data-drawer-close]');
    if (close) { var d = close.closest('details'); if (d) d.removeAttribute('open'); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('details[data-drawer][open], details[data-search][open], details.facet[open]').forEach(function (d) { d.removeAttribute('open'); });
  });
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d.matches && d.matches('details[data-search]') && d.open) {
      var input = $('input[type="search"]', d);
      if (input) setTimeout(function () { input.focus(); }, 30);
    }
  }, true);

  /* ---------- bundle / subscription nudge ---------- */
  function bundleMessage(totalQty) {
    if (!S.bundleEnabled) return '';
    var tiers = (S.bundle || []).filter(function (t) { return t.qty > 0 && t.percent > 0; }).sort(function (a, b) { return a.qty - b.qty; });
    if (!tiers.length) return '';
    var t1 = tiers[0], t2 = tiers[tiers.length - 1];
    if (totalQty < t1.qty) return 'あと' + (t1.qty - totalQty) + '点で' + t1.percent + '%OFF（まとめ買い割）';
    if (tiers.length > 1 && totalQty < t2.qty) return 'まとめ買い割 ' + t1.percent + '%OFF 適用｜あと' + (t2.qty - totalQty) + '点で' + t2.percent + '%OFF';
    return 'まとめ買い割 ' + t2.percent + '%OFF 適用';
  }

  /* ---------- product page ---------- */
  function initProduct(root) {
    if (root.__innocectBound) return;
    var form = $('[data-product-form]', root);
    if (!form) return;
    root.__innocectBound = true;
    var product = JSON.parse($('[data-product-json]', root).textContent);
    var config = JSON.parse($('[data-product-config]', root).textContent);
    var coming = (config.coming || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    var idInput = $('[data-variant-id]', form);
    var planInput = $('[data-selling-plan-input]', form);
    var planSelect = $('[data-selling-plan-select]', root);
    var planWrap = $('[data-plan-wrap]', root);
    var qtyInput = $('[data-qty-input]', form);
    var addBtn = $('[data-add-button]', form);
    var addText = $('[data-add-text]', form);
    var buyArea = $('[data-buy-area]', form);
    var comingPanel = $('[data-coming-panel]', form);
    var errorEl = $('[data-form-error]', form);
    var sticky = $('[data-sticky-atc]', root);
    var stickyBtn = $('[data-sticky-button]', root);

    function selectedOptions() {
      return $$('[data-option]', root).map(function (fs) {
        var checked = $('[data-option-input]:checked', fs);
        return checked ? checked.value : null;
      });
    }
    function findVariant() {
      if (product.variants.length === 1) return product.variants[0];
      var opts = selectedOptions();
      return product.variants.find(function (v) {
        return v.options.every(function (o, i) { return opts[i] == null || o === opts[i]; });
      });
    }
    function purchaseType() {
      var r = $('[data-purchase-option]:checked', root);
      return r ? r.value : 'onetime';
    }
    function servingFor(variant) {
      var o = (config.overrides || []).find(function (x) { return variant && variant.options.indexOf(String(x.value).trim()) !== -1; });
      return {
        servings: o && o.servings ? o.servings : config.servings,
        label: o && o.label ? o.label : config.label
      };
    }
    function allocationFor(variant, planId) {
      if (!variant || !variant.selling_plan_allocations) return null;
      return variant.selling_plan_allocations.find(function (a) { return String(a.selling_plan_id) === String(planId); }) || variant.selling_plan_allocations[0] || null;
    }
    function subPrice(variant) {
      var planId = planSelect ? planSelect.value : (planInput ? planInput.value : '');
      var alloc = allocationFor(variant, planId);
      if (alloc) return alloc.price;
      return Math.round(variant.price * (100 - (S.subscriptionPercent || 0)) / 100);
    }
    function setText(sel, text) { $$(sel, root).forEach(function (el) { el.textContent = text; }); }

    function update() {
      var variant = findVariant();
      var qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      if (!variant) {
        addBtn.disabled = true;
        addText.textContent = 'この組み合わせはありません';
        return;
      }
      idInput.value = variant.id;
      $$('[data-option]', root).forEach(function (fs, i) {
        var label = $('[data-option-selected]', fs);
        if (label) label.textContent = variant.options[i];
      });

      var isSub = purchaseType() === 'subscription';
      if (planInput) planInput.value = isSub && planSelect ? planSelect.value : '';
      if (planWrap) planWrap.hidden = !isSub || !planSelect || planSelect.options.length < 2;

      var serving = servingFor(variant);
      var once = variant.price;
      var sub = subPrice(variant);
      var unit = isSub ? sub : once;
      setText('[data-price-once]', formatMoney(once));
      setText('[data-price-sub]', formatMoney(sub));
      if (serving.servings > 0) {
        setText('[data-per-once]', serving.label + '約' + yen(once / serving.servings) + '円');
        setText('[data-per-sub]', serving.label + '約' + yen(sub / serving.servings) + '円');
      } else {
        setText('[data-per-once]', '');
        setText('[data-per-sub]', '');
      }
      var compare = $('[data-compare]', root);
      if (compare) {
        compare.hidden = !(variant.compare_at_price > variant.price);
        compare.textContent = formatMoney(variant.compare_at_price || 0);
      }

      // まとめ買い割は通常購入にのみ表示（定期便とは併用不可の想定）
      var discount = 0;
      var nudge = '';
      if (isSub) {
        nudge = (S.subscriptionPercent ? '定期便' + S.subscriptionPercent + '%OFFが毎回の配送に適用されます' : '');
      } else {
        var total = Cart.onetimeCount + qty;
        nudge = bundleMessage(total);
        if (nudge && Cart.onetimeCount > 0) nudge = 'カートの' + Cart.onetimeCount + '点と合わせて｜' + nudge;
        (S.bundle || []).forEach(function (t) { if (S.bundleEnabled && t.qty > 0 && total >= t.qty) discount = Math.max(discount, t.percent); });
      }
      setText('[data-nudge-text]', nudge);
      var totalPrice = Math.round(unit * qty * (100 - discount) / 100);
      setText('[data-total]', formatMoney(totalPrice));

      var isComing = coming.indexOf(variant.title) !== -1 || coming.indexOf(variant.options[0]) !== -1;
      if (buyArea) buyArea.hidden = isComing;
      if (comingPanel) {
        comingPanel.hidden = !isComing;
        var cn = $('[data-coming-name]', comingPanel);
        if (cn) cn.textContent = variant.title;
      }
      addBtn.disabled = !variant.available;
      addText.textContent = variant.available ? 'カートに入れる' : '売り切れ';
      if (stickyBtn) stickyBtn.disabled = !variant.available || isComing;
      setText('[data-sticky-name]', product.variants.length > 1 ? variant.title : product.title);
      setText('[data-sticky-price]', formatMoney(unit));

      if (variant.featured_media) scrollToMedia(variant.featured_media.id);
      if (window.history.replaceState && product.variants.length > 1) {
        try {
          var url = new URL(window.location.href);
          url.searchParams.set('variant', variant.id);
          window.history.replaceState(window.history.state, '', url.toString());
        } catch (err) { /* URLを書き換えられない環境では何もしない */ }
      }
    }

    /* gallery */
    var track = $('[data-gallery-track]', root);
    function scrollToMedia(id) {
      if (!track) return;
      var slide = $('[data-media-id="' + id + '"]', track);
      if (slide) track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
      $$('[data-thumb]', root).forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-thumb') === String(id)); });
    }
    $$('[data-thumb]', root).forEach(function (btn) {
      btn.addEventListener('click', function () { scrollToMedia(btn.getAttribute('data-thumb')); });
    });
    if (track && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var id = en.target.getAttribute('data-media-id');
            $$('[data-thumb]', root).forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-thumb') === id); });
          }
        });
      }, { root: track, threshold: 0.6 });
      $$('[data-media-id]', track).forEach(function (s) { io.observe(s); });
    }

    /* events */
    root.addEventListener('change', function (e) {
      if (e.target.matches('[data-option-input], [data-purchase-option], [data-selling-plan-select]')) update();
    });
    qtyInput.addEventListener('input', update);
    root.addEventListener('click', function (e) {
      var minus = e.target.closest('[data-qty-minus]');
      var plus = e.target.closest('[data-qty-plus]');
      if (!minus && !plus) return;
      var v = parseInt(qtyInput.value, 10) || 1;
      qtyInput.value = Math.min(99, Math.max(1, v + (plus ? 1 : -1)));
      update();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var variant = findVariant();
      if (!variant || !variant.available) return;
      var item = { id: variant.id, quantity: Math.max(1, parseInt(qtyInput.value, 10) || 1) };
      if (planInput && planInput.value) item.selling_plan = Number(planInput.value);
      errorEl.hidden = true;
      addBtn.classList.add('is-loading');
      if (stickyBtn) stickyBtn.classList.add('is-loading');
      Cart.add([item])
        .then(function () { return refreshCount(); })
        .then(function () {
          if (S.afterAdd === 'cart') { window.location.href = T.routes.cart; return; }
          toast(product.title + (product.variants.length > 1 ? '（' + variant.title + '）' : '') + 'をカートに入れました');
          update();
        })
        .catch(function (err) {
          errorEl.textContent = err.message || 'カートに追加できませんでした';
          errorEl.hidden = false;
        })
        .finally(function () {
          addBtn.classList.remove('is-loading');
          if (stickyBtn) stickyBtn.classList.remove('is-loading');
        });
    });

    /* sticky add-to-cart (SP) */
    if (sticky && addBtn && 'IntersectionObserver' in window) {
      var watch = new IntersectionObserver(function (entries) {
        var show = !entries[0].isIntersecting && entries[0].boundingClientRect.top < 0;
        sticky.hidden = !show;
        document.body.classList.toggle('has-sticky-atc', show);
      });
      watch.observe($('.atc', form) || addBtn);
    }

    document.addEventListener('cart:updated', function () { if (root.isConnected) update(); });
    update();
  }

  /* ---------- recommendations ---------- */
  function initRecommendations(scope) {
    $$('[data-recommendations]', scope).forEach(function (el) {
      if (el.__innocectBound) return;
      el.__innocectBound = true;
      fetch(el.getAttribute('data-url'))
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var tmp = document.createElement('div');
          tmp.innerHTML = html;
          var grid = tmp.querySelector('.product-grid');
          if (grid && grid.children.length) el.replaceWith(grid);
          else { var sec = el.closest('section'); if (sec) sec.hidden = true; }
        })
        .catch(function () {});
    });
  }

  /* ---------- collection facets ---------- */
  function initFacets(scope) {
    $$('[data-facets-form]', scope).forEach(function (form) {
      if (form.__innocectBound) return;
      form.__innocectBound = true;
      form.addEventListener('change', function (e) {
        if (e.target.matches('input[type="checkbox"], select')) form.requestSubmit ? form.requestSubmit() : form.submit();
      });
      form.addEventListener('submit', function () {
        $$('input[type="number"]', form).forEach(function (i) { if (i.value === '') i.disabled = true; });
      });
    });
  }
  function bindFacetsGlobal() {
    document.addEventListener('click', function (e) {
      $$('details.facet[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
    });
  }

  /* ---------- cart page ---------- */
  function bindCart() {
    function rerender() {
      var root = $('[data-cart-root]');
      if (!root) return Promise.resolve();
      var sectionId = root.getAttribute('data-section-id');
      return fetch(window.location.pathname + '?section_id=' + encodeURIComponent(sectionId))
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var tmp = document.createElement('div');
          tmp.innerHTML = html;
          var fresh = tmp.querySelector('[data-cart-root]');
          var current = $('[data-cart-root]');
          if (fresh && current) current.innerHTML = fresh.innerHTML;
        });
    }
    function run(promise) {
      var current = $('[data-cart-root]');
      if (current) current.classList.add('is-loading');
      return promise
        .then(function (cart) { return refreshCount(cart && cart.items ? cart : null); })
        .then(rerender)
        .catch(function (err) { toast(err.message || '更新できませんでした'); return rerender(); })
        .finally(function () { var c = $('[data-cart-root]'); if (c) c.classList.remove('is-loading'); });
    }

    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-cart-root]')) return;
      var q = e.target.closest('[data-cart-qty]');
      if (q) {
        e.preventDefault();
        run(Cart.change({ line: Number(q.getAttribute('data-line')), quantity: Math.max(0, Number(q.getAttribute('data-cart-qty'))) }));
        return;
      }
      var rm = e.target.closest('[data-cart-remove]');
      if (rm) {
        e.preventDefault();
        run(Cart.change({ line: Number(rm.getAttribute('data-line')), quantity: 0 }));
        return;
      }
      var plan = e.target.closest('[data-line-plan]');
      if (plan) {
        if (plan.getAttribute('aria-pressed') === 'true') return;
        var planId = plan.getAttribute('data-line-plan');
        run(Cart.change({ line: Number(plan.getAttribute('data-line')), quantity: Number(plan.getAttribute('data-qty')), selling_plan: planId ? Number(planId) : null }));
        return;
      }
      var add = e.target.closest('[data-add-variant]');
      if (add) {
        run(Cart.add([{ id: Number(add.getAttribute('data-add-variant')), quantity: 1 }]));
        return;
      }
      if (e.target.closest('[data-discount-apply]')) {
        var input = $('[data-discount-input]');
        var code = input ? input.value.trim() : '';
        if (!code) return;
        var existing = $$('[data-code]').map(function (el) { return el.getAttribute('data-code'); });
        run(Cart.update({ discount: existing.concat([code]).join(',') }));
        return;
      }
      if (e.target.closest('[data-discount-remove]')) {
        run(Cart.update({ discount: '' }));
      }
    });

    document.addEventListener('change', function (e) {
      var input = e.target.closest('[data-cart-qty-input]');
      if (!input) return;
      run(Cart.change({ line: Number(input.getAttribute('data-line')), quantity: Math.max(0, parseInt(input.value, 10) || 0) }));
    });
  }

  /* ---------- boot ---------- */
  /* セクション単位で初期化（テーマエディタでの再描画にも対応） */
  function init(scope) {
    scope = scope || document;
    var roots = $$('[data-product-root]', scope);
    if (scope.matches && scope.matches('[data-product-root]')) roots.push(scope);
    roots.forEach(initProduct);
    initRecommendations(scope);
    initFacets(scope);
  }
  window.INNOCECT = { init: init, refreshCount: refreshCount, formatMoney: formatMoney, toast: toast };
  document.addEventListener('shopify:section:load', function (e) { init(e.target); });

  function boot() {
    bindCart();
    bindFacetsGlobal();
    refreshCount().catch(function () {}).then(function () { init(document); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
