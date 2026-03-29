# Curated Marketplace API

The MVP marketplace stays inside the same companion product surface. It exists to
show trusted personality packs and future skills without turning setup or daily
use into a separate dashboard.

## Goals

- Keep core companion functionality free.
- Show moderation and rights metadata clearly.
- Allow one-click installation only for approved free personality packs.
- Keep paid listings and skill listings visible for discovery without pretending
  checkout or skill installation is complete.

## Listing Metadata

Each curated listing includes:

- `id`, `kind`, `name`, `description`, and `version`
- publisher metadata and a signed publisher record
- required and optional capability declarations
- pricing metadata with free versus paid status
- creator revenue share percentages
- moderation details from automated scans plus manual review
- `content_rating` and `ip_declaration` for personality packs

## Endpoints

### `GET /api/marketplace/listings`

Returns the curated catalog for packs and skills.

### `GET /api/marketplace/listings/{listing_id}`

Returns one curated listing by id.

### `POST /api/marketplace/listings/{listing_id}/install`

Installs one approved free personality pack from the curated marketplace.

The MVP install route intentionally rejects:

- paid listings
- skill listings
- any listing that is not moderation-approved for install

## Moderation Workflow

Installable pack listings require:

- passed malware scanning
- passed capability allowlist checks
- passed content and rating checks
- passed license compliance checks
- manual review with `approved` status
- a positive IP declaration confirming redistribution rights

If any of those conditions are not met, the listing may still be shown for
discovery, but it is not installable from the desktop app.
