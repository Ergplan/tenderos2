-- Which department needs the change (asked in the feedback note), beside the requester's own team.
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS for_team text NOT NULL DEFAULT '';
