-- Saved bids from the FDRE-X Bid tab (SECI-FDRE-X, web/src/fdrex) use module 'fdrex'.
ALTER TABLE scenarios DROP CONSTRAINT IF EXISTS scenarios_module_check;
ALTER TABLE scenarios ADD CONSTRAINT scenarios_module_check CHECK (module IN ('rtc', 'fdre', 'bess', 'seci', 'cfd', 'cfdOwnSolar', 'fdrex'));
