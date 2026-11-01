-- Preserve saved search identities and receipts while moving them into their independent pool.
UPDATE production_jobs SET pool='search' WHERE kind='discover';
