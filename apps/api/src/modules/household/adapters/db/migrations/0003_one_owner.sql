-- ACC-08@PoC FR 4 (00-general «Ролі і права»): a space always has exactly one Owner. The database refuses a second
-- Owner row for a space, whatever the code does; there is no transfer of ownership in PoC (ACC-08@MVP brings it, as
-- one transaction that demotes the old Owner before it promotes the new one). «At least one» is kept by the code:
-- the Owner row is created with the space and removed only with it (the erasure, ADR-0013).
CREATE UNIQUE INDEX account_spaces_one_owner ON account_spaces (space_id) WHERE role = 'owner';
