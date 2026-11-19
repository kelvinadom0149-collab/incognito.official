ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS completed_sales integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS average_rating numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispute_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS proof_video_key text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS customer_invoice_number text,
  ADD COLUMN IF NOT EXISTS seller_receipt_number text,
  ADD COLUMN IF NOT EXISTS seller_payout_available_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'awaiting_payment';

CREATE INDEX IF NOT EXISTS orders_stripe_session_idx ON orders(stripe_checkout_session_id);
