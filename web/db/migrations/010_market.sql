-- Recent tenders: CERC tariff-adoption orders uploaded by the bidder, read into their facts
-- (petition, date, petitioner, capacity, tariffs, successful bidders) with the page and quote of
-- each, then checked and corrected by hand. The SECI auction results shown beside them are a
-- researched list in the code (web/src/market/seed.js), not rows here.

CREATE TABLE IF NOT EXISTS market_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      uuid REFERENCES team_files(id) ON DELETE SET NULL,
  file_name    text NOT NULL DEFAULT '',
  petition     text NOT NULL DEFAULT '',
  order_date   date,
  petitioner   text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  capacity_mw  numeric,
  tariff_min   numeric,
  tariff_max   numeric,
  winners      jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note         text NOT NULL DEFAULT '',
  checked      boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS market_orders_date ON market_orders (order_date DESC NULLS LAST, created_at DESC);
