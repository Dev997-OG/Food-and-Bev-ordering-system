"use strict";

require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const connectPgSimple = require("connect-pg-simple");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, "public_uploads");
const privateDirectory = path.join(__dirname, "private_uploads");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /replace-with/i.test(process.env.SESSION_SECRET)) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (!process.env.BOOTSTRAP_ADMIN_EMAIL || /yourdomain/i.test(process.env.BOOTSTRAP_ADMIN_EMAIL)
  || !process.env.BOOTSTRAP_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD.length < 14
  || /replace-with/i.test(process.env.BOOTSTRAP_ADMIN_PASSWORD)) {
  throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and a unique BOOTSTRAP_ADMIN_PASSWORD of at least 14 characters.");
}

if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.PG_POOL_SIZE || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 15000
});
pool.on("error", error => console.error("Unexpected PostgreSQL pool error.", error));

const PgSessionStore = connectPgSimple(session);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use((req, _res, next) => {
  req.body ||= {};
  next();
});
app.use(session({
  name: "verus.sid",
  store: new PgSessionStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, publicDirectory),
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 12, fieldSize: 16 * 1024, parts: 13 },
  fileFilter: (_req, file, callback) => ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
    ? callback(null, true) : callback(badRequest("Upload a JPEG, PNG or WebP image."))
});
const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, privateDirectory),
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.upload`)
  }),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4, fieldSize: 16 * 1024, parts: 5 },
  fileFilter: (_req, file, callback) => ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
    ? callback(null, true) : callback(badRequest("Upload a PDF, JPEG, PNG or WebP proof of payment."))
});

const defaultProducts = [
  ["Flame-Grilled Boerewors", "Braai", 89, 46, 32, 20, "Locally made wors, kissed by the coals.", "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=650&q=80", false],
  ["Peri-Peri Chicken", "Braai", 145, 77, 21, 30, "Durban heat, smoky char, and a bright peri-peri kick.", "https://images.unsplash.com/photo-1532634896-26909d0d4b68?auto=format&fit=crop&w=650&q=80", false],
  ["Beef Short Ribs", "Braai", 189, 104, 17, 40, "Slow-cooked, charred edges, sticky basting.", "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=650&q=80", false],
  ["Pap & Chakalaka", "Sides", 48, 19, 42, 15, "Creamy pap with a punchy house chakalaka.", "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=650&q=80", false],
  ["Braai Platter for Two", "Platters", 325, 174, 9, 45, "Wors, ribs, chicken, pap and two sides.", "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=650&q=80", false],
  ["Umqombothi (500ml)", "Drinks", 55, 27, 15, 3, "Traditional, locally brewed and chilled. 18+ only.", "https://images.unsplash.com/photo-1513558161293-cdaf765edfd7?auto=format&fit=crop&w=650&q=80", true],
  ["Ginger Beer (330ml)", "Drinks", 28, 11, 30, 2, "Cold, sparkling and full of ginger warmth.", "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=650&q=80", false],
  ["Grilled Snoek", "Braai", 165, 89, 10, 35, "Fire-grilled snoek with lemon and herbs.", "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=650&q=80", false]
];

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  birth_date DATE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','manager','auditor','seller','developer')),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  profile_picture TEXT,
  auth_version INTEGER NOT NULL DEFAULT 0,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  cost NUMERIC(12,2) NOT NULL CHECK (cost >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  prep INTEGER NOT NULL DEFAULT 15 CHECK (prep >= 0),
  description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_active_category_idx ON products (active, category);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('Awaiting proof review','Payment approved','Preparing','Ready','Out for delivery','Completed','Payment rejected','Cancelled')),
  idempotency_key TEXT,
  address TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(12,2) NOT NULL,
  delivery NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  eta INTEGER NOT NULL,
  proof_path TEXT NOT NULL,
  proof_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_entries (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  purchase_price NUMERIC(12,2) NOT NULL,
  selling_price NUMERIC(12,2) NOT NULL,
  entry_type TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  cost NUMERIC(12,2) NOT NULL,
  staff_id TEXT REFERENCES users(id),
  order_id TEXT REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transactions_created_idx ON transactions (created_at DESC);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_customer_idempotency_idx ON orders (customer_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
`;

const id = () => crypto.randomUUID();
const dummyPasswordHash = bcrypt.hashSync("not-a-real-verus-password", 12);
const cleanEmail = value => String(value || "").trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validImageUrl = value => {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
};
const validBirthDate = value => {
  if (!value) return false;
  const date = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > new Date().toISOString().slice(0, 10)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const jsonUser = user => ({
  id: user.id, name: user.name, email: user.email, phone: user.phone,
  location: user.location, birthDate: user.birth_date, role: user.role,
  active: user.active, profilePicture: user.profile_picture, lastLogin: user.last_login
});
const jsonProduct = (product, inventory = false, financials = false) => ({
  id: product.id, name: product.name, category: product.category,
  price: Number(product.price), ...(inventory ? { stock: product.stock } : {}),
  ...(financials ? { cost: Number(product.cost) } : {}),
  inStock: Number(product.stock) > 0,
  prep: product.prep, description: product.description, image: product.image,
  active: product.active, ageRestricted: product.age_restricted
});
const badRequest = (message, status = 400) => Object.assign(new Error(message), { status, isOperational: true });
const transaction = async callback => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
const requireAuth = async (req, res, next) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: "Sign in to continue." });
    const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]);
    const user = rows[0];
    if (!user || !user.active || user.auth_version !== req.session.authVersion) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "This account is inactive. Contact an administrator." });
    }
    req.user = user;
    next();
  } catch (error) { next(error); }
};
const allow = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Your account cannot access this area." });
  next();
};
const sameOrigin = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const host = req.get("host");
  const expected = `${req.protocol}://${host}`;
  if (!origin || origin !== expected || req.get("x-requested-with") !== "XMLHttpRequest") {
    return res.status(403).json({ error: "Request could not be verified. Reload the page and try again." });
  }
  next();
};
app.use("/api", sameOrigin);
const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please wait a little and try again." }
});

async function validateUpload(file, privateFile = false) {
  if (!file) return null;
  const handle = await fs.open(file.path, "r");
  const buffer = Buffer.alloc(16);
  try { await handle.read(buffer, 0, buffer.length, 0); }
  finally { await handle.close(); }
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  const pdf = buffer.toString("ascii", 0, 5) === "%PDF-";
  const extension = jpeg ? "jpg" : png ? "png" : webp ? "webp" : pdf && privateFile ? "pdf" : "";
  if (!extension || (!privateFile && extension === "pdf")) {
    await fs.rm(file.path, { force: true });
    throw badRequest("Upload a valid JPEG, PNG or WebP image" + (privateFile ? " or PDF." : "."));
  }
  const directory = privateFile ? privateDirectory : publicDirectory;
  const finalPath = path.join(directory, `${path.basename(file.filename, ".upload")}.${extension}`);
  await fs.rename(file.path, finalPath);
  file.path = finalPath;
  file.filename = path.basename(finalPath);
  return file;
}

app.get("/healthz", async (_req, res, next) => {
  try { await pool.query("SELECT 1"); res.json({ status: "ok" }); }
  catch (error) { next(error); }
});
app.get("/api/bootstrap", async (req, res, next) => {
  try {
    const [{ rows: products }, { rows: userRows }] = await Promise.all([
      pool.query("SELECT * FROM products WHERE active=TRUE ORDER BY category,name"),
      req.session.userId ? pool.query("SELECT * FROM users WHERE id=$1", [req.session.userId]) : Promise.resolve({ rows: [] })
    ]);
    const sessionUser = userRows[0];
    const user = sessionUser?.active && sessionUser.auth_version === req.session.authVersion ? jsonUser(sessionUser) : null;
    if (sessionUser && !user) req.session.destroy(() => {});
    let orders = [];
    if (user) {
      const { rows } = user.role === "customer"
        ? await pool.query("SELECT o.*,u.name AS customer_name, json_agg(json_build_object('productId',oi.product_id,'name',oi.name,'quantity',oi.quantity,'price',oi.unit_price,'cost',oi.unit_cost) ORDER BY oi.name) AS items FROM orders o JOIN users u ON u.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id,u.name ORDER BY o.created_at DESC LIMIT 100", [user.id])
        : ["manager", "seller", "developer"].includes(user.role)
          ? await pool.query("SELECT o.*,u.name AS customer_name, json_agg(json_build_object('productId',oi.product_id,'name',oi.name,'quantity',oi.quantity,'price',oi.unit_price,'cost',oi.unit_cost) ORDER BY oi.name) AS items FROM orders o JOIN users u ON u.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id,u.name ORDER BY o.created_at DESC LIMIT 100")
          : { rows: [] };
      orders = rows.map(row => orderJson(row, user.role));
    }
    const inventory = user && ["manager", "auditor", "seller", "developer"].includes(user.role);
    const financials = user && ["manager", "auditor", "developer"].includes(user.role);
    res.json({ user, products: products.map(product => jsonProduct(product, inventory, financials)), orders });
  } catch (error) { next(error); }
});

function orderJson(order, role) {
  const showAddress = ["manager", "developer", "customer"].includes(role);
  return {
    id: order.id, customerId: order.customer_id, customerName: order.customer_name,
    status: order.status, address: showAddress ? order.address : undefined,
    note: showAddress ? order.note : undefined, subtotal: Number(order.subtotal),
    delivery: Number(order.delivery), total: Number(order.total), eta: order.eta,
    proofName: ["manager", "developer"].includes(role) ? order.proof_name : undefined,
    createdAt: order.created_at,     items: order.items.map(item => {
      if (["manager", "developer"].includes(role)) return item;
      const { cost: _cost, ...customerItem } = item;
      return customerItem;
    })
  };
}

app.post("/api/auth/signup", authLimit, imageUpload.single("picture"), async (req, res, next) => {
  try {
    if (req.file) await validateUpload(req.file);
    const role = String(req.body.role || "customer");
    const name = String(req.body.name || "").trim();
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    const phone = String(req.body.phone || "").trim();
    const location = String(req.body.location || "").trim();
    const birthDate = req.body.birthDate || null;
    if (!["customer", "manager", "auditor", "seller"].includes(role)) throw badRequest("Choose a valid account type.");
    if (!name || name.length > 120 || !validEmail(email) || password.length < 12 || password.length > 200 || !phone || phone.length > 40) {
      throw badRequest("Enter a name, valid email, phone number and password of at least 12 characters.");
    }
    if (role === "customer" && (!location || location.length > 500)) throw badRequest("Enter your delivery area or address.");
    if (role !== "customer" && !req.file) throw badRequest("Staff access requests need a profile picture.");
    if (role === "customer" && !validBirthDate(birthDate)) throw badRequest("Enter a valid date of birth.");
    if (birthDate && !validBirthDate(birthDate)) throw badRequest("Enter a valid date of birth.");
    const passwordHash = await bcrypt.hash(password, 12);
    const active = role === "customer";
    const userId = id();
    const { rows } = await pool.query(
      "INSERT INTO users (id,name,email,phone,location,birth_date,password_hash,role,active,profile_picture) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
      [userId, name, email, phone, location, birthDate, passwordHash, role, active, req.file ? `/uploads/${req.file.filename}` : null]
    );
    if (!active) return res.status(202).json({ message: "Staff access request sent. A developer must approve the account." });
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = userId;
      req.session.authVersion = rows[0].auth_version;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        res.status(201).json({ user: jsonUser(rows[0]) });
      });
    });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", authLimit, async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");
    const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
    const user = rows[0];
    const matches = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, dummyPasswordHash);
    if (!matches) return res.status(401).json({ error: "Email or password is incorrect." });
    if (!user.active) return res.status(401).json({ error: "This staff account is awaiting developer approval." });
    await pool.query("UPDATE users SET last_login=NOW() WHERE id=$1", [user.id]);
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.authVersion = user.auth_version;
      req.session.save(saveError => {
        if (saveError) return next(saveError);
        user.last_login = new Date();
        res.json({ user: jsonUser(user) });
      });
    });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", requireAuth, (req, res, next) => {
  req.session.destroy(error => {
    if (error) return next(error);
    res.clearCookie("verus.sid", { httpOnly: true, secure: isProduction, sameSite: "lax" });
    res.status(204).end();
  });
});

app.get("/api/products", async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products WHERE active=TRUE ORDER BY category,name");
    res.json({ products: rows.map(product => jsonProduct(product)) });
  } catch (error) { next(error); }
});
app.get("/api/products/manage", requireAuth, allow("manager", "developer"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products ORDER BY category,name");
    res.json({ products: rows.map(product => jsonProduct(product, true, true)) });
  } catch (error) { next(error); }
});
app.post("/api/products", requireAuth, allow("manager", "developer"), imageUpload.single("picture"), async (req, res, next) => {
  try {
    if (req.file) await validateUpload(req.file);
    const { name, category, description = "" } = req.body;
    const price = Number(req.body.price), cost = Number(req.body.cost), stock = Number(req.body.stock), prep = Number(req.body.prep);
    if (typeof name !== "string" || typeof category !== "string" || typeof description !== "string" || !name.trim() || name.length > 120 || !category.trim() || category.length > 80 || !description.trim() || description.length > 1000 || !Number.isFinite(price) || price <= 0 || price > 1000000 || !Number.isFinite(cost) || cost < 0 || cost > 1000000 || !Number.isInteger(stock) || stock < 0 || stock > 1000000 || !Number.isInteger(prep) || prep < 0 || prep > 720 || !validImageUrl(req.body.image)) {
      throw badRequest("Check the product name, category, description, prices, stock and preparation time.");
    }
    const image = req.file ? `/uploads/${req.file.filename}` : (req.body.image || "");
    const created = await transaction(async client => {
      const { rows } = await client.query(
        "INSERT INTO products (id,name,category,description,price,cost,stock,prep,image,age_restricted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [id(), name.trim(), category.trim(), description.trim(), price, cost, stock, prep, image, req.body.ageRestricted === "true"]
      );
      if (stock > 0) await client.query("INSERT INTO stock_entries (id,product_id,name,category,quantity,purchase_price,selling_price,entry_type,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'Opening stock',$8)",
        [id(), rows[0].id, rows[0].name, rows[0].category, stock, cost, price, req.user.id]);
      return rows[0];
    });
    res.status(201).json({ product: jsonProduct(created, true, true) });
  } catch (error) { next(error); }
});
app.put("/api/products/:id", requireAuth, allow("manager", "developer"), imageUpload.single("picture"), async (req, res, next) => {
  try {
    if (req.file) await validateUpload(req.file);
    const name = String(req.body.name || "").trim(), category = String(req.body.category || "").trim();
    const description = String(req.body.description || "").trim();
    const price = Number(req.body.price), cost = Number(req.body.cost), stock = Number(req.body.stock), prep = Number(req.body.prep);
    if (!name || name.length > 120 || !category || category.length > 80 || !description || description.length > 1000 || !Number.isFinite(price) || price <= 0 || price > 1000000 || !Number.isFinite(cost) || cost < 0 || cost > 1000000 || !Number.isInteger(stock) || stock < 0 || stock > 1000000 || !Number.isInteger(prep) || prep < 0 || prep > 720 || !validImageUrl(req.body.image)) {
      throw badRequest("Check the product fields and prices.");
    }
    const updated = await transaction(async client => {
      const previous = await client.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [req.params.id]);
      if (!previous.rows[0]) throw badRequest("Product not found.", 404);
      const image = req.file ? `/uploads/${req.file.filename}` : (req.body.image || previous.rows[0].image);
      const { rows } = await client.query(
        "UPDATE products SET name=$2,category=$3,description=$4,price=$5,cost=$6,stock=$7,prep=$8,image=$9,active=$10,age_restricted=$11,updated_at=NOW() WHERE id=$1 RETURNING *",
        [req.params.id, name, category, description, price, cost, stock, prep, image, req.body.active !== "false", req.body.ageRestricted === "true"]
      );
      const change = stock - previous.rows[0].stock;
      if (change !== 0) await client.query("INSERT INTO stock_entries (id,product_id,name,category,quantity,purchase_price,selling_price,entry_type,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'Stock adjustment',$8)",
        [id(), rows[0].id, name, category, change, cost, price, req.user.id]);
      return rows[0];
    });
    res.json({ product: jsonProduct(updated, true, true) });
  } catch (error) { next(error); }
});
app.delete("/api/products/:id", requireAuth, allow("manager", "developer"), async (req, res, next) => {
  try {
    const result = await pool.query("UPDATE products SET active=FALSE,updated_at=NOW() WHERE id=$1", [req.params.id]);
    if (!result.rowCount) throw badRequest("Product not found.", 404);
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/stock", requireAuth, allow("manager", "auditor", "developer"), async (_req, res, next) => {
  try {
    const [{ rows: products }, { rows: entries }] = await Promise.all([
      pool.query("SELECT * FROM products ORDER BY category,name"),
      pool.query("SELECT s.*,u.name AS actor_name FROM stock_entries s LEFT JOIN users u ON u.id=s.actor_id ORDER BY s.created_at DESC LIMIT 200")
    ]);
    res.json({ products: products.map(product => jsonProduct(product, true, true)), entries });
  } catch (error) { next(error); }
});
app.post("/api/stock/receive", requireAuth, allow("manager", "developer"), async (req, res, next) => {
  try {
    const quantity = Number(req.body.quantity), purchasePrice = Number(req.body.purchasePrice), sellingPrice = Number(req.body.sellingPrice);
    const category = String(req.body.category || "").trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000 || !Number.isFinite(purchasePrice) || purchasePrice < 0 || purchasePrice > 1000000 || !Number.isFinite(sellingPrice) || sellingPrice <= 0 || sellingPrice > 1000000 || !category) throw badRequest("Enter a valid quantity, category and prices.");
    const result = await transaction(async client => {
      let product;
      if (req.body.productId) {
        const found = await client.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [req.body.productId]);
        product = found.rows[0];
        if (!product) throw badRequest("Product not found.", 404);
        if (product.stock + quantity > 1000000) throw badRequest("The resulting stock quantity is too large.");
        const updated = await client.query("UPDATE products SET stock=stock+$2,cost=$3,price=$4,category=$5,updated_at=NOW() WHERE id=$1 RETURNING *",
          [product.id, quantity, purchasePrice, sellingPrice, category]);
        product = updated.rows[0];
      } else {
        const name = String(req.body.name || "").trim();
        if (!name) throw badRequest("Enter a name for the new stock type.");
        const inserted = await client.query("INSERT INTO products (id,name,category,price,cost,stock,prep,description,image,active) VALUES ($1,$2,$3,$4,$5,$6,15,$7,$8,TRUE) RETURNING *",
          [id(), name, category, sellingPrice, purchasePrice, quantity, "Fresh from Verus' kitchen.", ""]);
        product = inserted.rows[0];
      }
      await client.query("INSERT INTO stock_entries (id,product_id,name,category,quantity,purchase_price,selling_price,entry_type,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'Delivery',$8)",
        [id(), product.id, product.name, category, quantity, purchasePrice, sellingPrice, req.user.id]);
      return jsonProduct(product, true, true);
    });
    res.status(201).json({ product: result });
  } catch (error) { next(error); }
});

app.get("/api/orders", requireAuth, allow("customer", "manager", "seller", "developer"), async (req, res, next) => {
  try {
    const query = req.user.role === "customer"
      ? "SELECT o.*,u.name AS customer_name,json_agg(json_build_object('productId',oi.product_id,'name',oi.name,'quantity',oi.quantity,'price',oi.unit_price,'cost',oi.unit_cost) ORDER BY oi.name) AS items FROM orders o JOIN users u ON u.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=$1 GROUP BY o.id,u.name ORDER BY o.created_at DESC"
      : "SELECT o.*,u.name AS customer_name,json_agg(json_build_object('productId',oi.product_id,'name',oi.name,'quantity',oi.quantity,'price',oi.unit_price,'cost',oi.unit_cost) ORDER BY oi.name) AS items FROM orders o JOIN users u ON u.id=o.customer_id JOIN order_items oi ON oi.order_id=o.id GROUP BY o.id,u.name ORDER BY o.created_at DESC";
    const { rows } = await pool.query(query, req.user.role === "customer" ? [req.user.id] : []);
    res.json({ orders: rows.map(row => orderJson(row, req.user.role)) });
  } catch (error) { next(error); }
});
app.post("/api/orders", requireAuth, allow("customer"), proofUpload.single("proof"), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest("Attach a proof-of-payment image or PDF.");
    await validateUpload(req.file, true);
    const address = String(req.body.address || "").trim();
    const idempotencyKey = String(req.get("idempotency-key") || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw badRequest("Refresh the checkout and try placing your order again.");
    let items;
    try { items = JSON.parse(req.body.items || "[]"); }
    catch { throw badRequest("Your basket could not be read. Please review it."); }
    if (!address || address.length > 500 || !Array.isArray(items) || items.length < 1 || items.length > 30) throw badRequest("Enter a delivery address and valid basket.");
    const quantities = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw badRequest("Your basket contains an invalid item.");
      const productId = String(item.productId || "");
      const quantity = Number(item.quantity);
      if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw badRequest("Basket quantities must be whole numbers from 1 to 99.");
      quantities.set(productId, (quantities.get(productId) || 0) + quantity);
      if (quantities.get(productId) > 99) throw badRequest("A product quantity cannot exceed 99.");
    }
    const orderId = id();
    const result = await transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${req.user.id}:${idempotencyKey}`]);
      const previous = await client.query("SELECT id,total,eta FROM orders WHERE customer_id=$1 AND idempotency_key=$2", [req.user.id, idempotencyKey]);
      if (previous.rows[0]) return { id: previous.rows[0].id, total: Number(previous.rows[0].total), eta: previous.rows[0].eta, duplicate: true };
      const ordered = [];
      for (const [productId, quantity] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const { rows } = await client.query("SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE", [productId]);
        const product = rows[0];
        if (!product || product.stock < quantity) throw badRequest(`${product?.name || "A menu item"} is no longer available in that quantity.`, 409);
        if (product.age_restricted && !isAdult(req.user.birth_date)) throw badRequest("This item is only available to customers aged 18 or older.", 403);
        ordered.push({ product, quantity });
      }
      const subtotalCents = ordered.reduce((sum, item) => sum + Math.round(Number(item.product.price) * 100) * item.quantity, 0);
      const subtotal = subtotalCents / 100;
      const delivery = subtotal >= 450 ? 0 : 35;
      const eta = Math.max(...ordered.map(item => item.product.prep)) + estimateDeliveryMinutes(address);
      const proofExtension = path.extname(req.file.filename);
      const proofName = `${path.basename(req.file.originalname.replace(/[\\/]/g, "_"), path.extname(req.file.originalname).replace(/[\\/]/g, "")).replace(/[^\w .()-]/g, "_").slice(0, 150)}${proofExtension}`;
      await client.query("INSERT INTO orders (id,customer_id,status,address,note,subtotal,delivery,total,eta,proof_path,proof_name,idempotency_key) VALUES ($1,$2,'Awaiting proof review',$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [orderId, req.user.id, address, String(req.body.note || "").slice(0, 1000), subtotal, delivery, subtotal + delivery, eta, req.file.path, proofName, idempotencyKey]);
      for (const { product, quantity } of ordered) {
        await client.query("INSERT INTO order_items (id,order_id,product_id,name,quantity,unit_price,unit_cost) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id(), orderId, product.id, product.name, quantity, product.price, product.cost]);
        await client.query("UPDATE products SET stock=stock-$2,updated_at=NOW() WHERE id=$1", [product.id, quantity]);
      }
      return { id: orderId, total: subtotal + delivery, eta, duplicate: false };
    });
    if (result.duplicate) {
      await fs.rm(req.file.path, { force: true });
      return res.status(200).json({ order: result });
    }
    res.status(201).json({ order: result });
  } catch (error) {
    if (req.file) await fs.rm(req.file.path, { force: true }).catch(cleanupError => console.error("Could not remove rejected order upload.", cleanupError));
    next(error);
  }
});
app.get("/api/orders/:id/proof", requireAuth, async (req, res, next) => {
  try {
    if (!["manager", "developer"].includes(req.user.role)) return res.status(403).json({ error: "Only managers can review payment proof." });
    const { rows } = await pool.query("SELECT proof_path,proof_name FROM orders WHERE id=$1", [req.params.id]);
    if (!rows[0]) throw badRequest("Order not found.", 404);
    res.download(rows[0].proof_path, rows[0].proof_name);
  } catch (error) { next(error); }
});
app.patch("/api/orders/:id/status", requireAuth, allow("manager", "developer"), async (req, res, next) => {
  try {
    const status = String(req.body.status || "");
    const allowed = ["Payment approved", "Payment rejected", "Preparing", "Ready", "Out for delivery", "Completed", "Cancelled"];
    if (!allowed.includes(status)) throw badRequest("Choose a valid order status.");
    const result = await transaction(async client => {
      const { rows } = await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [req.params.id]);
      const order = rows[0];
      if (!order) throw badRequest("Order not found.", 404);
      const nextStatuses = {
        "Awaiting proof review": ["Payment approved", "Payment rejected", "Cancelled"],
        "Payment approved": ["Preparing"],
        Preparing: ["Ready"],
        Ready: ["Out for delivery", "Completed"],
        "Out for delivery": ["Completed"]
      };
      if (!nextStatuses[order.status]?.includes(status)) throw badRequest("That order-status change is not allowed.", 409);
      if (status === "Payment approved") {
        if (order.status !== "Awaiting proof review") throw badRequest("This order is no longer awaiting payment review.", 409);
        const { rows: items } = await client.query("SELECT * FROM order_items WHERE order_id=$1", [order.id]);
        for (const item of items) await client.query("INSERT INTO transactions (id,product_id,name,source,quantity,unit_price,total,cost,staff_id,order_id) VALUES ($1,$2,$3,'Customer order',$4,$5,$6,$7,$8,$9)",
          [id(), item.product_id, item.name, item.quantity, item.unit_price, Number(item.unit_price) * item.quantity, Number(item.unit_cost) * item.quantity, req.user.id, order.id]);
      }
      if (status === "Payment rejected" || status === "Cancelled") {
        const { rows: items } = await client.query("SELECT * FROM order_items WHERE order_id=$1", [order.id]);
        for (const item of items) if (item.product_id) await client.query("UPDATE products SET stock=stock+$2,updated_at=NOW() WHERE id=$1", [item.product_id, item.quantity]);
      }
      const updated = await client.query("UPDATE orders SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *", [order.id, status]);
      return updated.rows[0];
    });
    res.json({ order: { id: result.id, status: result.status } });
  } catch (error) { next(error); }
});

function isAdult(value) {
  if (!value) return false;
  const birth = new Date(value), now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age >= 18;
}
function estimateDeliveryMinutes(address) {
  const area = address.toLowerCase();
  if (/glenwood|berea|musgrave|durban central|morningside|umbilo/.test(area)) return 20;
  if (/umhlanga|westville|pinetown|hillcrest|bluff|newlands/.test(area)) return 35;
  return 50;
}

app.post("/api/sales", requireAuth, allow("seller"), async (req, res, next) => {
  try {
    const productId = String(req.body.productId || "");
    const quantity = Number(req.body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw badRequest("Enter a valid quantity.");
    const sale = await transaction(async client => {
      const { rows } = await client.query("SELECT * FROM products WHERE id=$1 AND active=TRUE FOR UPDATE", [productId]);
      const product = rows[0];
      if (!product || product.stock < quantity) throw badRequest("This item is out of stock or unavailable.", 409);
      if (product.age_restricted && !req.body.ageConfirmed) throw badRequest("Confirm the customer's age before selling this product.", 403);
      await client.query("UPDATE products SET stock=stock-$2,updated_at=NOW() WHERE id=$1", [product.id, quantity]);
      const total = Number(product.price) * quantity, cost = Number(product.cost) * quantity;
      await client.query("INSERT INTO transactions (id,product_id,name,source,quantity,unit_price,total,cost,staff_id) VALUES ($1,$2,$3,'Counter sale',$4,$5,$6,$7,$8)",
        [id(), product.id, product.name, quantity, product.price, total, cost, req.user.id]);
      return { name: product.name, quantity, total };
    });
    res.status(201).json({ sale });
  } catch (error) { next(error); }
});
const assistantLimit = rateLimit({
  windowMs: 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: "The menu guide is taking a breather. Try again in a minute." }
});
app.post("/api/assistant", requireAuth, allow("customer"), assistantLimit, async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    if (!prompt || prompt.length > 500) throw badRequest("Tell us a little more (up to 500 characters).");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "The AI menu guide isn't configured yet. Ask the business to add its AI service key." });
    const { rows } = await pool.query("SELECT name,category,price,description,age_restricted FROM products WHERE active=TRUE ORDER BY category,name");
    const catalog = rows.filter(product => !product.age_restricted || isAdult(req.user.birth_date)).map(product =>
      `${product.name} | ${product.category} | R${Number(product.price).toFixed(2)} | ${product.description}`);
    const response = await fetch(process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are Verus' friendly Durban shisanyama menu guide. Suggest only products from the provided menu, use South African Rand (ZAR), ask about spice tolerance if useful, and keep the answer under 90 words. Never invent stock, prices, dietary guarantees, or delivery times. Mention age restrictions only when relevant. Menu:\n" + catalog.join("\n") },
          { role: "user", content: prompt }
        ],
        max_tokens: 180,
        temperature: 0.6
      })
    });
    if (!response.ok) {
      console.error("AI provider returned HTTP", response.status);
      return res.status(502).json({ error: "The menu guide is temporarily unavailable. Please try again shortly." });
    }
    const result = await response.json();
    const answer = result.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new Error("AI provider returned no menu suggestion.");
    res.json({ answer: answer.trim().slice(0, 1200) });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return res.status(504).json({ error: "The menu guide took too long to reply. Please try again." });
    next(error);
  }
});
app.get("/api/transactions", requireAuth, allow("manager", "auditor", "seller", "developer"), async (req, res, next) => {
  try {
    const query = req.user.role === "seller"
      ? "SELECT t.*,u.name AS staff_name FROM transactions t LEFT JOIN users u ON u.id=t.staff_id WHERE t.staff_id=$1 ORDER BY t.created_at DESC LIMIT 500"
      : "SELECT t.*,u.name AS staff_name FROM transactions t LEFT JOIN users u ON u.id=t.staff_id ORDER BY t.created_at DESC LIMIT 1000";
    const { rows } = await pool.query(query, req.user.role === "seller" ? [req.user.id] : []);
    res.json({ transactions: req.user.role === "seller" ? rows.map(({ cost: _cost, ...sale }) => sale) : rows });
  } catch (error) { next(error); }
});
app.get("/api/analytics", requireAuth, allow("manager", "auditor", "developer"), async (req, res, next) => {
  try {
    const [totals, periods, lowStock, daily] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS transactions,COALESCE(SUM(total),0) AS revenue,COALESCE(SUM(cost),0) AS cost,COALESCE(SUM(quantity),0)::int AS units FROM transactions"),
      pool.query("SELECT COALESCE(SUM(total) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days'),0) AS week_revenue,COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '7 days')::int AS week_count,COALESCE(SUM(total) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days'),0) AS month_revenue,COUNT(*) FILTER (WHERE created_at >= NOW()-INTERVAL '30 days')::int AS month_count FROM transactions"),
      pool.query("SELECT id,name,stock FROM products WHERE active=TRUE AND stock<10 ORDER BY stock,name"),
      pool.query("SELECT days.day::date AS day,COALESCE(SUM(t.total),0) AS revenue FROM generate_series(((NOW() AT TIME ZONE 'Africa/Johannesburg')::date-6)::timestamp,(NOW() AT TIME ZONE 'Africa/Johannesburg')::date::timestamp,INTERVAL '1 day') AS days(day) LEFT JOIN transactions t ON t.created_at >= (days.day AT TIME ZONE 'Africa/Johannesburg') AND t.created_at < ((days.day+INTERVAL '1 day') AT TIME ZONE 'Africa/Johannesburg') GROUP BY days.day ORDER BY days.day")
    ]);
    const orders = await pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='Awaiting proof review')::int AS pending,COUNT(*) FILTER (WHERE status='Completed')::int AS completed FROM orders");
    const stats = totals.rows[0], period = periods.rows[0];
    res.json({ revenue: Number(stats.revenue), cost: Number(stats.cost), profit: Number(stats.revenue) - Number(stats.cost), transactions: stats.transactions, units: stats.units, weekRevenue: Number(period.week_revenue), weekCount: period.week_count, monthRevenue: Number(period.month_revenue), monthCount: period.month_count, orders: orders.rows[0], lowStock: lowStock.rows, daily: daily.rows });
  } catch (error) { next(error); }
});

app.get("/api/users", requireAuth, allow("developer"), async (_req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT id,name,email,phone,location,role,active,profile_picture,last_login,created_at FROM users ORDER BY created_at DESC");
    res.json({ users: rows });
  } catch (error) { next(error); }
});
app.patch("/api/users/:id", requireAuth, allow("developer"), async (req, res, next) => {
  try {
    const role = String(req.body.role || "");
    if (!["customer", "manager", "auditor", "seller"].includes(role)) throw badRequest("Choose a valid account role.");
    if (req.params.id === req.user.id) throw badRequest("You cannot change your own role or access.");
    const { rows } = await pool.query("UPDATE users SET role=$2,active=$3 WHERE id=$1 RETURNING id,name,email,phone,location,role,active,profile_picture,last_login,created_at",
      [req.params.id, role, Boolean(req.body.active)]);
    if (!rows[0]) throw badRequest("Account not found.", 404);
    res.json({ user: rows[0] });
  } catch (error) { next(error); }
});
app.put("/api/profile", requireAuth, imageUpload.single("picture"), async (req, res, next) => {
  try {
    if (req.file) await validateUpload(req.file);
    const name = String(req.body.name || "").trim(), email = cleanEmail(req.body.email);
    const phone = String(req.body.phone || "").trim(), location = String(req.body.location || "").trim();
    const birthDate = req.body.birthDate || null;
    if (!name || !validEmail(email) || name.length > 120 || phone.length > 40 || location.length > 500) throw badRequest("Check your name, email, phone and location.");
    if (birthDate && !validBirthDate(birthDate)) throw badRequest("Enter a valid date of birth.");
    const existing = await pool.query("SELECT profile_picture FROM users WHERE email=$1 AND id<>$2", [email, req.user.id]);
    if (existing.rowCount) throw badRequest("That email address is already in use.", 409);
    const picture = req.file ? `/uploads/${req.file.filename}` : req.user.profile_picture;
    const { rows } = await pool.query("UPDATE users SET name=$2,email=$3,phone=$4,location=$5,birth_date=$6,profile_picture=$7 WHERE id=$1 RETURNING *",
      [req.user.id, name, email, phone, location, birthDate, picture]);
    res.json({ user: jsonUser(rows[0]) });
  } catch (error) { next(error); }
});
app.put("/api/profile/password", requireAuth, async (req, res, next) => {
  try {
    const current = String(req.body.currentPassword || ""), password = String(req.body.password || "");
    if (password.length < 12 || password.length > 200) throw badRequest("Choose a new password with at least 12 characters.");
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    if (!await bcrypt.compare(current, rows[0].password_hash)) throw badRequest("Current password is incorrect.", 403);
    const { rows: updated } = await pool.query("UPDATE users SET password_hash=$2,auth_version=auth_version+1 WHERE id=$1 RETURNING auth_version", [req.user.id, await bcrypt.hash(password, 12)]);
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = req.user.id;
      req.session.authVersion = updated[0].auth_version;
      req.session.save(saveError => saveError ? next(saveError) : res.status(204).end());
    });
  } catch (error) { next(error); }
});

app.use("/uploads", express.static(publicDirectory, { fallthrough: false, immutable: true, maxAge: "1y", index: false, dotfiles: "deny" }));
for (const asset of ["app.js", "style.css"]) {
  app.get(`/${asset}`, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, asset));
  });
}
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found." }));
app.use((error, req, res, _next) => {
  if (req.file?.path) {
    fs.rm(req.file.path, { force: true }).catch(cleanupError => console.error("Could not remove an unused upload.", cleanupError));
  }
  if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "The upload is too large." : "The upload could not be accepted." });
  if (res.headersSent) return _next(error);
  const status = error.isOperational ? error.status
    : error.code === "23505" ? 409
      : error.type === "entity.parse.failed" ? 400
        : error.type === "entity.too.large" ? 413
          : error.status === 404 ? 404 : 500;
  if (status >= 500) console.error("Request failed.", error);
  const message = error.isOperational ? error.message
    : error.code === "23505" ? "An account with that email already exists."
      : status === 404 ? "Not found."
        : status === 400 ? "The request body is invalid."
          : status === 413 ? "The request is too large."
        : "The request could not be completed. Please try again.";
  res.status(status).json({ error: message });
});

async function initialize() {
  await fs.mkdir(publicDirectory, { recursive: true });
  await fs.mkdir(privateDirectory, { recursive: true });
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(817341)");
    await client.query(schema);
  });
  const email = cleanEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
  if (!validEmail(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.");
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(817341)");
    const existing = await client.query("SELECT id,role,active FROM users WHERE email=$1", [email]);
    if (!existing.rowCount) {
      await client.query("INSERT INTO users (id,name,email,password_hash,role,active) VALUES ($1,$2,$3,$4,'developer',TRUE)",
        [id(), String(process.env.BOOTSTRAP_ADMIN_NAME || "Verus Admin").trim(), email, await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12)]);
      console.log("Created the initial developer account from environment configuration.");
    } else if (existing.rows[0].role !== "developer" || !existing.rows[0].active) {
      throw new Error("BOOTSTRAP_ADMIN_EMAIL already belongs to a non-active developer account. Resolve the initial administrator account before startup.");
    }
    const count = await client.query("SELECT COUNT(*)::int AS count FROM products");
    if (count.rows[0].count === 0) {
      for (const [name, category, price, cost, stock, prep, description, image, ageRestricted] of defaultProducts) {
        const productId = id();
        await client.query("INSERT INTO products (id,name,category,price,cost,stock,prep,description,image,age_restricted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [productId, name, category, price, cost, stock, prep, description, image, ageRestricted]);
        await client.query("INSERT INTO stock_entries (id,product_id,name,category,quantity,purchase_price,selling_price,entry_type) VALUES ($1,$2,$3,$4,$5,$6,$7,'Opening stock')",
          [id(), productId, name, category, stock, cost, price]);
      }
    }
  });
}

if (require.main === module) {
  initialize().then(() => {
    const server = app.listen(port, "0.0.0.0", () => console.log(`Verus' Shisanyama listening on port ${port}.`));
    const shutdown = signal => {
      console.log(`${signal} received; closing server.`);
      server.close(() => pool.end().then(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  }).catch(error => {
    console.error("Application startup failed.", error);
    process.exitCode = 1;
  });
}

module.exports = { app, initialize, estimateDeliveryMinutes, isAdult, validBirthDate, jsonProduct, orderJson };
