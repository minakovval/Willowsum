CREATE TABLE seen AS SELECT current_user::text AS who, session_user::text AS session;
