-- Evidence on every input (E-01, E-02): any box of any tab carries files, links or notes as
-- evidence (a quote, a report, a data sheet), each with who attached it, when, and the box's value
-- at the time. field_key is the same key team mode gives a box (data-testid, else section and
-- label). A super admin signs off a box's value (field_signoff, one per box); a later change of the
-- value shows as "signed off at an older value".
CREATE TABLE IF NOT EXISTS evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key   text NOT NULL,
  tab         text NOT NULL,
  field_label text NOT NULL,
  place       text NOT NULL DEFAULT '',
  kind        text NOT NULL CHECK (kind IN ('file', 'link', 'note')),
  file_id     uuid REFERENCES team_files(id) ON DELETE SET NULL,
  url         text,
  note        text,
  value_at    text NOT NULL DEFAULT '',
  uploaded_by uuid REFERENCES team_members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_tab_field_idx ON evidence (tab, field_key);

CREATE TABLE IF NOT EXISTS field_signoff (
  tab         text NOT NULL,
  field_key   text NOT NULL,
  field_label text NOT NULL DEFAULT '',
  signed_by   uuid REFERENCES team_members(id) ON DELETE SET NULL,
  signed_at   timestamptz NOT NULL DEFAULT now(),
  value_at    text NOT NULL DEFAULT '',
  PRIMARY KEY (tab, field_key)
);
