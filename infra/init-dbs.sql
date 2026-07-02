-- Runs once on first container start (postgres docker-entrypoint-initdb.d).
-- Creates one database per service, honoring database-per-service logically.
CREATE DATABASE identity_db;
CREATE DATABASE org_db;
CREATE DATABASE attendance_db;
