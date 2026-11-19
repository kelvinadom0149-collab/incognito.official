-- Run once as the RDS master user after backend/sql/001_init.sql.
GRANT rds_iam TO marketplace_api;
GRANT rds_iam TO marketplace_dev;
