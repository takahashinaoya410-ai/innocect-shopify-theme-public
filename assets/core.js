/* INNOCECT theme preview runtime — renders the Shopify theme's Liquid in the browser (or Node) with liquidjs and sample data.
   This approximates Shopify: objects, filters and tags are stubbed only as far as the theme needs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createThemeRuntime = factory;
})(typeof self !== 'undefined' ? self : this, function createThemeRuntime(opts) {
  'use strict';
  var Liquid = opts.Liquid;
  var FILES = opts.files;          // { 'sections/x.liquid': '...', ... }
  var CATALOG = opts.catalog;      // [{ id, handle, title, type, tags, option_name, servings, serving_label, variants:[{id,title,price,available,sku}] }]
  var store = opts.storage || null; // { get(), set(cart) }

  function read(p) {
    if (!(p in FILES)) throw new Error('missing file ' + p);
    return FILES[p];
  }

  /* ---------- engine ---------- */
  var snippetMap = {};
  Object.keys(FILES).forEach(function (p) {
    if (p.indexOf('snippets/') === 0) {
      var name = p.slice(9);
      snippetMap[name] = FILES[p];
      snippetMap[name.replace(/\.liquid$/, '')] = FILES[p];
    }
  });
  var engine = new Liquid({ templates: snippetMap, extname: '.liquid', jsTruthy: false, strictFilters: true, cache: true, relativeReference: false });

  function cents(c) { return Math.round((Number(c) || 0) / 100); }
  var money = function (c) { return '¥' + cents(c).toLocaleString('ja-JP'); };
  var F = {
    money: money,
    money_with_currency: function (c) { return money(c) + ' JPY'; },
    money_without_currency: function (c) { return cents(c).toLocaleString('ja-JP'); },
    divided_by: function (v, d) { v = Number(v); d = Number(d); return (Number.isInteger(v) && Number.isInteger(d)) ? Math.floor(v / d) : v / d; },
    image_url: function (img) { return (img && img.src) || ''; },
    image_tag: function (url) { return '<img src="' + url + '" alt="" width="600" height="600">'; },
    placeholder_svg_tag: function () { return '<svg class="placeholder" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ddd"/></svg>'; },
    asset_url: function (f) { return 'assets/' + f; },
    stylesheet_tag: function (u) { return '<link rel="stylesheet" href="' + u + '">'; },
    font_face: function () { return ''; },
    font_modify: function (f) { return f; },
    color_darken: function (c) { return c === '#0B6E35' ? '#095C2C' : c; },
    color_lighten: function (c) { return c === '#454B52' ? '#6B7178' : c; },
    color_mix: function () { return '#FBEAE7'; },
    structured_data: function () { return '{}'; },
    payment_button: function () { return ''; },
    default_errors: function () { return ''; },
    format_address: function () { return ''; },
    media_tag: function () { return ''; },
    format_code: function (c) { return c; },
    handleize: function (s) { return String(s).toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/g, '-'); },
    t: function (k) { return k; }
  };
  Object.keys(F).forEach(function (k) { engine.registerFilter(k, F[k]); });

  engine.registerTag('schema', {
    parse: function (token, remain) { var t; while ((t = remain.shift())) { if (t.name === 'endschema') return; } },
    render: function () { return ''; }
  });
  function blockTag(endName, before, after) {
    return {
      parse: function (token, remain) {
        var self = this;
        this.args = token.args; this.tpls = [];
        var stream = this.liquid.parser.parseStream(remain)
          .on('tag:' + endName, function () { stream.stop(); })
          .on('template', function (tpl) { self.tpls.push(tpl); })
          .on('end', function () { throw new Error(endName + ' not closed'); });
        stream.start();
      },
      render: function* (ctx, emitter) {
        emitter.write(before ? before.call(this, ctx) : '');
        if (this.pushScope) ctx.push(this.pushScope);
        yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
        if (this.pushScope) ctx.pop();
        emitter.write(after || '');
      }
    };
  }
  engine.registerTag('form', blockTag('endform', function (ctx) {
    var idExpr = (this.args.match(/id:\s*([\w.]+)/) || [])[1];
    var idv = idExpr ? this.liquid.evalValueSync(idExpr, ctx) : '';
    var cls = (this.args.match(/class:\s*'([^']+)'/) || [])[1] || '';
    var data = /data-product-form/.test(this.args) ? ' data-product-form' : '';
    return '<form method="post" action="/cart/add" id="' + idv + '" class="' + cls + '"' + data + '>';
  }, '</form>'));
  var paginateTag = blockTag('endpaginate', null, '');
  var basePaginateParse = paginateTag.parse;
  paginateTag.parse = function (token, remain) { basePaginateParse.call(this, token, remain); this.pushScope = { paginate: { pages: 1, parts: [] } }; };
  engine.registerTag('paginate', paginateTag);
  engine.registerTag('style', blockTag('endstyle', function () { return '<style>'; }, '</style>'));
  engine.registerTag('sections', {
    parse: function (token) { this.group = token.args.replace(/['"]/g, '').trim(); },
    render: function (ctx) {
      var g = JSON.parse(read('sections/' + this.group + '.json'));
      var all = ctx.getAll();
      return g.order.map(function (sid) { return renderSection(g.sections[sid], sid, all); }).join('');
    }
  });

  /* ---------- theme settings ---------- */
  var settings = {};
  JSON.parse(read('config/settings_schema.json')).forEach(function (grp) {
    (grp.settings || []).forEach(function (s) { if (s.id && 'default' in s) settings[s.id] = s.default; });
  });
  settings.type_number_font = { family: 'Inter', fallback_families: 'sans-serif' };

  /* ---------- catalog ---------- */
  function buildProduct(p) {
    var plans = [{ id: 9001, name: '毎月お届け（10%OFF）' }, { id: 9002, name: '2か月ごとにお届け（10%OFF）' }, { id: 9003, name: '3か月ごとにお届け（10%OFF）' }];
    var pct = Number(settings.subscription_percent) || 10;
    var variants = p.variants.map(function (v) {
      var o = {};
      for (var k in v) o[k] = v[k];
      o.options = p.option_name ? [v.title] : ['Default Title'];
      o.option1 = o.options[0];
      o.featured_media = null; o.compare_at_price = null; o.image = null;
      o.selling_plan_allocations = plans.map(function (sp) {
        return { selling_plan_id: sp.id, selling_plan_group_id: 'g1', price: Math.round(v.price * (100 - pct) / 100), compare_at_price: v.price, per_delivery_price: Math.round(v.price * (100 - pct) / 100), selling_plan: sp };
      });
      return o;
    });
    var first = variants.filter(function (v) { return v.available; })[0] || variants[0];
    var prices = variants.map(function (v) { return v.price; });
    var product = {
      id: p.id, title: p.title, handle: p.handle, url: '/products/' + p.handle, vendor: 'INNOCECT', type: p.type, tags: p.tags,
      price: Math.min.apply(null, prices), price_min: Math.min.apply(null, prices), price_max: Math.max.apply(null, prices),
      price_varies: Math.min.apply(null, prices) !== Math.max.apply(null, prices),
      compare_at_price: null, available: variants.some(function (v) { return v.available; }), variants: variants,
      media: [], images: [], featured_media: null, featured_image: null,
      collections: [{ title: p.type, url: '/collections/' + ({ 'プロテイン': 'protein', 'アミノ酸': 'amino', '食物繊維': 'fiber' }[p.type] || 'all') }],
      has_only_default_variant: !p.option_name, options: p.option_name ? [p.option_name] : ['Title'], requires_selling_plan: false,
      selling_plan_groups: [{ id: 'g1', name: '定期便', app_id: 'subscriptions', selling_plans: plans }],
      selected_or_first_available_variant: first, selected_variant: null, description: '<p>' + p.title + '</p>',
      metafields: { innocect: { servings: { value: p.servings }, serving_label: { value: p.serving_label } }, reviews: {} }
    };
    product.options_with_values = p.option_name ? [{
      name: p.option_name, position: 1, selected_value: first.title,
      values: variants.map(function (v) { return { name: v.title, selected: v === first, available: v.available, swatch: null, toString: function () { return v.title; } }; })
    }] : [];
    return product;
  }
  var products = CATALOG.map(buildProduct);
  var byHandle = {};
  var variantIndex = {};
  products.forEach(function (p) {
    byHandle[p.handle] = p;
    p.variants.forEach(function (v) { variantIndex[v.id] = { product: p, variant: v }; });
  });

  var COLL_TITLES = {
    all: 'すべての商品', protein: 'プロテイン', 'whey-protein': 'ホエイプロテイン', 'soy-protein': 'ソイプロテイン', amino: 'アミノ酸', fiber: '食物繊維',
    'amino-fiber': 'アミノ酸・食物繊維', ranking: '人気ランキング', beginner: 'はじめてのプロテイン', training: 'トレーニング・ボディメイクに',
    'daily-protein': '朝食や間食のたんぱく質補給に', 'no-artificial-sweetener': '人工甘味料が気になる方に', 'plant-protein': '植物性たんぱく質を選びたい方に'
  };
  function collectionProducts(h) {
    var has = function (p, t) { return p.tags.indexOf(t) !== -1; };
    switch (h) {
      case 'all': return products;
      case 'protein': return products.filter(function (p) { return p.type === 'プロテイン'; });
      case 'whey-protein': return products.filter(function (p) { return has(p, 'ホエイ'); });
      case 'soy-protein': return products.filter(function (p) { return has(p, 'ソイ'); });
      case 'amino': return products.filter(function (p) { return p.type === 'アミノ酸'; });
      case 'fiber': return products.filter(function (p) { return p.type === '食物繊維'; });
      case 'amino-fiber': return products.filter(function (p) { return p.type === 'アミノ酸' || p.type === '食物繊維'; });
      case 'ranking': return ['soy-protein-3kg', 'creatine-1kg', 'eaa-600g', 'glutamine-1kg', 'soy-protein-1kg', 'whey-protein-3kg', 'resistant-dextrin-2kg'].map(function (x) { return byHandle[x]; }).filter(Boolean);
      default: return products.filter(function (p) { return has(p, 'purpose:' + h); });
    }
  }
  function collection(h) {
    if (!(h in COLL_TITLES)) return null;
    var list = collectionProducts(h);
    var types = {};
    list.forEach(function (p) { types[p.type] = (types[p.type] || 0) + 1; });
    return {
      handle: h, title: COLL_TITLES[h], url: '/collections/' + h, products: list, all_products_count: list.length, products_count: list.length,
      description: '', featured_image: null,
      filters: [{ type: 'list', label: '種類', param_name: 'filter.p.product_type', active_values: [],
        values: Object.keys(types).map(function (t) { return { param_name: 'filter.p.product_type', value: t, label: t, count: types[t], active: false }; }) }],
      sort_options: [{ value: 'manual', name: 'おすすめ順' }, { value: 'best-selling', name: '売れている順' }, { value: 'price-ascending', name: '価格の安い順' }, { value: 'price-descending', name: '価格の高い順' }],
      sort_by: 'manual', default_sort_by: 'manual'
    };
  }
  var menus = {
    'main-menu': { links: [
      { title: 'プロテイン', url: '/collections/protein', links: [{ title: 'すべてのプロテイン', url: '/collections/protein', links: [] }, { title: 'ホエイプロテイン', url: '/collections/whey-protein', links: [] }, { title: 'ソイプロテイン', url: '/collections/soy-protein', links: [] }] },
      { title: 'アミノ酸', url: '/collections/amino', links: [] }, { title: '食物繊維', url: '/collections/fiber', links: [] },
      { title: 'はじめての方へ', url: '/pages/guide', links: [] }, { title: 'おトクな買い方', url: '/pages/save', links: [] }] },
    'footer-category': { title: '商品カテゴリ', links: [{ title: 'プロテイン', url: '/collections/protein' }, { title: 'アミノ酸', url: '/collections/amino' }, { title: '食物繊維', url: '/collections/fiber' }, { title: 'すべての商品', url: '/collections/all' }] },
    footer: { title: 'ご利用ガイド', links: [{ title: 'はじめての方へ', url: '/pages/guide' }, { title: 'おトクな買い方', url: '/pages/save' }, { title: 'よくある質問', url: '/pages/faq' }, { title: '特定商取引法に基づく表記', url: '/policies/legal-notice' }, { title: 'プライバシーポリシー', url: '/policies/privacy-policy' }] },
    'footer-brand': { title: 'INNOCECTについて', links: [{ title: '会社概要', url: '/pages/about' }, { title: 'お問い合わせ', url: '/pages/contact' }] }
  };

  /* ---------- cart ---------- */
  var cart = (store && store.get()) || { items: [], codes: [] };
  function save() { if (store) store.set(cart); }
  function normalize() {
    var merged = [];
    cart.items.forEach(function (it) {
      if (!variantIndex[it.id] || it.quantity <= 0) return;
      var ex = merged.filter(function (m) { return m.id === it.id && (m.selling_plan || null) === (it.selling_plan || null); })[0];
      if (ex) ex.quantity += it.quantity; else merged.push({ id: it.id, quantity: it.quantity, selling_plan: it.selling_plan || null });
    });
    cart.items = merged;
    save();
  }
  normalize();
  function cartObject() {
    var onetime = 0;
    var items = cart.items.map(function (it, i) {
      var ref = variantIndex[it.id];
      var product = ref.product, variant = ref.variant;
      var plan = it.selling_plan ? variant.selling_plan_allocations.filter(function (a) { return a.selling_plan_id === it.selling_plan; })[0] : null;
      var price = plan ? plan.price : variant.price;
      if (!plan) onetime += it.quantity;
      return {
        key: it.id + ':' + (it.selling_plan || 0), id: it.id, variant_id: it.id, product_id: product.id, product: product, variant: variant, quantity: it.quantity,
        url: product.url, image: null, title: product.title, product_title: product.title, variant_title: product.has_only_default_variant ? null : variant.title,
        price: price, original_price: price, final_price: price, original_line_price: price * it.quantity, line_price: price * it.quantity, final_line_price: price * it.quantity,
        selling_plan_allocation: plan ? { selling_plan: plan.selling_plan, price: plan.price, compare_at_price: variant.price } : null,
        line_level_discount_allocations: [], line_level_total_discount: 0, discounts: [], properties: {},
        url_to_remove: '/cart/change?line=' + (i + 1) + '&quantity=0'
      };
    });
    var subtotal = items.reduce(function (s, it) { return s + it.final_line_price; }, 0);
    var t1 = Number(settings.bundle_tier1_qty) || 2, t2 = Number(settings.bundle_tier2_qty) || 3;
    var pct = settings.bundle_enabled ? (onetime >= t2 ? Number(settings.bundle_tier2_percent) : onetime >= t1 ? Number(settings.bundle_tier1_percent) : 0) : 0;
    var onetimeTotal = items.filter(function (it) { return !it.selling_plan_allocation; }).reduce(function (s, it) { return s + it.final_line_price; }, 0);
    var disc = Math.round(onetimeTotal * pct / 100 / 100) * 100;
    var apps = pct ? [{ title: 'まとめ買い割（' + pct + '%OFF）', total_allocated_amount: disc, type: 'automatic' }] : [];
    return {
      item_count: items.reduce(function (s, it) { return s + it.quantity; }, 0), items: items,
      items_subtotal_price: subtotal, original_total_price: subtotal, total_price: subtotal - disc, total_discount: disc,
      cart_level_discount_applications: apps, discount_applications: apps,
      discount_codes: cart.codes.map(function (c) { return { code: c, applicable: false }; }),
      currency: { iso_code: 'JPY' }, note: '', attributes: {}, requires_shipping: items.length > 0
    };
  }
  function cartJSON() {
    var c = cartObject();
    return {
      token: 'preview', item_count: c.item_count, total_price: c.total_price, items_subtotal_price: c.items_subtotal_price, currency: 'JPY',
      items: c.items.map(function (it) {
        return { key: it.key, id: it.id, variant_id: it.id, product_id: it.product_id, quantity: it.quantity, price: it.price, final_line_price: it.final_line_price,
          title: it.title, url: it.url, selling_plan_allocation: it.selling_plan_allocation ? { price: it.selling_plan_allocation.price, selling_plan: it.selling_plan_allocation.selling_plan } : null };
      })
    };
  }
  var api = {
    get: function () { return cartJSON(); },
    add: function (body) {
      var items = body.items || [{ id: body.id, quantity: body.quantity || 1, selling_plan: body.selling_plan }];
      var added = [];
      items.forEach(function (it) {
        var id = Number(it.id);
        var ref = variantIndex[id];
        if (!ref) throw { status: 404, description: '商品が見つかりません' };
        if (!ref.variant.available) throw { status: 422, description: 'この商品は現在お買い求めいただけません' };
        cart.items.push({ id: id, quantity: Math.max(1, Number(it.quantity) || 1), selling_plan: it.selling_plan ? Number(it.selling_plan) : null });
        added.push({ id: id, quantity: it.quantity });
      });
      normalize();
      return { items: added };
    },
    change: function (body) {
      var i = Number(body.line) - 1;
      var line = cart.items[i];
      if (!line) throw { status: 400, description: 'カートの商品が見つかりません' };
      if ('selling_plan' in body) line.selling_plan = body.selling_plan ? Number(body.selling_plan) : null;
      if ('quantity' in body) line.quantity = Math.max(0, Number(body.quantity) || 0);
      normalize();
      return cartJSON();
    },
    update: function (body) {
      if ('discount' in body) cart.codes = String(body.discount || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      save();
      return cartJSON();
    }
  };

  /* ---------- sections & templates ---------- */
  var schemaCache = {};
  function sectionSchema(type) {
    if (!schemaCache[type]) {
      var m = read('sections/' + type + '.liquid').match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
      schemaCache[type] = m ? JSON.parse(m[1]) : {};
    }
    return schemaCache[type];
  }
  function resolve(def, v) {
    if (!def) return v;
    switch (def.type) {
      case 'collection': return v ? collection(v) : null;
      case 'product': return v ? byHandle[v] || null : null;
      case 'product_list': return (v || []).map(function (h) { return byHandle[h]; }).filter(Boolean);
      case 'collection_list': return (v || []).map(collection).filter(Boolean);
      case 'link_list': return menus[v] || null;
      case 'image_picker': case 'video': return null;
      case 'url': return v || null;
      default: return v;
    }
  }
  function settingsFor(defs, given) {
    var out = {};
    (defs || []).forEach(function (d) { if (d.id) out[d.id] = resolve(d, given && d.id in given ? given[d.id] : d.default); });
    return out;
  }
  function renderSection(sec, sid, scope) {
    var sc = sectionSchema(sec.type);
    var blocks = (sec.block_order || []).map(function (bid) {
      var b = sec.blocks[bid];
      var def = (sc.blocks || []).filter(function (x) { return x.type === b.type; })[0] || {};
      return { id: bid, type: b.type, settings: settingsFor(def.settings, b.settings), shopify_attributes: '' };
    });
    var section = { id: 'template--preview__' + sid, settings: settingsFor(sc.settings, sec.settings), blocks: blocks };
    var s = {};
    for (var k in scope) s[k] = scope[k];
    s.section = section;
    var html = engine.parseAndRenderSync(read('sections/' + sec.type + '.liquid'), s);
    return '<div id="shopify-section-' + section.id + '" class="shopify-section">' + html + '</div>';
  }
  function renderTemplate(name, scope) {
    var t = JSON.parse(read('templates/' + name + '.json'));
    return t.order.map(function (sid) { return t.sections[sid].disabled ? '' : renderSection(t.sections[sid], sid, scope); }).join('');
  }
  var ROUTES = { root_url: '/', cart_url: '/cart', cart_add_url: '/cart/add', cart_change_url: '/cart/change', cart_update_url: '/cart/update', search_url: '/search',
    account_url: '/account', account_login_url: '/account/login', account_register_url: '/account/register', all_products_collection_url: '/collections/all',
    product_recommendations_url: '/recommendations/products', predictive_search_url: '/search/suggest' };
  function scopeFor(extra) {
    var g = {
      settings: settings,
      shop: { name: 'INNOCECT', money_format: '¥{{amount_no_decimals}}', customer_accounts_enabled: true, description: '', url: '/' },
      routes: ROUTES, request: { locale: { iso_code: 'ja' }, design_mode: false, page_type: (extra && extra.page_type) || 'index', origin: '' },
      cart: cartObject(), customer: null, localization: {}
    };
    engine.options.globals = g;
    var s = { canonical_url: '/', page_title: 'INNOCECT', content_for_header: '', additional_checkout_buttons: false, template: { name: 'index' }, current_page: 1 };
    for (var k in g) s[k] = g[k];
    for (var j in (extra || {})) s[j] = extra[j];
    return s;
  }

  var PRODUCT_TEMPLATES = { 'whey-protein-3kg': 'product.whey', 'soy-protein-3kg': 'product.soy3kg', 'soy-protein-1kg': 'product.soy1kg', 'eaa-600g': 'product.eaa',
    'creatine-1kg': 'product.creatine', 'glutamine-1kg': 'product.glutamine', 'resistant-dextrin-2kg': 'product.dextrin' };
  var PAGES = { guide: 'はじめての方へ', save: 'おトクな買い方' };

  /* path like "/products/x" → { title, html } or null */
  function renderPath(path) {
    path = path.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    var m;
    if (path === '/') return { title: 'INNOCECT 公式オンラインストア', html: renderTemplate('index', scopeFor({ template: { name: 'index' } })) };
    if ((m = path.match(/^\/collections\/([\w-]+)$/))) {
      var c = collection(m[1]);
      if (!c) return null;
      return { title: c.title + '｜INNOCECT', html: renderTemplate(m[1] === 'protein' ? 'collection.protein' : 'collection', scopeFor({ collection: c, page_type: 'collection', template: { name: 'collection' } })) };
    }
    if ((m = path.match(/^\/(?:collections\/[\w-]+\/)?products\/([\w-]+)$/))) {
      var p = byHandle[m[1]];
      if (!p) return null;
      return { title: p.title + '｜INNOCECT', html: renderTemplate(PRODUCT_TEMPLATES[p.handle] || 'product', scopeFor({ product: p, page_type: 'product', template: { name: 'product' } })) };
    }
    if (path === '/cart') return { title: 'カート｜INNOCECT', html: renderTemplate('cart', scopeFor({ page_type: 'cart', template: { name: 'cart' } })) };
    if ((m = path.match(/^\/pages\/([\w-]+)$/)) && PAGES[m[1]]) {
      return { title: PAGES[m[1]] + '｜INNOCECT', html: renderTemplate('page.' + m[1], scopeFor({ page: { title: PAGES[m[1]], content: '' }, page_type: 'page', template: { name: 'page' } })) };
    }
    return null;
  }
  function renderCartSection() {
    var t = JSON.parse(read('templates/cart.json'));
    var sid = t.order.filter(function (id) { return t.sections[id].type === 'main-cart'; })[0];
    return renderSection(t.sections[sid], sid, scopeFor({ page_type: 'cart', template: { name: 'cart' } }));
  }
  function renderLayout(contentForLayout) {
    var s = scopeFor({ content_for_layout: contentForLayout });
    return engine.parseAndRenderSync(read('layout/theme.liquid'), s);
  }
  function recommendations(productId) {
    var self = products.filter(function (p) { return String(p.id) === String(productId); })[0];
    var list = products.filter(function (p) { return p !== self && (!self || p.type !== self.type); })
      .concat(products.filter(function (p) { return p !== self && self && p.type === self.type; })).slice(0, 4);
    scopeFor({});
    return '<div class="product-grid product-grid--center">' + list.map(function (p) { return engine.parseAndRenderSync("{% render 'card-product', product: p %}", { p: p }); }).join('') + '</div>';
  }

  return { renderPath: renderPath, renderCartSection: renderCartSection, renderLayout: renderLayout, recommendations: recommendations, cart: api, settings: settings };
});
