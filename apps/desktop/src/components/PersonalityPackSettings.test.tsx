import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PersonalityPackSettings } from "./PersonalityPackSettings";

function createPackApiMock() {
  const listPacks = vi.fn();
  const installPack = vi.fn();
  const importVrmModel = vi.fn();
  const createCharacterPack = vi.fn();
  const selectActivePack = vi.fn();
  const importTavernCard = vi.fn();

  const initialList = {
    active_pack_id: "sunrise-companion",
    schema_version: "1.0",
    packs: [
      {
        id: "sunrise-companion",
        name: "Sunrise Pack",
        version: "1.0.0",
        display_name: "Sunrise",
        author_name: "Companion Labs",
        license_name: "MIT",
        content_rating: {
          minimum_age: 13,
          maximum_age: null,
          tags: ["friendly", "local-first"],
        },
        required_capabilities: [
          {
            id: "overlay.render",
            justification: "Show the companion on screen.",
          },
        ],
        optional_capabilities: [],
        active: true,
        icon_data_url: null,
        installed_at: "2026-03-29T00:00:00+00:00",
        character_profile: {
          origin: "pack",
          summary: "A bright, practical desk companion who keeps the next step clear.",
          tags: ["steady"],
        },
      },
      {
        id: "evening-companion",
        name: "Evening Pack",
        version: "1.0.0",
        display_name: "Evening",
        author_name: "Companion Labs",
        license_name: "MIT",
        content_rating: {
          minimum_age: 16,
          maximum_age: null,
          tags: ["dramatic"],
        },
        required_capabilities: [],
        optional_capabilities: [],
        active: false,
        icon_data_url: null,
        installed_at: "2026-03-29T00:00:00+00:00",
        model: {
          renderer: "vrm",
          asset_path: "models/evening.vrm",
        },
        character_profile: {
          origin: "tavern-card",
          summary: "A dramatic late-night character with a softer voice underneath.",
          scenario: "Waiting after hours for the next check-in.",
          opening_message: "You came back. I kept the desk light on.",
          tags: ["dramatic", "late-night"],
        },
      },
    ],
  };

  listPacks.mockResolvedValue(initialList);
  selectActivePack.mockResolvedValue({
    active_pack_id: "evening-companion",
    pack: {
      ...initialList.packs[1],
      active: true,
    },
  });
  installPack.mockResolvedValue({
    active_pack_id: "sunrise-companion",
    pack: initialList.packs[0],
  });
  importVrmModel.mockResolvedValue({
    active_pack_id: "sunrise-companion",
    pack: {
      ...initialList.packs[0],
      id: "lapine",
      display_name: "Lapine",
      character_profile: {
        origin: "vrm-import",
        summary: "Lapine imported as a local VRM companion body.",
      },
    },
  });
  createCharacterPack.mockResolvedValue({
    active_pack_id: "momo",
    pack: {
      ...initialList.packs[0],
      id: "momo",
      display_name: "Momo",
      character_profile: {
        origin: "builder",
        summary: "Sharp, expressive, and still grounded on the desk.",
        opening_message: "You finally showed up. Sit down.",
      },
    },
  });
  importTavernCard.mockResolvedValue({
    active_pack_id: "sunrise-companion",
    pack: initialList.packs[0],
  });

  return {
    listPacks,
    installPack,
    importVrmModel,
    createCharacterPack,
    selectActivePack,
    importTavernCard,
  };
}

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
          tags: ["friendly"],
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
        id: "aurora-host-pack",
        kind: "personality_pack",
        name: "Aurora Host Pack",
        description: "A paid creator-facing pack.",
        version: "1.2.0",
        publisher: {
          id: "companion-labs",
          name: "Companion Labs",
          website: "https://companion-os.local",
          signature_key_id: "curated-marketplace-rs256",
        },
        license: {
          name: "Commercial",
          spdx_identifier: null,
          url: null,
        },
        required_capabilities: [],
        optional_capabilities: [],
        price: {
          is_free: false,
          amount: 12,
          currency: "USD",
          label: "Paid",
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
            reviewed_at: "2026-03-29T09:00:00+10:00",
            notes: "Approved.",
          },
          install_allowed: false,
        },
        publisher_signature: {
          algorithm: "RS256",
          key_id: "curated-marketplace-rs256",
          public_key: { kty: "RSA", n: "abc", e: "AQAB" },
          value: "sig",
        },
        content_rating: {
          minimum_age: 16,
          maximum_age: null,
          tags: ["creator"],
        },
        ip_declaration: {
          rights_confirmed: true,
          asset_sources: ["Original asset"],
          notes: "Rights cleared.",
        },
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

describe("PersonalityPackSettings", () => {
  it("renders installed packs and switches the active selection", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    expect(await screen.findByText("Sunrise")).toBeInTheDocument();
    expect(screen.getAllByText("Evening").length).toBeGreaterThan(0);
    expect(
      screen.getByText("A dramatic late-night character with a softer voice underneath."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Imported Tavern character/i)).toBeInTheDocument();
    expect(screen.getByText(/Opening line:/i)).toBeInTheDocument();
    expect(await screen.findByText("Bloom Starter Pack")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use this pack" }));

    await waitFor(() => {
      expect(packApi.selectActivePack).toHaveBeenCalledWith("evening-companion");
    });
  });

  it("uploads a signed pack zip through the install action", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    await screen.findByText("Sunrise");

    const uploadInput = screen.getByLabelText("Choose zip archive");
    const zipFile = new File(["zip payload"], "sunrise-pack.zip", {
      type: "application/zip",
    });
    await user.upload(uploadInput, zipFile);
    await user.click(screen.getByRole("button", { name: "Install pack" }));

    await waitFor(() => {
      expect(packApi.installPack).toHaveBeenCalledWith(
        "sunrise-pack.zip",
        expect.any(String),
      );
    });
  });

  it("imports a Tavern card png through the conversion action", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    await screen.findByText("Sunrise");

    const uploadInput = screen.getByLabelText("Choose Tavern PNG");
    const pngFile = new File(["png payload"], "friend.png", {
      type: "image/png",
    });
    await user.upload(uploadInput, pngFile);
    await user.click(screen.getByRole("button", { name: "Convert and install" }));

    await waitFor(() => {
      expect(packApi.importTavernCard).toHaveBeenCalledWith(
        "friend.png",
        expect.any(String),
      );
    });
  });

  it("imports selected VRM files as local packs", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    await screen.findByText("Sunrise");

    const uploadInput = screen.getByLabelText("Choose VRM files");
    const vrmFile = new File(["vrm payload"], "Lapine.vrm", {
      type: "application/octet-stream",
    });
    await user.upload(uploadInput, vrmFile);
    await user.click(screen.getByRole("button", { name: "Import VRM" }));

    await waitFor(() => {
      expect(packApi.importVrmModel).toHaveBeenCalledWith(
        "Lapine.vrm",
        expect.any(String),
      );
    });
  });

  it("builds and installs a local character pack from the builder", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    await screen.findByText("Sunrise");

    await user.type(screen.getByLabelText("Character name"), "Momo");
    await user.type(
      screen.getByLabelText("Character summary"),
      "Sharp, expressive, and still grounded on the desk.",
    );
    await user.type(
      screen.getByLabelText("Opening line"),
      "You finally showed up. Sit down.",
    );
    await user.selectOptions(screen.getByLabelText("Body source"), "evening-companion");
    await user.selectOptions(screen.getByLabelText("Voice path"), "chatterbox");
    await user.click(screen.getByRole("button", { name: "Build and use this companion" }));

    await waitFor(() => {
      expect(packApi.createCharacterPack).toHaveBeenCalledWith(
        expect.objectContaining({
          display_name: "Momo",
          summary: "Sharp, expressive, and still grounded on the desk.",
          opening_message: "You finally showed up. Sit down.",
          source_pack_id: "evening-companion",
          voice_provider: "chatterbox",
        }),
      );
    });
  });

  it("installs a curated free marketplace pack and labels paid listings", async () => {
    const packApi = createPackApiMock();
    const marketplaceApi = createMarketplaceApiMock();
    const user = userEvent.setup();

    render(
      <PersonalityPackSettings
        packApi={packApi}
        marketplaceApi={marketplaceApi}
      />,
    );

    expect(await screen.findByText("Aurora Host Pack")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paid listing" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Install free pack" }));

    await waitFor(() => {
      expect(marketplaceApi.installListing).toHaveBeenCalledWith(
        "bloom-starter-pack",
      );
    });
  });
});
