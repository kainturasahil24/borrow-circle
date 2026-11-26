-- PostGIS setup that Prisma's schema language cannot express.
-- Run after the first migration:
--   npm run postgis:index
--
-- Prisma models Listing.location as Unsupported("geography(Point, 4326)"),
-- so Prisma will not create the extension or the spatial index for us.

CREATE EXTENSION IF NOT EXISTS postgis;

-- GiST index drives the "items near me" radius search (Phase 3).
CREATE INDEX IF NOT EXISTS "Listing_location_gist_idx"
  ON "Listing" USING GIST ("location");

-- Only listings that are actually browsable need to be in the spatial index.
CREATE INDEX IF NOT EXISTS "Listing_active_location_gist_idx"
  ON "Listing" USING GIST ("location")
  WHERE "status" = 'ACTIVE';

-- Keyword search will use trigram indexes (Phase 3); enable the extension now
-- so migrations stay idempotent across environments.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Listing_title_trgm_idx"
  ON "Listing" USING GIN ("title" gin_trgm_ops);
