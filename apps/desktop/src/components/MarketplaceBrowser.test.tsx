import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MarketplaceBrowser } from "./MarketplaceBrowser";


function createMarketplaceApiMock() {
  const listListings = vi.fn();
  const installListing = vi.fn();

  listListings.mockResolvedValue({
    schema_version: "1.0",
    listings: [
      {
        schema_version: "1.0",
        id: "bloom-starter-pack",
        kind: "personality_pack",
        name: "Bloom Starter Pack",
        description: "A calm starter pack for the local companion.",
        version: "1.0.0",
        publisher: {
          id: "companion-labs",
          name: "Companion Labs",
          website: "https://companion-os.local",
          signature_key_id: "curated-marketplace-rs256",
        },
        license: {
          name: "CC-BY-4.0",
          spdx_identifier: "CC-BY-4.0",
          url: null,
        },
        required_capabilities: [
          {
            id: "overlay.render",
            justification: "Render the active companion on screen.",
          },
        ],
        optional_capabilities: [],
        price: {
          is_free: true,
          amount: null,
          currency: null,
          label: "Free",
        },
        revenue_share: {
          creator_percent: 70,
          platform_percent: 20,
          payment_processor_percent: 10,
        },
        moderation: {
          automated_scans: [
            {
              id: "malware",
              label: "Malware scan",
              status: "passed",
              summary: "Clean.",
            },
            {
              id: "content",
              label: "Content classifier",
              status: "passed",
              summary: "Aligned.",
            },
          ],
          manual_review: {
            status: "approved",
            reviewer: "Marketplace moderation",
            reviewed_at: "2026-03-29T09:00:00+10:00",
            notes: "Approved.",
          },
          install_allowed: true,
        },
        publisher_signature: {
          algorithm: "RS256",
          key_id: "curated-marketplace-rs256",
          public_key: { kty: "RSA", n: "abc", e: "AQAB" },
          value: "sig",
        },
        content_rating: {
          minimum_age: 13,
          maximum_age: null,
          tags: ["friendly", "starter"],
        },
        ip_declaration: {
          rights_confirmed: true,
          asset_sources: ["Original asset"],
          notes: "Rights cleared.",
        },
        install_supported: true,
        core_feature: true,
        icon_data_url: null,
      },
      {
        schema_version: "1.0",
        id: "creator-shortcuts-skill",
        kind: "skill",
        name: "Creator Shortcuts",
        description: "A browse-only curated skill listing.",
        version: "0.9.0",
        publisher: {
          id: "companion-labs",
          name: "Companion Labs",
          website: "https://companion-os.local",
          signature_key_id: "curated-marketplace-rs256",
        },
        license: {
          name: "MIT",
          spdx_identifier: "MIT",
          url: null,
        },
        required_capabilities: [],
        optional_capabilities: [],
        price: {
          is_free: true,
          amount: null,
          currency: null,
          label: "Free",
        },
        revenue_share: {
          creator_percent: 70,
          platform_percent: 20,
          payment_processor_percent: 10,
        },
        moderation: {
          automated_scans: [
            {
              id: "malware",
              label: "Malware scan",
              status: "passed",
              summary: "Clean.",
            },
          ],
          manual_review: {
            status: "approved",
            reviewer: "Marketplace moderation",
            reviewed_at: "2026-03-29T09:10:00+10:00",
            notes: "Metadata approved.",
          },
          install_allowed: false,
        },
        publisher_signature: {
          algorithm: "RS256",
          key_id: "curated-marketplace-rs256",
          public_key: { kty: "RSA", n: "abc", e: "AQAB" },
          value: "sig",
        },
        content_rating: null,
        ip_declaration: null,
        install_supported: false,
        core_feature: false,
        icon_data_url: null,
      },
    ],
  });

  installListing.mockResolvedValue({
    listing: {
      id: "bloom-starter-pack",
      name: "Bloom Starter Pack",
    },
    active_pack_id: "bloom-starter-pack",
    pack: {
      id: "bloom-starter-pack",
      name: "Bloom Starter Pack",
      version: "1.0.0",
      display_name: "Bloom Starter",
      author_name: "Companion Labs",
      license_name: "CC-BY-4.0",
      content_rating: {
        minimum_age: 13,
        maximum_age: null,
        tags: ["friendly"],
      },
      required_capabilities: [],
      optional_capabilities: [],
      active: true,
      icon_data_url: null,
      installed_at: "2026-03-29T00:00:00+00:00",
    },
  });

  return {
    listListings,
    installListing,
  };
}


describe("MarketplaceBrowser", () => {
  it("renders curated listings with free and browse-only labels", async () => {
    const marketplaceApi = createMarketplaceApiMock();

    render(<MarketplaceBrowser marketplaceApi={marketplaceApi} />);

    expect(await screen.findByText("Bloom Starter Pack")).toBeInTheDocument();
    expect(screen.getByText("Creator Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Core stays free")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skill listing" })).toBeDisabled();
  });

  it("installs an approved free pack and reports the notice", async () => {
    const marketplaceApi = createMarketplaceApiMock();
    const onInstalled = vi.fn().mockResolvedValue(undefined);
    const onNotice = vi.fn();
    const user = userEvent.setup();

    render(
      <MarketplaceBrowser
        marketplaceApi={marketplaceApi}
        onInstalled={onInstalled}
        onNotice={onNotice}
      />,
    );

    await screen.findByText("Bloom Starter Pack");
    await user.click(screen.getByRole("button", { name: "Install free pack" }));

    await waitFor(() => {
      expect(marketplaceApi.installListing).toHaveBeenCalledWith(
        "bloom-starter-pack",
      );
    });
    await waitFor(() => {
      expect(onInstalled).toHaveBeenCalledWith("bloom-starter-pack");
    });
    expect(onNotice).toHaveBeenCalledWith(
      "Bloom Starter Pack was installed from the curated marketplace.",
    );
  });
});
