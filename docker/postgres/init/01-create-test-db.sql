-- The dev database (uniblox_dev) comes from POSTGRES_DB in docker-compose.yml.
-- Tests get their own database, because every test wipes and reseeds it.
CREATE DATABASE uniblox_test OWNER uniblox;
