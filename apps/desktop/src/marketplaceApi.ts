import type { PackCapability, PackContentRating, PackInstallResponse } from "./packApi";

export type MarketplacePublisher = {
  id: string;
  name: string;
  website: string | null;
  signature_key_id: string;
};

export type MarketplacePrice = {
  is_free: boolean;
  amount: number | null;
  currency: string | null;
  label: string;
};

export type MarketplaceRevenueShare = {
  creator_percent: number;
  platform_percent: number;
  payment_processor_percent: number;
};

export type MarketplaceAutomatedScan = {
  id: string;
  label: string;
  status: string;
  summary: string;
};

export type MarketplaceManualReview = {
  status: string;
  reviewer: string;
  reviewed_at: string;
  notes: string;
};

export type MarketplaceModeration = {
  automated_scans: MarketplaceAutomatedScan[];
  manual_review: MarketplaceManualReview;
  install_allowed: boolean;
};

export type MarketplaceIPDeclaration = {
  rights_confirmed: boolean;
  asset_sources: string[];
  notes: string;
};

export type MarketplacePublisherSignature = {
  algorithm: string;
  key_id: string;
  public_key: Record<string, string>;
  value: string;
};

export type MarketplaceLicense = {
  name: string;
  spdx_identifier: string | null;
  url: string | null;
};

export type MarketplaceListing = {
  schema_version: string;
  id: string;
  kind: "personality_pack" | "skill";
  name: string;
  description: string;
  version: string;
  publisher: MarketplacePublisher;
  license: MarketplaceLicense;
  required_capabilities: PackCapability[];
  optional_capabilities: PackCapability[];
  price: MarketplacePrice;
  revenue_share: MarketplaceRevenueShare;
  moderation: MarketplaceModeration;
  publisher_signature: MarketplacePublisherSignature;
  content_rating: PackContentRating | null;
  ip_declaration: MarketplaceIPDeclaration | null;
  install_supported: boolean;
  core_feature: boolean;
  icon_data_url: string | null;
};

export type MarketplaceListResponse = {
  schema_version: string;
  listings: MarketplaceListing[];
};

export type MarketplaceInstallResponse = PackInstallResponse & {
  listing: MarketplaceListing;
};

export type MarketplaceApi = {
  listListings: () => Promise<MarketplaceListResponse>;
  installListing: (listingId: string) => Promise<MarketplaceInstallResponse>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { detail?: string }
      | null;
    throw new Error(errorPayload?.detail ?? `Runtime returned ${response.status}`);
  }

  return (await response.json()) as T;
}

export const marketplaceApi: MarketplaceApi = {
  listListings: () => request<MarketplaceListResponse>("/api/marketplace/listings"),
  installListing: (listingId) =>
    request<MarketplaceInstallResponse>(
      `/api/marketplace/listings/${listingId}/install`,
      {
        method: "POST",
      },
    ),
};
