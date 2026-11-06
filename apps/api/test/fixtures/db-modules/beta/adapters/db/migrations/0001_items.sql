CREATE TABLE items (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text NOT NULL);
INSERT INTO items (label) VALUES ('beta-only');
