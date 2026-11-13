-- New tenders: SECI's open tenders as scanned from its website (the tender list and each tender's
-- details page; no document is opened) with a summary written by Claude, or by rules without a
-- key. One row per tender, updated by every scan; a scan log for when, by whom and what it found.

CREATE TABLE IF NOT EXISTS seci_tenders (
  tender_id     text PRIMARY KEY,                    -- SECI's tender ID (SECI000295)
  ref           text NOT NULL DEFAULT '',
  title         text NOT NULL DEFAULT '',
  published     date,
  bid_deadline  date,
  record        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the page's fields, documents (names), announcements, facts
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { summary, watch[], relevance, by: claude | rules }
  fingerprint   text NOT NULL DEFAULT '',
  listed        boolean NOT NULL DEFAULT true,       -- false once it leaves SECI's open list
  first_seen    timestamptz NOT NULL DEFAULT now(),
  changed_at    timestamptz,                         -- the last scan that found it changed
  last_seen     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seci_tenders_deadline ON seci_tenders (listed DESC, bid_deadline ASC NULLS LAST);

CREATE TABLE IF NOT EXISTS seci_scans (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  by_user     uuid REFERENCES users(id) ON DELETE SET NULL,
  mode        text NOT NULL DEFAULT '',                -- claude | rules
  found       integer NOT NULL DEFAULT 0,
  new_count   integer NOT NULL DEFAULT 0,
  changed     integer NOT NULL DEFAULT 0,
  delisted    integer NOT NULL DEFAULT 0,
  seconds     numeric,
  errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage       jsonb NOT NULL DEFAULT '{}'::jsonb
);
