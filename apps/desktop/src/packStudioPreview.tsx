import React from "react";
import ReactDOM from "react-dom/client";

import { PersonalityPackSettings } from "./components/PersonalityPackSettings";
import type {
  InstalledPack,
  PackApi,
  PackInstallResponse,
  PackListResponse,
  PackSelectionResponse,
} from "./packApi";
import type {
  MarketplaceApi,
  MarketplaceInstallResponse,
  MarketplaceListResponse,
} from "./marketplaceApi";
import "./styles.css";

const packs: InstalledPack[] = [
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
    avatar: {
      presentation_mode: "portrait",
      accent_color: "#81f0d6",
      aura_color: "#91b2ff",
    },
    voice: {
      provider: "local",
      voice_id: "default",
      style: "warm",
    },
    character_profile: {
      origin: "pack",
      summary: "A bright, practical desk companion who keeps the next step clear.",
      opening_message: "Morning. I kept the thread warm for you.",
      tags: ["steady", "desk-ready"],
      style_notes: ["clear", "light", "reassuring"],
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
    voice: {
      provider: "style-bert-vits2",
      voice_id: "evening-soft",
      model_id: "style-bert-vits2",
      style: "dramatic",
    },
    character_profile: {
      origin: "tavern-card",
      summary: "A dramatic late-night character with a softer voice underneath.",
      scenario: "Waiting after hours for the next check-in.",
      opening_message: "You came back. I kept the desk light on.",
      tags: ["dramatic", "late-night"],
      style_notes: ["intense", "soft underneath"],
    },
  },
];

const packState: PackListResponse = {
  active_pack_id: "sunrise-companion",
  schema_version: "1.0",
  packs,
};

function resolvePackResponse(pack: InstalledPack): PackInstallResponse {
  return {
    active_pack_id: pack.id,
    pack,
  };
}

const packApi: PackApi = {
  listPacks: async () => packState,
  installPack: async () => resolvePackResponse(packs[0]),
  importVrmModel: async () =>
    resolvePackResponse({
      ...packs[1],
      id: "lapine",
      display_name: "Lapine",
      character_profile: {
        origin: "vrm-import",
        summary: "Lapine imported as a local VRM companion body.",
      },
    }),
  createCharacterPack: async (payload) =>
    resolvePackResponse({
      ...packs[0],
      id: "draft-companion",
      display_name: payload.display_name,
      voice: {
        provider: payload.voice_provider,
        voice_id: payload.voice_id,
        model_id: payload.voice_model_id,
        style: payload.voice_style,
      },
      character_profile: {
        origin: "builder",
        summary: payload.summary,
        opening_message: payload.opening_message,
        scenario: payload.scenario,
        style_notes: payload.style_notes,
      },
    }),
  selectActivePack: async (packId): Promise<PackSelectionResponse> => ({
    active_pack_id: packId,
    pack: packs.find((pack) => pack.id === packId) ?? packs[0],
  }),
  importTavernCard: async () => resolvePackResponse(packs[1]),
};

const marketplaceResponse: MarketplaceListResponse = {
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
  ],
};

const marketplaceApi: MarketplaceApi = {
  listListings: async () => marketplaceResponse,
  installListing: async (): Promise<MarketplaceInstallResponse> => ({
    active_pack_id: "sunrise-companion",
    pack: packs[0],
    listing: marketplaceResponse.listings[0],
  }),
};

function PreviewShell() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(129,240,214,0.08), transparent 28%), #07111f",
        padding: "32px",
      }}
    >
      <div
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "24px",
          borderRadius: "32px",
          background: "rgba(7, 17, 31, 0.92)",
          border: "1px solid rgba(153,182,220,0.12)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.28)",
        }}
      >
        <PersonalityPackSettings
          packApi={packApi}
          marketplaceApi={marketplaceApi}
        />
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PreviewShell />
  </React.StrictMode>,
);
