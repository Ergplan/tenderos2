-- Feedback down to the element: the button, box, select, table cell, stat or step chip a change
-- request was raised on (its kind, label, value at the time and data-testid), beside its section.
ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS element_kind  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS element_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS element_value text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS element_key   text NOT NULL DEFAULT '';
