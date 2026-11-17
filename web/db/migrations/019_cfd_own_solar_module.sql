-- Saved bids from the CfD Own Solar tab (the CfD bid with own RE's cost spent when it is
-- commissioned and an existing plant for the first months, web/src/cfd/OwnSolar.jsx) use module
-- 'cfdOwnSolar'.
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_module_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_module_check CHECK (module IN ('rtc', 'fdre', 'bess', 'seci', 'cfd', 'cfdOwnSolar'));
