-- ws:contract 0001_accounts.sql the checks only widen what registrations accept; the previous code writes only new/existing rows with an account, which still pass
-- Sign-up only for the family's addresses (ACC-01@PoC FR 16, AC26; #107; ADR-0009). A sign-up with an address
-- outside the list creates no account and sends no letter, but its «Перевірте пошту» screen must answer exactly as
-- for a listed address: «Надіслати ще раз» and «Змінити email» act on a sign-up token like any other. Such a token is
-- a registration of kind `outside`, tied to no account; it stores no address (nor its digest), only the token's
-- SHA-256. The daily task sweeps it like any closed or expired registration (ADR-0010).
ALTER TABLE registrations ALTER COLUMN account_id DROP NOT NULL;
ALTER TABLE registrations DROP CONSTRAINT registrations_kind_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_kind_check CHECK (kind IN ('new', 'existing', 'outside'));
ALTER TABLE registrations ADD CONSTRAINT registrations_outside_without_account
  CHECK ((kind = 'outside') = (account_id IS NULL));
