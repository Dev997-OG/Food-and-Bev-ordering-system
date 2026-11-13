(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(Number(value) || 0);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const initials = name => String(name || "V").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
  const imageFallback = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#34382f"/><stop offset="1" stop-color="#99603d"/></linearGradient></defs><rect width="640" height="420" fill="url(#g)"/><text x="320" y="238" text-anchor="middle" font-size="96">🔥</text><text x="320" y="360" text-anchor="middle" fill="#fff5e8" font-family="sans-serif" font-size="18" letter-spacing="3">FRESH FROM THE FIRE</text></svg>')}`;
  const roles = { customer: "Customer", manager: "System manager", auditor: "System auditor", seller: "Stock seller", developer: "Developer" };
  const titles = { dashboard: "Discover", orders: "Orders", cart: "Your basket", manager: "Business overview", products: "Product manager", stock: "Stock room", auditor: "Audit overview", transactions: "Transactions", seller: "Quick sale", developer: "Team & access", profile: "My profile" };
  let state = { user: null, products: [], orders: [] };
  let activeView = "dashboard";
  let activeCategory = "All";
  let authMode = "login";
  let editingProduct = null;
  let toastTimer;
  let orderPollStarted = false;
  let pendingOrderKey = null;

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-Requested-With", "XMLHttpRequest");
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const response = await fetch(url, { ...options, headers, body, credentials: "same-origin" });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  function notify(message, error = false) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.toggle("error", error);
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 3200);
  }
  async function run(action, successMessage) {
    try {
      await action();
      if (successMessage) notify(successMessage);
    } catch (error) {
      notify(error.message || "Something went wrong. Please try again.", true);
    }
  }
  async function loadWorkspace() {
    const data = await request("/api/bootstrap");
    state = { ...state, ...data };
    if (state.user) {
      const role = state.user.role;
      const requests = [];
      if (["manager", "developer"].includes(role)) requests.push(request("/api/products/manage").then(value => { state.manageProducts = value.products; }));
      if (["manager", "auditor", "developer"].includes(role)) requests.push(request("/api/analytics").then(value => { state.analytics = value; }));
      if (["manager", "auditor", "developer"].includes(role)) requests.push(request("/api/stock").then(value => { state.stock = value; }));
      if (["manager", "auditor", "seller", "developer"].includes(role)) requests.push(request("/api/transactions").then(value => { state.transactions = value.transactions; }));
      if (role === "developer") requests.push(request("/api/users").then(value => { state.users = value.users; }));
      await Promise.all(requests);
      if (["manager", "developer", "seller"].includes(role)) state.orders = (await request("/api/orders")).orders;
      if (role === "customer") state.orders = (await request("/api/orders")).orders;
      if (!activeView || activeView === "dashboard") activeView = roleHome(role);
      startOrderPolling();
    }
    render();
  }

  function startOrderPolling() {
    if (orderPollStarted) return;
    orderPollStarted = true;
    window.setInterval(async () => {
      if (!state.user || !["manager", "seller", "developer"].includes(state.user.role)) return;
      try {
        const latest = (await request("/api/orders")).orders;
        const known = new Set((state.orders || []).map(order => order.id));
        const hasNewOrder = latest.some(order => !known.has(order.id));
        state.orders = latest;
        if (hasNewOrder) notify("A new customer order has come in.");
        if (activeView === "orders" || activeView === "manager") render();
      } catch (error) {
        console.error("Could not refresh incoming orders.", error);
      }
    }, 30000);
  }
  function roleHome(role) {
    return { customer: "dashboard", manager: "manager", auditor: "auditor", seller: "seller", developer: "developer" }[role] || "dashboard";
  }
  function roleNav(role) {
    if (role === "customer") return [["dashboard", "⌂", "Discover"], ["orders", "▤", "My orders"], ["cart", "🛍", "Basket"]];
    if (role === "manager") return [["manager", "⌂", "Overview"], ["products", "▦", "Products"], ["stock", "◫", "Stock"], ["orders", "▤", "Orders"]];
    if (role === "auditor") return [["auditor", "◷", "Overview"], ["transactions", "▤", "Transactions"], ["stock", "◫", "Stock"]];
    if (role === "seller") return [["seller", "＋", "Quick sale"], ["orders", "▤", "Orders"], ["transactions", "▤", "Sales"]];
    return [["developer", "⌘", "Team & access"], ["manager", "⌂", "Business"], ["products", "▦", "Products"], ["stock", "◫", "Stock"], ["profile", "◉", "My profile"]];
  }
  function render() {
    const app = $("#app");
    app.innerHTML = state.user ? renderApp() : renderAuth();
    if (!app.dataset.imageFallback) {
      app.addEventListener("error", event => {
        if (event.target instanceof HTMLImageElement && !event.target.dataset.fallbackApplied) {
          event.target.dataset.fallbackApplied = "true";
          event.target.src = imageFallback;
        }
      }, true);
      app.dataset.imageFallback = "true";
    }
    bindEvents();
  }
  function renderAuth() {
    return `<main class="auth-shell"><section class="auth-art"><div class="brand-mark"><span class="brand-icon">🔥</span><span><span class="brand-name">Verus' Shisanyama</span><span class="brand-sub">Durban · KwaZulu-Natal</span></span></div><div><span class="eyebrow">Good food. Good fire. Good people.</span><h1>Your table,<br>our fire.</h1><p>Big Durban flavour, straight from the braai to your door. Find your next favourite and let us handle the coals.</p></div><span class="small">Proudly Durban · Prices in ZAR</span></section>
      <section class="auth-panel-wrap"><div class="auth-panel"><div class="brand-mark"><span class="brand-icon">🔥</span><span><span class="brand-name">Verus' Shisanyama</span><span class="brand-sub">A taste of Durban</span></span></div><h2>${authMode === "login" ? "Welcome back" : "Join the table"}</h2><p>${authMode === "login" ? "Sign in to find your fire." : "Create a customer account or request staff access."}</p>
        <div class="auth-tabs"><button type="button" class="${authMode === "login" ? "active" : ""}" data-auth-mode="login">Sign in</button><button type="button" class="${authMode === "signup" ? "active" : ""}" data-auth-mode="signup">Create account</button></div>
        ${authMode === "login" ? `<form id="login-form"><div class="form-field" style="margin-bottom:13px"><label for="login-email">Email</label><input class="input" id="login-email" name="email" type="email" required autocomplete="username"></div><div class="form-field" style="margin-bottom:18px"><label for="login-password">Password</label><input class="input" id="login-password" name="password" type="password" required autocomplete="current-password"></div><button class="btn btn-primary btn-wide">Sign in</button></form>` : renderSignup()}
        <p class="demo-note" style="margin-top:18px">Private staff accounts require developer approval. No demo passwords or default staff accounts are active.</p></div></section></main>`;
  }
  function renderSignup() {
    return `<form id="signup-form"><div class="field-grid">
      <div class="form-field"><label for="signup-role">Account type</label><select class="input" id="signup-role" name="role"><option value="customer">Customer</option><option value="manager">System manager (approval required)</option><option value="auditor">System auditor (approval required)</option><option value="seller">Stock seller (approval required)</option></select></div>
      <div id="signup-fields" class="form-field full">${signupFields("customer")}</div>
    </div><button class="btn btn-primary btn-wide" style="margin-top:16px">${authMode === "signup" ? "Create account / request access" : "Create account"}</button></form>`;
  }
  function signupFields(role) {
    const customer = role === "customer";
    return `<div class="field-grid">${customer
      ? `<div class="form-field full"><label for="signup-name">Full name</label><input class="input" id="signup-name" name="name" required autocomplete="name"></div>`
      : `<div class="form-field"><label for="signup-first">Name</label><input class="input" id="signup-first" name="firstName" required autocomplete="given-name"></div><div class="form-field"><label for="signup-surname">Surname</label><input class="input" id="signup-surname" name="surname" required autocomplete="family-name"></div>`}
      <div class="form-field"><label for="signup-email">Email</label><input class="input" id="signup-email" name="email" type="email" required autocomplete="email"></div>
      <div class="form-field"><label for="signup-phone">Phone number</label><input class="input" id="signup-phone" name="phone" type="tel" required autocomplete="tel"></div>
      <div class="form-field"><label for="signup-password">Password (12+ characters)</label><input class="input" id="signup-password" name="password" type="password" minlength="12" required autocomplete="new-password"></div>
      ${customer ? `<div class="form-field"><label for="signup-location">Area / address</label><input class="input" id="signup-location" name="location" required placeholder="Glenwood, Durban"></div><div class="form-field"><label for="signup-birthdate">Date of birth</label><input class="input" id="signup-birthdate" name="birthDate" type="date" required></div><div class="form-field full"><label for="signup-picture">Profile picture (optional)</label><input class="input" id="signup-picture" name="picture" type="file" accept="image/jpeg,image/png,image/webp"></div>`
        : `<div class="form-field full"><label for="signup-picture">Profile picture (required)</label><input class="input" id="signup-picture" name="picture" type="file" accept="image/jpeg,image/png,image/webp" required></div><p class="small muted form-field full">Your account is reviewed by the system developer before access is enabled.</p>`}
    </div>`;
  }
  function getCart() {
    if (!state.user) return [];
    try { return JSON.parse(localStorage.getItem(`verus-cart-${state.user.id}`) || "[]"); }
    catch { return []; }
  }
  function setCart(cart) {
    if (state.user) localStorage.setItem(`verus-cart-${state.user.id}`, JSON.stringify(cart));
    pendingOrderKey = null;
  }
  function isAdult() {
    if (!state.user?.birthDate) return false;
    const dob = new Date(state.user.birthDate), now = new Date();
    let years = now.getFullYear() - dob.getFullYear();
    if (now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate())) years--;
    return years >= 18;
  }
  function renderApp() {
    const role = state.user.role, nav = roleNav(role);
    const count = getCart().reduce((sum, item) => sum + item.quantity, 0);
    return `<div class="app-shell"><aside class="sidebar"><div class="brand-mark"><span class="brand-icon">🔥</span><span><span class="brand-name">Verus' Shisanyama</span><span class="brand-sub">Durban · KwaZulu-Natal</span></span></div>
      <div class="side-label">${escapeHtml(roles[role])} workspace</div><nav class="nav-list" aria-label="Main navigation">${nav.map(([view, icon, label]) => `<button class="nav-item ${activeView === view ? "active" : ""}" type="button" data-view="${view}"><span class="nav-icon">${icon}</span><span>${label}</span>${view === "cart" && count ? `<span class="count">${count}</span>` : ""}${view === "orders" && role === "seller" && state.orders?.some(order => order.status === "Awaiting proof review") ? `<span class="count">${state.orders.filter(order => order.status === "Awaiting proof review").length}</span>` : ""}</button>`).join("")}</nav>
      <div class="sidebar-bottom"><button class="nav-item" type="button" data-view="profile"><span class="nav-icon">◉</span><span>My profile</span></button><div class="account-mini"><span class="avatar">${state.user.profilePicture ? `<img src="${escapeHtml(state.user.profilePicture)}" alt="">` : escapeHtml(initials(state.user.name))}</span><div class="account-copy"><strong>${escapeHtml(state.user.name)}</strong><span>${escapeHtml(roles[role])}</span></div></div><button class="logout" type="button" data-action="logout">↗ &nbsp; Sign out</button></div></aside>
      <main class="main-area"><header class="topbar"><span class="topbar-title">${escapeHtml(titles[activeView] || "Verus' Shisanyama")}</span><div class="topbar-right"><span class="location-pill">📍 ${escapeHtml(state.user.location || "Durban, KZN")}</span><button class="btn btn-sm" type="button" data-view="profile"><span class="avatar" style="width:24px;height:24px;font-size:9px">${escapeHtml(initials(state.user.name))}</span><span>${escapeHtml(state.user.name.split(" ")[0])}</span></button><button class="btn btn-sm mobile-logout" type="button" data-action="logout" aria-label="Sign out">↗</button></div></header>
      <div class="content">${renderView()}</div></main></div>`;
  }
  function renderView() {
    switch (activeView) {
      case "dashboard": return state.user.role === "customer" ? renderDashboard() : denied();
      case "cart": return state.user.role === "customer" ? renderCart() : denied();
      case "orders": return ["customer", "manager", "seller", "developer"].includes(state.user.role) ? renderOrders() : denied();
      case "manager": return ["manager", "developer"].includes(state.user.role) ? renderManager() : denied();
      case "products": return ["manager", "developer"].includes(state.user.role) ? renderProducts() : denied();
      case "stock": return ["manager", "auditor", "developer"].includes(state.user.role) ? renderStock() : denied();
      case "auditor": return state.user.role === "auditor" ? renderAuditor() : denied();
      case "transactions": return ["auditor", "seller", "manager", "developer"].includes(state.user.role) ? renderTransactions() : denied();
      case "seller": return state.user.role === "seller" ? renderSeller() : denied();
      case "developer": return state.user.role === "developer" ? renderDeveloper() : denied();
      case "profile": return renderProfile();
      default: return denied();
    }
  }
  function denied() {
    return `<section class="access-denied"><div class="empty-icon">🔒</div><h2>This space isn't on your pass</h2><p>Your approved account does not have access to this area.</p><button class="btn btn-primary" type="button" data-view="${roleHome(state.user.role)}">Back to my workspace</button></section>`;
  }
  function estimateMinutes(address, prep) {
    const area = address.toLowerCase();
    const drive = /glenwood|berea|musgrave|durban central|morningside|umbilo/.test(area) ? 20
      : /umhlanga|westville|pinetown|hillcrest|bluff|newlands/.test(area) ? 35 : 50;
    return Number(prep) + drive;
  }
  function productCard(product) {
    return `<article class="product-card"><div class="product-photo"><img loading="lazy" src="${escapeHtml(product.image || imageFallback)}" alt="${escapeHtml(product.name)}"><span class="product-badge">${escapeHtml(product.category)}${product.ageRestricted ? " · 18+" : ""}</span></div><div class="product-body"><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.description)}</p><div class="product-meta"><span class="price">${money(product.price)}<span class="prep">⏱ ${product.prep} min prep</span></span><button class="btn ${product.inStock ? "btn-primary" : ""} btn-sm" type="button" data-add="${escapeHtml(product.id)}" ${product.inStock ? "" : "disabled"}>${product.inStock ? "＋ Add" : "Sold out"}</button></div></div></article>`;
  }
  function renderDashboard() {
    const products = state.products.filter(product => !product.ageRestricted || isAdult());
    const categories = ["All", ...new Set(products.map(product => product.category))];
    return `<section class="hero"><div class="hero-copy"><span class="eyebrow">Durban heat · Your kind of braai</span><h1>Good things take<br>fire.</h1><p>Proper coals, big flavour, and a little kick. Freshly made and ready to share.</p><button class="btn btn-primary" data-scroll="menu">Explore the menu &nbsp; →</button></div></section>
      <div class="section-head"><div><h2>Find your fire</h2><p>Fresh from the braai, right here in Durban.</p></div><input class="field" id="menu-search" type="search" placeholder="Search meals & drinks..." aria-label="Search meals and drinks"></div>
      <div class="filters">${categories.map(category => `<button class="chip ${activeCategory === category ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}</div>
      <div class="product-grid" id="menu" style="margin-top:15px">${menuCards()}</div>
      <div class="section-head"><div><h2>A little help with your order?</h2><p>Tell our menu guide what you’re craving.</p></div></div>
      <div class="ai-box"><div class="ai-title"><span class="ai-spark">✦</span> Verus' AI menu guide <span class="badge">Live assistant</span></div><p>A friendly, spicy suggestion, based on the real menu and prices.</p><form id="ai-form" class="search-row"><input class="field" name="prompt" maxlength="500" required placeholder="Something with a proper kick..."><button class="btn btn-dark">Get a suggestion</button></form><div id="ai-response"></div></div>`;
  }
  function menuCards(query = "") {
    const clean = query.trim().toLowerCase();
    const products = state.products.filter(product => (!product.ageRestricted || isAdult()) && (activeCategory === "All" || activeCategory === product.category) && (!clean || `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(clean)));
    return products.length ? products.map(productCard).join("") : `<div class="empty" style="grid-column:1/-1">No menu items match. Try another category or search.</div>`;
  }
  function renderCart() {
    const lines = getCart().map(item => ({ ...item, product: state.products.find(product => product.id === item.productId) })).filter(item => item.product);
    const subtotal = lines.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const delivery = subtotal ? (subtotal >= 450 ? 0 : 35) : 0;
    const eta = lines.length ? estimateMinutes(state.user.location || "Durban", Math.max(...lines.map(item => item.product.prep))) : 0;
    return `<div class="page-heading"><div><span class="eyebrow">Made for sharing</span><h1>Your basket</h1><p>Review your order before the coals get going.</p></div><button class="btn" data-view="dashboard">← Back to menu</button></div>
      <div class="cart-layout"><section class="panel"><div class="panel-head"><h2>Order items</h2><span class="muted small">${lines.reduce((sum, item) => sum + item.quantity, 0)} item(s)</span></div>${lines.length ? lines.map(item => `<div class="cart-row"><img src="${escapeHtml(item.product.image || imageFallback)}" alt=""><div class="cart-info"><strong>${escapeHtml(item.product.name)}</strong><span>${money(item.product.price)} each</span></div><div class="qty-control"><button data-cart-change="${escapeHtml(item.productId)}" data-delta="-1">−</button><b>${item.quantity}</b><button data-cart-change="${escapeHtml(item.productId)}" data-delta="1">+</button></div><strong>${money(item.product.price * item.quantity)}</strong></div>`).join("") : `<div class="empty">Your basket is waiting for something good.<br><br><button class="btn btn-primary" data-view="dashboard">Explore the menu</button></div>`}</section>
      <div><section class="panel"><div class="panel-head"><h2>Order summary</h2></div><div class="summary-line"><span>Subtotal</span><b>${money(subtotal)}</b></div><div class="summary-line"><span>Delivery</span><b>${subtotal ? (delivery ? money(delivery) : "On us") : money(0)}</b></div><div class="summary-line total"><span>Total</span><span>${money(subtotal + delivery)}</span></div><p class="small muted" style="margin:12px 0">${lines.length ? `About ${eta} minutes to ${escapeHtml(state.user.location || "Durban")}. This is an area-based estimate, not live routing.` : "Add menu items to see an estimated delivery time."}</p>${lines.length ? `<button class="btn btn-primary btn-wide" data-action="checkout-open">Continue to checkout</button>` : ""}</section>
      ${lines.length ? `<section class="panel hidden" id="checkout-panel"><div class="panel-head"><h2>Delivery & payment proof</h2></div><p class="small muted">Pay the business using its separately provided payment details, then attach proof. A manager will verify it; this app does not take or process payments.</p><form id="checkout-form"><div class="form-field" style="margin-bottom:12px"><label>Delivery address</label><input class="input" name="address" value="${escapeHtml(state.user.location || "")}" required maxlength="500"></div><div class="form-field" style="margin-bottom:12px"><label>Kitchen note (optional)</label><textarea class="input" name="note" maxlength="1000"></textarea></div><div class="form-field"><label>Proof of payment (PDF or image, max 4 MB)</label><input class="input" name="proof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required><span class="small muted">Visible only to you and authorized managers.</span></div><button type="submit" class="btn btn-primary btn-wide" style="margin-top:14px">Place order for ${money(subtotal + delivery)}</button></form></section>` : ""}</div></div>`;
  }
  function renderOrder(order) {
    const pct = { "Awaiting proof review": 15, "Payment approved": 35, Preparing: 60, Ready: 80, "Out for delivery": 94, Completed: 100, "Payment rejected": 8, Cancelled: 0 }[order.status] ?? 10;
    const staff = ["manager", "developer"].includes(state.user.role);
    const canProgress = staff && !["Awaiting proof review", "Payment rejected", "Completed", "Cancelled"].includes(order.status);
    const canReview = staff && order.status === "Awaiting proof review";
    const statuses = {
      "Awaiting proof review": ["Payment approved", "Payment rejected", "Cancelled"],
      "Payment approved": ["Preparing"],
      Preparing: ["Ready"],
      Ready: ["Out for delivery", "Completed"],
      "Out for delivery": ["Completed"]
    }[order.status] || [];
    return `<article class="order-card"><div class="order-top"><div><b>Order #${escapeHtml(order.id.slice(-6).toUpperCase())}</b><div class="muted small" style="margin-top:5px">${new Date(order.createdAt).toLocaleString("en-ZA")} · ${escapeHtml(order.customerName || "Your order")}</div></div><span class="badge ${escapeHtml(order.status.toLowerCase().replaceAll(" ", "-"))}">${escapeHtml(order.status)}</span></div><div class="order-items">${order.items.map(item => `${item.quantity} × ${escapeHtml(item.name)}`).join("<br>")}<br><b>Total ${money(order.total)}</b> · about ${order.eta} min</div>
      ${order.address ? `<div class="small muted" style="margin-top:7px">📍 ${escapeHtml(order.address)}</div>` : ""}<div class="progress-track"><span style="width:${pct}%"></span></div>
      ${canReview ? `<p class="small" style="margin:10px 0"><a class="btn btn-sm" href="/api/orders/${encodeURIComponent(order.id)}/proof" target="_blank" rel="noopener">View proof: ${escapeHtml(order.proofName || "download")} ↗</a></p><div class="form-actions"><button class="btn btn-danger btn-sm" data-order-status="Payment rejected" data-id="${escapeHtml(order.id)}">Reject proof & release stock</button><button class="btn btn-primary btn-sm" data-order-status="Payment approved" data-id="${escapeHtml(order.id)}">Approve & prepare</button></div>` : ""}
      ${canProgress ? `<div class="form-actions"><select class="input order-status" style="width:auto;min-height:32px;padding:4px 8px;font-size:11px" data-status-select="${escapeHtml(order.id)}">${statuses.map(status => `<option ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select><button class="btn btn-sm" data-action="save-order-status" data-id="${escapeHtml(order.id)}">Update status</button></div>` : ""}</article>`;
  }
  function stats(items) {
    return `<div class="stat-grid">${items.map(([label, value, note]) => `<div class="stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><span class="stat-note">${note}</span></div>`).join("")}</div>`;
  }
  function weeklyChart() {
    const days = state.analytics?.daily || [];
    if (!days.length) return `<section class="panel"><div class="panel-head"><h2>Sales · last 7 days</h2></div><div class="empty">Daily sales will appear here once orders are recorded.</div></section>`;
    const maximum = Math.max(...days.map(day => Number(day.revenue)), 1);
    return `<section class="panel"><div class="panel-head"><h2>Sales · last 7 days</h2><span class="muted small">Gross sales in ZAR</span></div><div class="weekly-chart">${days.map(day => {
      const height = Math.max(4, Number(day.revenue) / maximum * 100);
      const label = new Date(`${String(day.day).slice(0, 10)}T12:00:00`).toLocaleDateString("en-ZA", { weekday: "short" });
      return `<div class="weekly-chart-day"><span class="weekly-chart-value">${money(day.revenue)}</span><div class="weekly-chart-track"><span style="height:${height}%"></span></div><span class="weekly-chart-label">${escapeHtml(label)}</span></div>`;
    }).join("")}</div></section>`;
  }
  function renderOrders() {
    return `<div class="page-heading"><div><span class="eyebrow">Keep an eye on the braai</span><h1>${state.user.role === "customer" ? "My orders" : "Order desk"}</h1><p>${state.user.role === "customer" ? "Recent orders and preparation updates." : "Review incoming orders, payment proof and fulfilment."}</p></div></div>${state.orders.length ? state.orders.map(renderOrder).join("") : `<div class="panel empty">No orders just yet.</div>`}`;
  }
  function renderManager() {
    const a = state.analytics || {};
    const recent = state.transactions || [];
    return `<div class="page-heading"><div><span class="eyebrow">The business at a glance</span><h1>Good day, ${escapeHtml(state.user.name.split(" ")[0])}</h1><p>Here’s how the braai is doing.</p></div><button class="btn btn-primary" data-view="products">Manage menu →</button></div>
      ${stats([["Recorded sales", money(a.revenue), `${a.transactions || 0} transactions`], ["Estimated gross profit", money(a.profit), "Revenue less recorded product costs"], ["Orders to review", a.orders?.pending || 0, "Payment proof needs review"], ["Low stock", a.lowStock?.length || 0, "Restock recommended"]])}
      <div class="two-col"><section class="panel"><div class="panel-head"><h2>Recent sales</h2><button class="btn btn-quiet btn-sm" data-view="transactions">All transactions →</button></div>${transactionTable(recent.slice(0, 8))}</section><section class="panel"><div class="panel-head"><h2>Stock watch</h2><button class="btn btn-quiet btn-sm" data-view="stock">Stock room →</button></div>${(a.lowStock || []).map(item => `<div class="category-line"><span>${escapeHtml(item.name)}</span><b class="stock-low">${item.stock} left</b></div>`).join("") || `<div class="empty">No items below the 10-unit restock threshold.</div>`}</section></div>
      ${weeklyChart()}<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Incoming orders</h2><button class="btn btn-quiet btn-sm" data-view="orders">Order desk →</button></div>${state.orders.filter(order => order.status === "Awaiting proof review").slice(0, 3).map(renderOrder).join("") || `<div class="empty">No orders need payment review.</div>`}</section>`;
  }
  function renderProducts() {
    const products = state.manageProducts || [];
    const product = editingProduct ? products.find(item => item.id === editingProduct) : null;
    return `<div class="page-heading"><div><span class="eyebrow">Keep the menu fresh</span><h1>Product manager</h1><p>Add, update, price or hide meals and drinks.</p></div></div>
      <div class="two-col"><section class="panel"><div class="panel-head"><h2>${product ? "Update menu item" : "Add a menu item"}</h2></div>
      <form id="product-form" data-id="${product ? escapeHtml(product.id) : ""}"><div class="field-grid">
        <div class="form-field"><label>Product name</label><input class="input" name="name" required value="${escapeHtml(product?.name || "")}"></div>
        <div class="form-field"><label>Category</label><input class="input" name="category" required list="product-categories" value="${escapeHtml(product?.category || "")}"><datalist id="product-categories">${[...new Set(products.map(p => p.category))].map(c => `<option value="${escapeHtml(c)}">`).join("")}</datalist></div>
        <div class="form-field"><label>Selling price (ZAR)</label><input class="input" name="price" type="number" min=".01" step=".01" required value="${escapeHtml(product?.price ?? "")}"></div>
        <div class="form-field"><label>Purchase cost / unit (ZAR)</label><input class="input" name="cost" type="number" min="0" step=".01" required value="${escapeHtml(product?.cost ?? "")}"></div>
        <div class="form-field"><label>On-hand stock</label><input class="input" name="stock" type="number" min="0" step="1" required value="${escapeHtml(product?.stock ?? 0)}"></div>
        <div class="form-field"><label>Prep time (minutes)</label><input class="input" name="prep" type="number" min="0" step="1" required value="${escapeHtml(product?.prep ?? 15)}"></div>
        <div class="form-field full"><label>Description</label><textarea class="input" name="description" required>${escapeHtml(product?.description || "")}</textarea></div>
        <div class="form-field full"><label>Product picture (optional)</label><input class="input" name="picture" type="file" accept="image/jpeg,image/png,image/webp"><span class="small muted">JPEG, PNG or WebP; maximum 2 MB. Or set a secure HTTPS picture URL:</span><input class="input" name="image" type="url" placeholder="https://..."></div>
        <div class="form-field full"><label><input type="checkbox" name="ageRestricted" ${product?.ageRestricted ? "checked" : ""}> Restrict sale to customers aged 18+</label></div>
        ${product ? `<div class="form-field full"><label><input type="checkbox" name="active" ${product.active ? "checked" : ""}> Show on customer menu</label></div>` : ""}
      </div><div class="form-actions">${product ? `<button class="btn" type="button" data-action="cancel-edit">Cancel</button>` : ""}<button class="btn btn-primary">${product ? "Save changes" : "Add product"}</button></div></form></section>
      <section class="panel"><div class="panel-head"><h2>Current menu</h2></div><div class="category-line"><span>Listed items</span><b>${products.filter(p => p.active).length}</b></div><div class="category-line"><span>Categories</span><b>${new Set(products.map(p => p.category)).size}</b></div><div class="category-line"><span>Estimated profit on stock</span><b>${money(products.reduce((sum, p) => sum + Math.max(0, p.price - p.cost) * p.stock, 0))}</b></div></section></div>
      <section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Products</h2></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Selling</th><th>Cost</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead><tbody>${products.map(p => `<tr><td><div class="table-item"><img class="table-thumb" src="${escapeHtml(p.image || imageFallback)}" alt=""><div><b>${escapeHtml(p.name)}</b><div class="small muted">${escapeHtml(p.category)}</div></div></div></td><td>${money(p.price)}</td><td>${money(p.cost)}</td><td>${p.stock}</td><td><span class="badge ${p.active ? "" : "inactive"}">${p.active ? "Listed" : "Hidden"}</span></td><td><button class="btn btn-sm" data-edit-product="${escapeHtml(p.id)}">Edit</button> <button class="btn btn-danger btn-sm" data-delete-product="${escapeHtml(p.id)}">Hide</button></td></tr>`).join("")}</tbody></table></div></section>`;
  }
  function renderStock() {
    const stock = state.stock || { products: [], entries: [] };
    const value = stock.products.reduce((sum, p) => sum + p.cost * p.stock, 0);
    const profit = stock.products.reduce((sum, p) => sum + Math.max(0, p.price - p.cost) * p.stock, 0);
    return `<div class="page-heading"><div><span class="eyebrow">Count it. Cost it. Keep it fresh.</span><h1>Stock room</h1><p>Record deliveries and check the margin on remaining stock.</p></div></div>
      ${stats([["Stock items", stock.products.length, `${stock.products.filter(p => p.stock < 10).length} below restock threshold`], ["Purchase value", money(value), "Current quantity × unit cost"], ["Estimated sales value", money(value + profit), "If current stock sells"], ["Estimated gross profit", money(profit), "Before overheads and tax"]])}
      ${["manager", "developer"].includes(state.user.role) ? `<div class="two-col"><section class="panel"><div class="panel-head"><h2>Register incoming stock</h2></div><form id="stock-form"><div class="field-grid">
        <div class="form-field"><label>Existing product (optional)</label><select class="input" name="productId"><option value="">Create a new stock type</option>${stock.products.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}</select></div>
        <div class="form-field"><label>New product name</label><input class="input" name="name" placeholder="Leave blank for existing item"></div>
        <div class="form-field"><label>Category</label><input class="input" name="category" list="stock-categories" required><datalist id="stock-categories">${[...new Set(stock.products.map(p => p.category))].map(c => `<option value="${escapeHtml(c)}">`).join("")}</datalist></div>
        <div class="form-field"><label>Quantity received</label><input class="input" name="quantity" type="number" min="1" step="1" required></div>
        <div class="form-field"><label>Purchase price / unit</label><input class="input" name="purchasePrice" type="number" min="0" step=".01" required></div>
        <div class="form-field"><label>Selling price / unit</label><input class="input" name="sellingPrice" type="number" min=".01" step=".01" required></div>
      </div><div class="form-actions"><button class="btn btn-primary">Register delivery</button></div></form></section>
      <section class="panel"><div class="panel-head"><h2>On hand</h2><span class="muted small">Restock threshold: 10 units</span></div>${stock.products.map(p => `<div class="category-line"><span>${escapeHtml(p.name)} <span class="muted">· ${escapeHtml(p.category)}</span></span><b class="${p.stock < 10 ? "stock-low" : ""}">${p.stock}</b></div>`).join("")}</section></div>` : `<section class="panel"><div class="panel-head"><h2>Inventory</h2></div>${stock.products.map(p => `<div class="category-line"><span>${escapeHtml(p.name)} · ${escapeHtml(p.category)}</span><b>${p.stock} unit(s) · ${money(p.cost * p.stock)}</b></div>`).join("")}</section>`}
      <section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Recent stock entries</h2></div><div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Qty received</th><th>Purchase price</th><th>Selling price</th><th>Type</th><th>By</th><th>When</th></tr></thead><tbody>${stock.entries.map(e => `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.category)}</td><td>${e.quantity}</td><td>${money(e.purchase_price)}</td><td>${money(e.selling_price)}</td><td>${escapeHtml(e.entry_type)}</td><td>${escapeHtml(e.actor_name || "System")}</td><td>${new Date(e.created_at).toLocaleString("en-ZA")}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">No stock movements yet.</td></tr>`}</tbody></table></div></section>`;
  }
  function transactionTable(rows) {
    return rows?.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Sales</th><th>Est. profit</th><th>Staff</th><th>When</th></tr></thead><tbody>${rows.map(tx => `<tr><td>${escapeHtml(tx.name)}</td><td>${escapeHtml(tx.source)}</td><td>${tx.quantity}</td><td>${money(tx.total)}</td><td>${tx.cost == null ? "—" : money(Number(tx.total) - Number(tx.cost))}</td><td>${escapeHtml(tx.staff_name || "—")}</td><td>${new Date(tx.created_at).toLocaleString("en-ZA")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Sales will appear here as they are recorded.</div>`;
  }
  function renderTransactions() {
    const rows = state.transactions || [];
    const revenue = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const profit = rows.reduce((sum, row) => sum + Number(row.total) - Number(row.cost), 0);
    const cards = [["Transactions", rows.length, "Recorded sales"], ["Sales total", money(revenue), "Gross recorded sales"]];
    if (state.user.role === "seller") cards.push(["Units sold", rows.reduce((sum, row) => sum + row.quantity, 0), "Your sales"]);
    else cards.push(["Estimated profit", money(profit), "Before overheads and tax"], ["Units sold", rows.reduce((sum, row) => sum + row.quantity, 0), "All products"]);
    return `<div class="page-heading"><div><span class="eyebrow">Every sale, accounted for</span><h1>${state.user.role === "seller" ? "My sales" : "Transactions"}</h1><p>Recorded sales, revenue and estimated margins.</p></div></div>${stats(cards)}<section class="panel">${transactionTable(rows)}</section>`;
  }
  function renderAuditor() {
    const a = state.analytics || {};
    return `<div class="page-heading"><div><span class="eyebrow">Independent view</span><h1>Operations overview</h1><p>Review activity, stock movement and order status.</p></div></div>${stats([["All recorded sales", money(a.revenue), `${a.transactions || 0} transaction(s)`], ["Estimated gross profit", money(a.profit), "Sales less item costs"], ["Sales · last 7 days", money(a.weekRevenue), `${a.weekCount || 0} transactions`], ["Sales · last 30 days", money(a.monthRevenue), `${a.monthCount || 0} transactions`]])}
      <div class="two-col"><section class="panel"><div class="panel-head"><h2>Daily operations</h2><span class="badge">${a.orders?.total || 0} orders</span></div><div class="category-line"><span>Awaiting payment review</span><b>${a.orders?.pending || 0}</b></div><div class="category-line"><span>Completed orders</span><b>${a.orders?.completed || 0}</b></div><div class="category-line"><span>Low stock items</span><b class="${a.lowStock?.length ? "stock-low" : ""}">${a.lowStock?.length || 0}</b></div><div class="category-line"><span>Sales · last 7 days</span><b>${money(a.weekRevenue)}</b></div><div class="category-line"><span>Sales · last 30 days</span><b>${money(a.monthRevenue)}</b></div></section><section class="panel"><div class="panel-head"><h2>Stock watch</h2></div>${(a.lowStock || []).map(p => `<div class="category-line"><span>${escapeHtml(p.name)}</span><b class="stock-low">${p.stock} left</b></div>`).join("") || `<div class="empty">No low-stock items.</div>`}</section></div>${weeklyChart()}<section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Transactions</h2></div>${transactionTable(state.transactions)}</section>`;
  }
  function renderSeller() {
    const products = state.products;
    const sales = (state.transactions || []).filter(tx => tx.staff_id === state.user.id);
    return `<div class="page-heading"><div><span class="eyebrow">Quick counter sale</span><h1>What are we selling?</h1><p>Tap in the quantity, record the sale, keep the line moving.</p></div></div>${stats([["My recorded sales", money(sales.reduce((sum, tx) => sum + Number(tx.total), 0)), `${sales.length} sale line(s)`], ["Products available", products.length, "Current menu"]])}<section class="panel"><div class="panel-head"><h2>Tap a product to sell</h2><span class="muted small">Stock updates immediately</span></div><div class="seller-grid">${products.map(p => `<article class="seller-item"><img src="${escapeHtml(p.image || imageFallback)}" alt=""><h3>${escapeHtml(p.name)}</h3><div class="seller-price">${money(p.price)} · ${p.stock} in stock</div><input class="input" type="number" min="1" max="${p.stock}" value="1" id="sell-${escapeHtml(p.id)}" ${p.stock < 1 ? "disabled" : ""}>${p.ageRestricted ? `<label class="small"><input type="checkbox" id="age-${escapeHtml(p.id)}"> Customer is 18+</label>` : ""}<button class="btn btn-primary btn-wide btn-sm" data-sell="${escapeHtml(p.id)}" ${p.stock < 1 ? "disabled" : ""}>Sell</button></article>`).join("")}</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h2>Recent sales</h2></div>${transactionTable(sales)}</section>`;
  }
  function renderDeveloper() {
    const users = (state.users || []).filter(user => user.id !== state.user.id);
    return `<div class="page-heading"><div><span class="eyebrow">People & permissions</span><h1>Team and access</h1><p>Approve staff access and keep track of account activity.</p></div></div>${stats([["Team accounts", users.length, "Staff and customers"], ["Active staff", users.filter(u => u.active && u.role !== "customer").length, "Approved team accounts"], ["Access requests", users.filter(u => !u.active && u.role !== "customer").length, "Awaiting approval"]])}<section class="panel"><div class="panel-head"><h2>Accounts</h2></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th>Access</th></tr></thead><tbody>${users.map(user => `<tr><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td><select class="input" data-role="${escapeHtml(user.id)}" style="min-height:32px;width:auto">${["customer", "manager", "auditor", "seller"].map(role => `<option value="${role}" ${role === user.role ? "selected" : ""}>${escapeHtml(roles[role])}</option>`).join("")}</select></td><td><span class="badge ${user.active ? "" : "inactive"}">${user.active ? "Active" : "Pending approval"}</span></td><td>${user.last_login ? new Date(user.last_login).toLocaleString("en-ZA") : "Not yet"}</td><td><button class="btn btn-sm ${user.active ? "btn-danger" : "btn-primary"}" data-toggle-user="${escapeHtml(user.id)}" data-active="${user.active}">${user.active ? "Deactivate" : "Approve"}</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No other accounts.</td></tr>`}</tbody></table></div></section>`;
  }
  function renderProfile() {
    return `<div class="page-heading"><div><span class="eyebrow">The person behind the order</span><h1>My profile</h1><p>Review and update your account details.</p></div></div><section class="panel"><div class="profile-head"><span class="avatar">${state.user.profilePicture ? `<img src="${escapeHtml(state.user.profilePicture)}" alt="">` : escapeHtml(initials(state.user.name))}</span><div><h2>${escapeHtml(state.user.name)}</h2><p>${escapeHtml(roles[state.user.role])}</p></div></div><form id="profile-form"><div class="field-grid"><div class="form-field"><label>Full name</label><input class="input" name="name" required value="${escapeHtml(state.user.name)}"></div><div class="form-field"><label>Email</label><input class="input" name="email" type="email" required value="${escapeHtml(state.user.email)}"></div><div class="form-field"><label>Phone</label><input class="input" name="phone" value="${escapeHtml(state.user.phone || "")}"></div><div class="form-field"><label>Location / area</label><input class="input" name="location" value="${escapeHtml(state.user.location || "")}"></div>${state.user.role === "customer" ? `<div class="form-field"><label>Date of birth</label><input class="input" name="birthDate" type="date" value="${escapeHtml(state.user.birthDate || "")}"></div>` : ""}<div class="form-field full"><label>Update profile picture</label><input class="input" name="picture" type="file" accept="image/jpeg,image/png,image/webp"></div></div><div class="form-actions"><button class="btn btn-primary">Save profile</button></div></form></section>
      <section class="panel"><div class="panel-head"><h2>Change password</h2></div><form id="password-form"><div class="field-grid"><div class="form-field"><label>Current password</label><input class="input" name="currentPassword" type="password" required autocomplete="current-password"></div><div class="form-field"><label>New password (12+ characters)</label><input class="input" name="password" type="password" minlength="12" required autocomplete="new-password"></div></div><div class="form-actions"><button class="btn btn-primary">Change password</button></div></form></section>`;
  }
  function bindEvents() {
    $$("[data-auth-mode]").forEach(button => button.addEventListener("click", () => { authMode = button.dataset.authMode; render(); }));
    const signupRole = $("#signup-role");
    if (signupRole) signupRole.addEventListener("change", () => { $("#signup-fields").innerHTML = signupFields(signupRole.value); });
    const login = $("#login-form");
    if (login) login.addEventListener("submit", event => {
      event.preventDefault();
      run(async () => {
        const data = Object.fromEntries(new FormData(login));
        const result = await request("/api/auth/login", { method: "POST", body: data });
        state.user = result.user; activeView = roleHome(state.user.role); await loadWorkspace();
      });
    });
    const signup = $("#signup-form");
    if (signup) signup.addEventListener("submit", event => {
      event.preventDefault();
      run(async () => {
        const formData = new FormData(signup);
        const role = formData.get("role");
        if (role !== "customer") formData.set("name", `${formData.get("firstName")} ${formData.get("surname")}`.trim());
        const result = await request("/api/auth/signup", { method: "POST", body: formData });
        if (!result.user) { authMode = "login"; render(); notify(result.message); return; }
        state.user = result.user; activeView = "dashboard"; await loadWorkspace();
      });
    });
    $$("[data-view]").forEach(button => button.addEventListener("click", () => {
      activeView = button.dataset.view;
      if (activeView === "orders" && state.user && ["manager", "seller", "developer"].includes(state.user.role)) run(loadWorkspace);
      else render();
    }));
    $$("[data-action='logout']").forEach(button => button.addEventListener("click", () => run(async () => {
      await request("/api/auth/logout", { method: "POST", body: {} });
      state = { user: null, products: (await request("/api/products")).products, orders: [] }; activeView = "dashboard"; render();
    })));
    $$("[data-add]").forEach(button => button.addEventListener("click", () => addToCart(button.dataset.add)));
    $$("[data-category]").forEach(button => button.addEventListener("click", () => { activeCategory = button.dataset.category; render(); }));
    const search = $("#menu-search");
    if (search) search.addEventListener("input", () => { $("#menu").innerHTML = menuCards(search.value); bindAddButtons($("#menu")); });
    const aiForm = $("#ai-form");
    if (aiForm) aiForm.addEventListener("submit", event => {
      event.preventDefault();
      const prompt = new FormData(aiForm).get("prompt");
      run(async () => {
        const result = await request("/api/assistant", { method: "POST", body: { prompt } });
        $("#ai-response").innerHTML = `<div class="ai-response">${escapeHtml(result.answer)}</div>`;
      });
    });
    $$("[data-action='checkout-open']").forEach(button => button.addEventListener("click", () => { const panel = $("#checkout-panel"); panel.classList.toggle("hidden"); panel.scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
    $$("[data-cart-change]").forEach(button => button.addEventListener("click", () => changeCart(button.dataset.cartChange, Number(button.dataset.delta))));
    const checkout = $("#checkout-form");
    if (checkout) checkout.addEventListener("submit", event => {
      event.preventDefault();
      const submit = checkout.querySelector("[type=submit]");
      if (submit.disabled) return;
      submit.disabled = true;
      const formData = new FormData(checkout);
      formData.set("items", JSON.stringify(getCart()));
      pendingOrderKey ||= crypto.randomUUID();
      run(async () => {
        const result = await request("/api/orders", { method: "POST", headers: { "Idempotency-Key": pendingOrderKey }, body: formData });
        setCart([]); activeView = "orders"; await loadWorkspace(); notify(`Order placed. Estimated prep and delivery: about ${result.order.eta} minutes.`);
      }).finally(() => { if (submit.isConnected) submit.disabled = false; });
    });
    const productForm = $("#product-form");
    if (productForm) productForm.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(productForm);
      data.set("ageRestricted", String(data.has("ageRestricted")));
      if (productForm.dataset.id) {
        data.set("active", String(data.has("active")));
        run(async () => { await request(`/api/products/${encodeURIComponent(productForm.dataset.id)}`, { method: "PUT", body: data }); editingProduct = null; await loadWorkspace(); }, "Product updated.");
      } else run(async () => { await request("/api/products", { method: "POST", body: data }); await loadWorkspace(); }, "Product added to the menu.");
    });
    $$("[data-edit-product]").forEach(button => button.addEventListener("click", () => { editingProduct = button.dataset.editProduct; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    $$("[data-delete-product]").forEach(button => button.addEventListener("click", () => run(async () => { await request(`/api/products/${encodeURIComponent(button.dataset.deleteProduct)}`, { method: "DELETE" }); await loadWorkspace(); }, "Product hidden from the menu.")));
    $$("[data-action='cancel-edit']").forEach(button => button.addEventListener("click", () => { editingProduct = null; render(); }));
    const stockForm = $("#stock-form");
    if (stockForm) stockForm.addEventListener("submit", event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(stockForm));
      if (!data.productId) data.productId = null;
      run(async () => { await request("/api/stock/receive", { method: "POST", body: data }); await loadWorkspace(); }, "Stock delivery registered.");
    });
    $$("[data-sell]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.sell;
      const product = state.products.find(item => item.id === id);
      const quantity = Number($(`#sell-${CSS.escape(id)}`).value);
      run(async () => { await request("/api/sales", { method: "POST", body: { productId: id, quantity, ageConfirmed: product.ageRestricted && $(`#age-${CSS.escape(id)}`).checked } }); await loadWorkspace(); }, "Sale recorded and stock updated.");
    }));
    $$("[data-order-status]").forEach(button => button.addEventListener("click", () => updateOrder(button.dataset.id, button.dataset.orderStatus)));
    $$("[data-action='save-order-status']").forEach(button => button.addEventListener("click", () => updateOrder(button.dataset.id, $(`[data-status-select="${CSS.escape(button.dataset.id)}"]`).value)));
    $$("[data-toggle-user]").forEach(button => button.addEventListener("click", () => saveUser(button.dataset.toggleUser)));
    $$("[data-role]").forEach(select => select.addEventListener("change", () => {
      const user = state.users.find(item => item.id === select.dataset.role);
      if (user) saveUser(user.id, user.active);
    }));
    const profile = $("#profile-form");
    if (profile) profile.addEventListener("submit", event => {
      event.preventDefault();
      run(async () => { const user = await request("/api/profile", { method: "PUT", body: new FormData(profile) }); state.user = user.user; await loadWorkspace(); }, "Profile updated.");
    });
    const password = $("#password-form");
    if (password) password.addEventListener("submit", event => {
      event.preventDefault();
      run(async () => { await request("/api/profile/password", { method: "PUT", body: Object.fromEntries(new FormData(password)) }); await loadWorkspace(); }, "Password changed.");
    });
  }
  function bindAddButtons(root) {
    $$("[data-add]", root).forEach(button => button.addEventListener("click", () => addToCart(button.dataset.add)));
  }
  async function updateOrder(id, status) {
    await run(async () => { await request(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: { status } }); await loadWorkspace(); }, status === "Payment approved" ? "Payment proof approved. The kitchen can start." : status === "Payment rejected" ? "Payment rejected and reserved stock released." : "Order status updated.");
  }
  async function saveUser(id, activeOverride) {
    const button = $(`[data-toggle-user="${CSS.escape(id)}"]`);
    const select = $(`[data-role="${CSS.escape(id)}"]`);
    const active = activeOverride === undefined ? button?.dataset.active !== "true" : activeOverride;
    const role = select?.value || state.users.find(user => user.id === id)?.role;
    await run(async () => { await request(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { role, active } }); await loadWorkspace(); }, active ? "Account approved." : "Account access updated.");
  }
  function addToCart(id) {
    const product = state.products.find(item => item.id === id);
    if (!state.user) { authMode = "login"; render(); notify("Sign in to add items to your basket."); return; }
    if (!product || !product.active) return;
    if (product.ageRestricted && !isAdult()) { notify("This product is only available to customers aged 18 or older.", true); return; }
    const cart = getCart(), found = cart.find(item => item.productId === id);
    const next = (found?.quantity || 0) + 1;
    if (Number.isFinite(product.stock) && next > product.stock) { notify("That item is low in stock. Choose a smaller quantity.", true); return; }
    if (found) found.quantity = next; else cart.push({ productId: id, quantity: 1 });
    setCart(cart); render(); notify(`${product.name} added to your basket.`);
  }
  function changeCart(id, delta) {
    const cart = getCart(), item = cart.find(line => line.productId === id);
    const product = state.products.find(line => line.id === id);
    if (!item || !product) return;
    const next = item.quantity + delta;
    if (Number.isFinite(product.stock) && next > product.stock) { notify("There isn't enough stock for that quantity.", true); return; }
    setCart(next <= 0 ? cart.filter(line => line.productId !== id) : cart.map(line => line.productId === id ? { ...line, quantity: next } : line));
    render();
  }

  loadWorkspace().catch(error => {
    console.error("Could not load Verus data.", error);
    $("#app").innerHTML = `<main class="auth-panel-wrap"><section class="access-denied"><h2>We couldn't connect to Verus</h2><p>${escapeHtml(error.message)} Check that the server and database are running, then try again.</p><button class="btn btn-primary" id="retry-connection">Try again</button></section></main>`;
    $("#retry-connection").addEventListener("click", () => loadWorkspace().catch(retryError => notify(retryError.message, true)));
  });
})();
