# Verus' Shisanyama

A server-backed ordering and operations app for a Durban braai business. The UI displays South African Rand (ZAR); PostgreSQL is the source of truth for users, products, inventory, orders and sales.

## Run locally

Requirements: Node.js 20+, PostgreSQL 15+ (or Docker Compose).

1. Copy `.env.example` to `.env`. Set a unique database password, a random `SESSION_SECRET` of at least 32 characters, and a unique bootstrap admin password of at least 14 characters. The bootstrap email/password create the first developer account only if that email is not already in the database.
2. With Docker Compose installed, the included setup starts the app and PostgreSQL. The database and app ports bind to localhost:

   ```powershell
   docker compose --env-file .env up --build -d
   ```

   Set `POSTGRES_PASSWORD` and `DATABASE_URL` to the same password in `.env`. Or run PostgreSQL separately, then install and start the Node app:

   ```powershell
   npm install
   npm start
   ```

3. Open `http://localhost:3000`. Sign in with the bootstrap developer credentials. From there, approve staff requests; no shared demo passwords or default staff accounts are enabled.

The app creates its PostgreSQL tables and starter menu automatically on first startup. Keep `.env`, payment-proof uploads, and database backups private. `npm test` runs the included server utility tests.

## Included workflows

- Password-hashed accounts and server-side role checks for customer, manager, auditor, seller and developer roles.
- Database-backed product/category management, stock receipts, stock reservation, counter sales and transaction records.
- Customer basket and order placement, private proof-of-payment upload, manager review, order-status tracking, and stock release when an order is rejected or cancelled.
- Role-scoped sales/stock analytics, a Durban-local-time seven-day sales chart and staff access approvals. Checkout submissions use idempotency keys to avoid duplicate orders on retries.
- Product and profile images are restricted to JPEG, PNG or WebP; payment proofs accept PDF/JPEG/PNG/WebP. Uploads are size-limited; proofs are stored outside the public web directory and only managers can download them.
- An OpenAI-compatible menu assistant. Configure `OPENAI_API_KEY`; optional `OPENAI_API_URL` and `OPENAI_MODEL` select a compatible provider endpoint and model. The server sends the menu and the customer's prompt, not account details. Without a key, the assistant reports that it is unavailable.
- No payment processing is integrated. Customers submit proof, and an authorized manager must review it.

## Deployment and operations

Set `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in the hosting provider's secret manager. Serve the app behind HTTPS. Set `TRUST_PROXY=1` only when there is exactly one trusted TLS-terminating reverse proxy in front of the app. For managed PostgreSQL, configure `PGSSL=require` when required by the provider. Restrict database and application ports, and mount `private_uploads` and `public_uploads` on durable, access-controlled storage; back them up along with PostgreSQL and test restoration.

This repository supplies the application and a local database setup, not a deployed service: no hosting account, domain, TLS certificate, production database credentials, AI key, email/SMS delivery provider, independent security test, privacy/legal assessment, or recovery objective was supplied. Complete those operational steps and review applicable South African privacy, consumer, tax, food-safety and age-restricted sales requirements before taking real customer data or relying on it for business operations. Delivery minutes are approximate area-based estimates, not live routing. Profit figures are gross estimates before overheads, tax, waste and refunds.
