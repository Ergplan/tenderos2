-- Saved bids from the CfD Bid tab (SECI CfD-I, web/src/cfd) use module 'cfd'.
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_module_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_module_check CHECK (module IN ('rtc', 'fdre', 'bess', 'seci', 'cfd'));
