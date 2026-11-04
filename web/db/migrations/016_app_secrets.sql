-- API keys entered once in the application (Administration › API keys) instead of the server's
-- .env: the Anthropic key the engine reads tenders with, the OpenAI key of the SECI voice agent,
-- the LlamaParse key for scanned pages. Each value is stored encrypted (AES-256-GCM under a key
-- derived from SESSION_SECRET, web/lib/secrets.js) and is never returned to the browser: the
-- screen shows only that it is set, its last four characters and who set it. A key in .env still
-- works and is used when none is stored here.
CREATE TABLE IF NOT EXISTS app_secrets (
  name        text PRIMARY KEY,
  ciphertext  text NOT NULL,
  hint        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL DEFAULT ''
);
