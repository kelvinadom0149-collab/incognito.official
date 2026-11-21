# Incognito Market prototype

The Next.js App Router site is the customer storefront. It shows up to six featured **live, in-stock, approved** listings by default, with catalog search/category filters, a larger catalog view, bag/cart, customer account registration/login/WhatsApp verification, and a Ghana delivery details form. The seller workspace at `/seller/upload` now uses the same Ghana API for seller signup, private listing management, media uploads, and submission to moderation. Customer and seller contact information stays private. The legacy `index.html` file is an older browser-only demo; use `npm run dev` for the current site.

The Next.js storefront talks to the Ghana FastAPI backend through a same-origin proxy. For `npm run dev`, set `MARKETPLACE_API_URL` (for example `http://localhost:8000`) in `.env.local`, then start the FastAPI/Postgres services using the Docker Compose instructions in `backend/DEPLOYMENT.md`. In the Vercel services deployment, Vercel injects `MARKETPLACE_API_URL` into the app from its private backend binding; do not set that variable in Vercel project settings. Only products whose moderation status is `live` appear in the public catalog. Checkout currently records an authenticated delivery/order request and makes the delivery quote explicit; it does not collect payment until the company confirms delivery cost. Do not treat it as a live payment flow until Paystack and settlement, order updates, and delivery quoting have been implemented and configured.

Seller product photos are background-processed and positioned in the browser in `components/seller/ProductCanvas.tsx`. Only after the seller confirms the crop is a 2214 × 2214 WebP added to the listing upload; raw source images are not sent to a background-removal service. `@imgly/background-removal` is distributed under AGPL-3.0; review its license and any commercial licensing requirements before production deployment.

## Product direction

- Customers browse and buy through the marketplace brand. Seller names, phone numbers and personal contact details stay private from customers.
- The company coordinates checkout, support, delivery tracking and seller payouts. Tell customers clearly who their legal contracting seller is, who fulfils the order, and how returns/refunds work. A marketplace should not claim it owns goods or misrepresent who sold them if that is not the actual legal arrangement.
- Collect only the customer and seller details needed for fulfilment, fraud prevention, payouts and legal obligations. Explain purposes, access, retention and rights before collecting data.
- Seller signup should capture legal name, WhatsApp number, payout details and only proportionate identity/business verification. Send an expiring one-time code through a WhatsApp Business API provider; store a hash of the code, expiry, attempt count and verification timestamp, never the code itself. Provide a fallback for users who cannot use WhatsApp.
- Use an internal seller ID in the public catalog. Keep private identity and payout records in a separately permissioned store. Show the current profile in the seller dashboard and retain prior edits as timestamped, append-only versions with editor, reason and approval state. Public product changes should be moderated/versioned too.

## Incognito Next.js verification flow

The Next.js App Router implementation is under `/seller/upload`, `/admin/review`, `/admin/recommendations`, and `/shop/[slug]`. Seller drafts remain in IndexedDB until submission. `/api/products/submit` sanitizes and re-encodes images, runs text, moderation, reverse-image, and proof-of-life checks, then creates a `PENDING_STAGE_2` listing and emails the review team through Resend.

### Run locally

1. Copy `.env.example` to `.env.local`; for `npm run dev`, set `MARKETPLACE_API_URL` to the FastAPI API Gateway URL (or `http://localhost:8000` locally). With `vercel dev`, the service binding injects it. Provide the remaining secrets required by the routes you intend to run.
2. Run `npm install`, `npx prisma generate`, and `npx prisma migrate dev`.
3. Start the app with `npm run dev`.
4. Call cron routes locally with `Authorization: Bearer $CRON_SECRET`:
   - `GET /api/cron/sla-check`
   - `GET /api/cron/ghost-inventory`
   - `GET /api/cron/question-discovery`

Configure the same routes in `vercel.json` for hosted hourly/daily execution. Stripe webhooks must point to `/api/webhooks/stripe` and use `STRIPE_WEBHOOK_SECRET`.

## Suggested production foundation

Use **managed PostgreSQL** as the system of record (for example AWS RDS PostgreSQL, with the hosting region selected after Ghana data-residency and transfer review). It is a strong fit for orders, inventory, seller ownership, payment reconciliation and auditable ledger entries because these need relational constraints and transactions. Do not put card details in this database; Paystack hosts payment collection.

Separate tables/schemas and access roles for `public_catalog`, `accounts`, `seller_private`, `orders`, `payments`, and `audit`. Apply least-privilege access and row-level policies; encrypt network traffic and database/storage backups; use cloud KMS-managed keys and rotate credentials. Store identity documents in a private encrypted object bucket with short-lived signed access, never public URLs. Keep secrets in a secret manager. Log access to sensitive records and alert on unusual access. Back up and test restoration. Establish retention/deletion rules and a breach response process. A database alone cannot guarantee privacy: app permissions, admin access, vendor contracts and operational controls matter just as much.

For profile edits, use a mutable `seller_profiles` current row plus append-only `seller_profile_versions` rows keyed by seller ID and version number; each version contains a JSON snapshot or normalized changed fields, timestamp, actor and status. Keep secret/private fields (legal name, verified phone, payout beneficiary) outside the public profile payload. Never expose database keys or seller IDs in public URLs.

## Payments and delivery model

Integrate Stripe from a backend only: initialize Checkout server-side, verify signed webhooks, reconcile each transaction idempotently, and keep a double-entry order/payout ledger. Incognito schedules seller payouts for two days after successful payment, but the actual disbursement must use an approved Stripe/Connect or bank settlement arrangement. Agree the precise settlement and release flow with a Ghanaian payments adviser before launch. The Bank of Ghana's November 9, 2026 Notice No. 43 states that merchant collection funds are to remain segregated in designated settlement accounts and be settled on agreed timelines; do not promise that the company can freely hold or use funds.

Official references:

- [Ghana Data Protection Commission: compliance and registration](https://dpc.gov.gh/compliance/)
- [Ghana Data Protection Act, 2012 (Act 843)](https://ghalii.org/akn/gh/act/2012/843/eng%402012-05-18)
- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Stripe payouts](https://docs.stripe.com/payouts)
- [Stripe Ghana availability](https://stripe.com/global)
- [Bank of Ghana Notice No. 43 (Nov. 9, 2026)](https://www.bog.gov.gh/notice/notice-no-43-management-of-merchant-collection-funds-by-settlement-banks-and-payment-service-providers/)

Before processing personal data, confirm applicable Data Protection Commission registration/compliance obligations and publish a clear privacy notice. This prototype is not a payment integration, production signup flow, legal review or security implementation.

The prototype asks customers only for order-relevant information: receiver name, Ghana phone number, region, town and delivery location; email and GhanaPost GPS are optional. It does not ask for a national ID or date of birth. Before checkout can go live, the company must supply and publish its actual legal name/status, address, phone/email, registration details, full checkout price and delivery charge, delivery estimate, payment method, terms, refunds/returns, privacy/security notice, and customer complaint/dispute route. These cannot be truthfully completed without the company's real details. The Electronic Transactions Act, 2008 (Act 772), section 47 specifies seller, transaction, delivery, refund, privacy and security information for electronic transactions, and section 48 requires an opportunity to review/correct errors and withdraw before conclusion. See the [Act](https://ghalii.org/akn/gh/act/2008/772/eng%402020-12-29) and [Ghana DPC guidance for individuals](https://dpc.gov.gh/for-individuals/).

The private account view does not collect a Ghana Card number. NIA's current guidance (L.I. 2523, effective June 9, 2026) says identity verification must use real-time biometric verification through NIA's IVSP when available, and organisations must not request, scan, photocopy, or retain card copies for identity checks except where permitted by law. NIA's institutional onboarding page lists business registration, a valid DPC certificate and the legal basis for personal-data collection among the requested onboarding documents. So first complete DPC registration/privacy compliance and obtain NIA approval/contract; do not simply add a Ghana Card number field to the public form. If NIA confirms a suitable unique identity reference can be retained for deduplication, enforce one account per verified person in the backend with a database `UNIQUE` constraint on that approved reference (or a server-side keyed pseudonymous value if NIA permits it). Never use a client-side check as the uniqueness control, and do not store raw card numbers or images in browser storage or ordinary application logs. If NIA does not permit retention of a stable unique reference, use its prescribed anti-duplicate mechanism instead. See [NIA's current IVSP verification notice](https://nia.gov.gh/government-makes-biometric-verification-mandatory-for-ghana-card-verification-under-new-l-i-2523/), [NIA institutional onboarding](https://nia.gov.gh/service/verification-services/), and [DPC organisation requirements](https://dpc.gov.gh/for-organisations/).

Seller demo signup asks for a legal name and contact number, then gives the seller a private workspace. Public listings identify the marketplace, not the seller. Sellers can create, edit, and withdraw listings, enter price/stock/category/preparation information, and preview a product photo; edits return to pending review. Product image files are held as in-memory data URLs in this demo only. A production service must authenticate sellers server-side, hash passwords with a modern password-hashing scheme, verify phone ownership, validate and scan/resize uploads, store media privately, enforce seller ownership on every listing operation, keep an audit trail, and provide a moderator review queue. Do not use real credentials in the prototype.
