ALTER TABLE products
    ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS delivery_available boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS negotiable boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS specifications text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS image_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'products_condition_check'
          AND conrelid = 'products'::regclass
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT products_condition_check
            CHECK (condition IN ('new', 'used', 'refurbished'));
    END IF;
END
$$;

UPDATE products
SET image_keys = jsonb_build_array(image_key)
WHERE image_keys = '[]'::jsonb;
