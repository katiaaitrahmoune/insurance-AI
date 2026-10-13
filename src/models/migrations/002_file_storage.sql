-- Files can live on local disk (dev) or in Cloudinary (production).
-- Local rows store a path RELATIVE to DATA_DIR (legacy absolute paths still resolve).
-- Cloudinary rows store the public_id + resource type; access always goes through the API (auth),
-- never a public URL.
ALTER TABLE claim_files
  ADD COLUMN storage       TEXT NOT NULL DEFAULT 'local' CHECK (storage IN ('local','cloudinary')),
  ADD COLUMN public_id     TEXT,
  ADD COLUMN resource_type TEXT,
  ALTER COLUMN stored_path DROP NOT NULL;

ALTER TABLE claim_files ADD CONSTRAINT claim_files_location CHECK (
  (storage = 'local' AND stored_path IS NOT NULL) OR (storage = 'cloudinary' AND public_id IS NOT NULL)
);
