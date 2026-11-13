"use strict";

process.env.DATABASE_URL ||= "postgres://verus:test@127.0.0.1:5432/verus_test";
process.env.SESSION_SECRET ||= "unit-test-session-secret-with-more-than-32-characters";
process.env.BOOTSTRAP_ADMIN_EMAIL ||= "admin@example.test";
process.env.BOOTSTRAP_ADMIN_PASSWORD ||= "unit-test-only-password-never-used";

const test = require("node:test");
const assert = require("node:assert/strict");
const { app, estimateDeliveryMinutes, isAdult, validBirthDate, jsonProduct, orderJson } = require("../server");

test("delivery estimates use configured Durban-area bands", () => {
  assert.equal(estimateDeliveryMinutes("Glenwood, Durban"), 20);
  assert.equal(estimateDeliveryMinutes("Umhlanga"), 35);
  assert.equal(estimateDeliveryMinutes("Outer West, Durban"), 50);
});

test("age gate rejects missing dates and customers under 18", () => {
  assert.equal(isAdult(null), false);
  const underage = new Date();
  underage.setFullYear(underage.getFullYear() - 17);
  assert.equal(isAdult(underage.toISOString().slice(0, 10)), false);
});

test("age gate accepts an adult by exact calendar age", () => {
  const adult = new Date();
  adult.setFullYear(adult.getFullYear() - 18);
  adult.setDate(adult.getDate() - 1);
  assert.equal(isAdult(adult.toISOString().slice(0, 10)), true);
});

test("date-of-birth validation rejects invalid, missing and future dates", () => {
  assert.equal(validBirthDate("2000-02-29"), true);
  assert.equal(validBirthDate("2021-02-31"), false);
  assert.equal(validBirthDate(new Date(Date.now() + 86400000).toISOString().slice(0, 10)), false);
  assert.equal(validBirthDate(""), false);
});

test("public product data does not expose inventory or purchase costs", () => {
  const product = { id: "p1", name: "Wors", category: "Braai", price: "89.00", cost: "46.00", stock: 7, prep: 20, description: "", image: "", active: true, age_restricted: false };
  const publicView = jsonProduct(product);
  assert.equal("cost" in publicView, false);
  assert.equal("stock" in publicView, false);
  assert.equal(publicView.inStock, true);
  const managerView = jsonProduct(product, true, true);
  assert.equal(managerView.cost, 46);
  assert.equal(managerView.stock, 7);
});

test("customer order responses omit unit costs", () => {
  const order = { id: "order1", customer_id: "customer1", customer_name: "Customer", status: "Preparing", address: "Durban", note: "", subtotal: "89", delivery: "35", total: "124", eta: 30, proof_name: "proof.pdf", created_at: new Date(), items: [{ productId: "p1", name: "Wors", quantity: 1, price: 89, cost: 46 }] };
  const customerView = orderJson(order, "customer");
  assert.equal("cost" in customerView.items[0], false);
  assert.equal("address" in customerView, true);
  const sellerView = orderJson(order, "seller");
  assert.equal(sellerView.address, undefined);
});

test("HTTP surface hides source and private upload directories and rejects anonymous stock access", async t => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const [home, source, privateUpload, stock, csrf] = await Promise.all([
    fetch(`${base}/`),
    fetch(`${base}/server.js`),
    fetch(`${base}/private_uploads/proof.pdf`),
    fetch(`${base}/api/stock`),
    fetch(`${base}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "XMLHttpRequest" }, body: "{}" })
  ]);
  assert.equal(home.status, 200);
  assert.equal(source.status, 404);
  assert.equal(privateUpload.status, 404);
  assert.equal(stock.status, 401);
  assert.equal(csrf.status, 403);
  assert.equal(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
});
