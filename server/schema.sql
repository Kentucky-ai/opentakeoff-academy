-- Private operational database. Never serve this database through static hosting.
CREATE TABLE IF NOT EXISTS union_orders (
  id text PRIMARY KEY,
  customer_hash text NOT NULL,
  provider_hash text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS union_events (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES union_orders(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS union_audit (
  sequence bigserial PRIMARY KEY,
  order_id text NOT NULL REFERENCES union_orders(id),
  action text NOT NULL,
  actor text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
