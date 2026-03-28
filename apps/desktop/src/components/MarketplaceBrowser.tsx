import { useEffect, useState } from "react";

import {
  marketplaceApi as defaultMarketplaceApi,
  type MarketplaceApi,
  type MarketplaceListing,
} from "../marketplaceApi";

type MarketplaceBrowserProps = {
  marketplaceApi?: MarketplaceApi;
  onInstalled?: (listingId: string) => Promise<void> | void;
  onNotice?: (message: string) => void;
};

function formatPrice(listing: MarketplaceListing): string {
  if (listing.price.is_free) {
    return "Free";
  }

  return `${listing.price.currency ?? "USD"} ${listing.price.amount?.toFixed(2) ?? "0.00"}`;
}

function formatContentRating(listing: MarketplaceListing): string {
  if (!listing.content_rating) {
    return "General metadata";
  }

  if (listing.content_rating.maximum_age !== null) {
    return `Age ${listing.content_rating.minimum_age}-${listing.content_rating.maximum_age}`;
  }

  return `Age ${listing.content_rating.minimum_age}+`;
}

function formatInstallLabel(listing: MarketplaceListing, activeInstallId: string | null): string {
  if (activeInstallId === listing.id) {
    return "Installing...";
  }

  if (listing.install_supported) {
    return "Install free pack";
  }

  if (!listing.price.is_free) {
    return "Paid listing";
  }

  return listing.kind === "skill" ? "Skill listing" : "Browse only";
}

export function MarketplaceBrowser({
  marketplaceApi = defaultMarketplaceApi,
  onInstalled,
  onNotice,
}: MarketplaceBrowserProps) {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeInstallId, setActiveInstallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadListings(): Promise<void> {
      try {
        const response = await marketplaceApi.listListings();
        if (!active) {
          return;
        }

        setListings(response.listings);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const detail =
          loadError instanceof Error
            ? loadError.message
            : "Unknown marketplace loading error";
        setError(detail);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadListings();

    return () => {
      active = false;
    };
  }, [marketplaceApi]);

  async function handleInstall(listing: MarketplaceListing): Promise<void> {
    if (!listing.install_supported || activeInstallId !== null) {
      return;
    }

    try {
      setActiveInstallId(listing.id);
      setError(null);
      await marketplaceApi.installListing(listing.id);
      if (onInstalled) {
        await onInstalled(listing.id);
      }
      onNotice?.(`${listing.name} was installed from the curated marketplace.`);
    } catch (installError) {
      const detail =
        installError instanceof Error
          ? installError.message
          : "Unknown marketplace install error";
      setError(detail);
    } finally {
      setActiveInstallId(null);
    }
  }

  return (
    <section className="marketplace-browser" aria-label="Curated marketplace">
      <div className="marketplace-browser__header">
        <div>
          <span className="eyebrow">Curated Marketplace</span>
          <h3>Browse trusted packs and future skills.</h3>
        </div>
        <span className="settings-health settings-health--ready">Core stays free</span>
      </div>

      <p className="settings-panel__hint">
        Core companion features remain free. This curated layer highlights approved
        community and studio listings, shows moderation status clearly, and only
        allows one-click installs for free packs that passed review.
      </p>

      {isLoading ? (
        <p className="settings-panel__hint">Loading curated marketplace listings.</p>
      ) : (
        <div className="marketplace-list">
          {listings.map((listing) => (
            <article className="marketplace-card" key={listing.id}>
              <div className="marketplace-card__header">
                <div className="marketplace-card__identity">
                  {listing.icon_data_url ? (
                    <img
                      className="pack-card__icon"
                      src={listing.icon_data_url}
                      alt={`${listing.name} icon`}
                    />
                  ) : (
                    <div className="pack-card__icon pack-card__icon--placeholder">
                      {listing.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <strong>{listing.name}</strong>
                    <p>{listing.description}</p>
                  </div>
                </div>
                <div className="marketplace-card__badges">
                  <span
                    className={`marketplace-card__badge ${
                      listing.price.is_free
                        ? "marketplace-card__badge--free"
                        : "marketplace-card__badge--paid"
                    }`}
                  >
                    {formatPrice(listing)}
                  </span>
                  <span className="marketplace-card__badge marketplace-card__badge--kind">
                    {listing.kind === "personality_pack" ? "Pack" : "Skill"}
                  </span>
                </div>
              </div>

              <div className="pack-card__meta">
                <span>{formatContentRating(listing)}</span>
                <span>{listing.license.name}</span>
                <span>v{listing.version}</span>
                <span>{listing.publisher.name}</span>
              </div>

              <p className="pack-card__copy">
                {listing.moderation.install_allowed
                  ? "Approved for install"
                  : "Curated for discovery"}{" "}
                by {listing.moderation.manual_review.reviewer}. Signature key:{" "}
                {listing.publisher.signature_key_id}.
              </p>

              <div className="pack-card__tags">
                {(listing.content_rating?.tags ?? []).map((tag) => (
                  <span className="pack-card__tag" key={`${listing.id}-${tag}`}>
                    {tag}
                  </span>
                ))}
                {listing.core_feature ? (
                  <span className="pack-card__tag">core-friendly</span>
                ) : null}
              </div>

              <div className="marketplace-card__sections">
                <div className="marketplace-card__section">
                  <span className="settings-card__label">Required capabilities</span>
                  <p className="marketplace-card__section-copy">
                    {listing.required_capabilities.length
                      ? listing.required_capabilities.map((capability) => capability.id).join(", ")
                      : "No extra capabilities requested."}
                  </p>
                </div>
                <div className="marketplace-card__section">
                  <span className="settings-card__label">Moderation</span>
                  <p className="marketplace-card__section-copy">
                    Manual review: {listing.moderation.manual_review.status}. Automated
                    scans:{" "}
                    {listing.moderation.automated_scans
                      .map((scan) => `${scan.label} (${scan.status})`)
                      .join(", ")}
                    .
                  </p>
                </div>
                <div className="marketplace-card__section">
                  <span className="settings-card__label">Rights and licensing</span>
                  <p className="marketplace-card__section-copy">
                    {listing.ip_declaration?.notes ??
                      "License and rights declaration available with the listing."}
                  </p>
                </div>
                <div className="marketplace-card__section">
                  <span className="settings-card__label">Creator revenue share</span>
                  <p className="marketplace-card__section-copy">
                    {listing.revenue_share.creator_percent}% creator /{" "}
                    {listing.revenue_share.platform_percent}% platform /{" "}
                    {listing.revenue_share.payment_processor_percent}% processing.
                  </p>
                </div>
              </div>

              <button
                className={`settings-action-button${
                  listing.install_supported ? " settings-action-button--primary" : ""
                }`}
                disabled={!listing.install_supported || activeInstallId !== null}
                type="button"
                onClick={() => {
                  void handleInstall(listing);
                }}
              >
                {formatInstallLabel(listing, activeInstallId)}
              </button>
            </article>
          ))}
        </div>
      )}

      {error ? (
        <p className="installer-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
