-- Demo licences (docs/LICENCES.md): every sign-in account gets a workspace, a licence end and an
-- on/off switch, and the licensing administrator is created on first start.
--   org         the workspace: the company a client licence is for. Users of the operator's own team
--               have '' and share one workspace, as before; a client sees only what its own
--               workspace made (saved bids, tender readings, uploaded profiles) and built-in content.
--   expires_at  the licence ends at this moment (NULL: no end); sign-in and every request stop then
--   disabled    switched off by an administrator
--   note        the administrator's note (e.g. the deal or the contact)
--   created_by  the administrator who gave the licence
ALTER TABLE users ADD COLUMN IF NOT EXISTS org text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- The licensing administrator. Only the scrypt hash of its first password is here (the password
-- was handed over separately); change it under Account after the first sign-in. An existing
-- account with this email is left as it is.
INSERT INTO users (email, name, password_hash, role)
VALUES ('ergcon@joulewise.com', 'Ergcon', 'scrypt$B99GCcD95UTs7gc1yYYzOA==$fk/t9e5HG/W3X/pnwgPQ/Q49cdgpwFPZ59Iz3zC7tlQifl6xG1SuQDsAKpeiGQN5Y/x9JRZPD+kWTJMQxmzFNQ==', 'admin')
ON CONFLICT (email) DO NOTHING;
