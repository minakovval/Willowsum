CREATE TABLE items (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, amount numeric(38, 18) NOT NULL, currency char(3) NOT NULL);
