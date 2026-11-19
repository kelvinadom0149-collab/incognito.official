-- Run once against PostgreSQL as a database administrator. The application uses
-- a separate runtime role with DML-only grants; it cannot alter the schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role text NOT NULL CHECK (role IN ('customer','seller')),
    full_name text NOT NULL,
    phone text NOT NULL UNIQUE,
    email text UNIQUE,
    password_hash text NOT NULL,
    phone_verified boolean NOT NULL DEFAULT false,
    account_status text NOT NULL DEFAULT 'pending_verification'
      CHECK (account_status IN ('pending_verification','pending_review','active','suspended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_users_role_status_idx ON app_users(role, account_status);

CREATE TABLE IF NOT EXISTS otp_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    code_digest text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts smallint NOT NULL DEFAULT 0,
    sent_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS otp_challenges_user_time_idx ON otp_challenges(user_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES app_users(id),
    title text NOT NULL,
    category text NOT NULL CHECK (category IN ('style','home','food','care')),
    description text NOT NULL,
    price_pesewas bigint NOT NULL CHECK (price_pesewas > 0),
    stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
    preparation text NOT NULL,
    condition text NOT NULL DEFAULT 'new' CHECK (condition IN ('new','used','refurbished')),
    delivery_available boolean NOT NULL DEFAULT true,
    negotiable boolean NOT NULL DEFAULT false,
    specifications text NOT NULL DEFAULT '',
    image_key text NOT NULL,
    image_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'pending_review'
      CHECK (status IN ('pending_review','live','rejected','withdrawn')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by text
);
CREATE INDEX IF NOT EXISTS products_live_category_idx ON products(status, category, created_at DESC);
CREATE INDEX IF NOT EXISTS products_seller_idx ON products(seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES app_users(id),
    status text NOT NULL DEFAULT 'awaiting_payment'
      CHECK (status IN ('awaiting_payment','paid','processing','dispatched','delivered','cancelled','refunded')),
    currency char(3) NOT NULL DEFAULT 'GHS',
    items_total_pesewas bigint NOT NULL CHECK (items_total_pesewas >= 0),
    delivery_pesewas bigint CHECK (delivery_pesewas >= 0),
    total_pesewas bigint NOT NULL CHECK (total_pesewas >= 0),
    delivery_snapshot jsonb NOT NULL,
    payment_reference text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id),
    seller_id uuid NOT NULL REFERENCES app_users(id),
    title_snapshot text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_pesewas bigint NOT NULL CHECK (unit_price_pesewas > 0),
    payout_status text NOT NULL DEFAULT 'unsettled'
);

CREATE TABLE IF NOT EXISTS audit_events (
    id bigserial PRIMARY KEY,
    actor_user_id uuid REFERENCES app_users(id),
    actor_type text NOT NULL,
    action text NOT NULL,
    object_type text NOT NULL,
    object_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_events_time_idx ON audit_events(created_at DESC);

-- Application and developer login roles. Grant RDS IAM auth only in the separate
-- AWS bootstrap script; keeping it separate lets local PostgreSQL initialize.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_api') THEN
    CREATE ROLE marketplace_api LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketplace_dev') THEN
    CREATE ROLE marketplace_dev LOGIN;
  END IF;
END $$;
GRANT CONNECT ON DATABASE marketplace TO marketplace_api, marketplace_dev;
GRANT USAGE ON SCHEMA public TO marketplace_api, marketplace_dev;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO marketplace_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO marketplace_api;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO marketplace_dev;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO marketplace_dev;

-- Deliberately no Ghana Card number or card-image column. Identity checks require
-- approved NIA IVSP integration and a separately reviewed design.
