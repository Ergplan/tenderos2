-- Team mode: pings on any input box of any tab. A message belongs to a field's thread (thread_key:
-- the tab and the field), mentions teammates with @handle, and may offer a value the asker can
-- fill in with one click. team_notices is each person's inbox: the people mentioned and, on a
-- reply, the others in the thread. Members get a job title and the tabs they cover (Team setup).
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS tabs text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS team_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_key  text NOT NULL,
  tab         text NOT NULL,
  field_label text NOT NULL,
  place       text NOT NULL DEFAULT '',
  step        text NOT NULL DEFAULT '',
  field_value text NOT NULL DEFAULT '',
  from_id     uuid REFERENCES team_members(id) ON DELETE SET NULL,
  body        text NOT NULL,
  value       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_messages_thread_idx ON team_messages (thread_key, created_at);
CREATE INDEX IF NOT EXISTS team_messages_tab_idx ON team_messages (tab, created_at DESC);

CREATE TABLE IF NOT EXISTS team_notices (
  message_id uuid NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('mention', 'reply')),
  read_at    timestamptz,
  PRIMARY KEY (message_id, member_id)
);
CREATE INDEX IF NOT EXISTS team_notices_member_idx ON team_notices (member_id, read_at);

ALTER TABLE team_outbox ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES team_messages(id) ON DELETE CASCADE;
