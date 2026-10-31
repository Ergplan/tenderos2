-- Feedback and change requests (docs/TEAM.md "Feedback and change requests"): anyone on the team
-- switches on feedback, clicks a section of any page and writes a comment. Each comment is a change
-- request with where it was raised (tab, step, section, the boxes in the section), who raised it
-- and when. A super admin approves or rejects; approved requests are exported as one Markdown
-- prompt file for jouleWise (Claude Code) to implement, and marked exported with the batch.
CREATE TABLE IF NOT EXISTS change_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           integer GENERATED ALWAYS AS IDENTITY,
  tab           text NOT NULL,
  tab_label     text NOT NULL DEFAULT '',
  step          text NOT NULL DEFAULT '',
  step_label    text NOT NULL DEFAULT '',
  section_key   text NOT NULL,
  section_index text NOT NULL DEFAULT '',
  section_title text NOT NULL DEFAULT '',
  boxes         jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_url      text NOT NULL DEFAULT '',
  comment       text NOT NULL,
  requested_by  uuid REFERENCES team_members(id) ON DELETE SET NULL,
  by_name       text NOT NULL DEFAULT '',
  team          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'exported', 'done')),
  decided_by    uuid REFERENCES team_members(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  exported_at   timestamptz,
  export_batch  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_requests_status_idx ON change_requests (status, created_at DESC);
