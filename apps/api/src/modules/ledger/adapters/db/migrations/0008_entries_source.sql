-- The entries of one source record and event type (FIN-12@PoC FR 14: the one live adjustment of «Оновити залишок» per
-- currency of an account, read with every account view): an index instead of a scan of the space's journal.
CREATE INDEX entries_source ON entries (household_id, source_module, source_id, event_type);
