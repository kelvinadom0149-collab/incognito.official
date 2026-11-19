ALTER TABLE products
  ADD COLUMN IF NOT EXISTS listing_id text,
  ADD COLUMN IF NOT EXISTS fulfillment text NOT NULL DEFAULT 'blind_shipping'
    CHECK (fulfillment IN ('locker','blind_shipping','digital')),
  ADD COLUMN IF NOT EXISTS proof_video_key text,
  ADD COLUMN IF NOT EXISTS live_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seller_confirmation_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghost_confirmation_required_at timestamptz;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  customer_id uuid REFERENCES app_users(id),
  checkout_session_id text,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_reservations_active_idx
  ON inventory_reservations(product_id, expires_at) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('automated','manual')),
  decision text NOT NULL CHECK (decision IN ('passed','failed','approved','changes_requested','rejected','banned','auto_approved')),
  reason text,
  ai_risk_score integer CHECK (ai_risk_score BETWEEN 0 AND 100),
  reviewer_id text,
  appeal_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_events_queue_idx ON moderation_events(stage, decision, created_at);

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS seller_alias text,
  ADD COLUMN IF NOT EXISTS ip_device_blocklist boolean NOT NULL DEFAULT false;
