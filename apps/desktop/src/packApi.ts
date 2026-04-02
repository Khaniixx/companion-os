export type PackContentRating = {
  minimum_age: number;
  maximum_age: number | null;
  tags: string[];
};

export type PackCapability = {
  id: string;
  justification: string;
};

export type PackVoiceConfig = {
  provider?: string;
  voice_id?: string;
  model_id?: string | null;
  locale?: string | null;
  style?: string | null;
  reference_sample_path?: string | null;
  fallback_provider?: string | null;
  rvc_enabled?: boolean;
  rvc_model_id?: string | null;
  rvc_model_path?: string | null;
};

export type PackAvatarConfig = {
  presentation_mode?: "shell" | "portrait" | "model" | null;
  stage_label?: string | null;
  accent_color?: string | null;
  aura_color?: string | null;
  icon_path?: string | null;
  model_path?: string | null;
  idle_animation?: string | null;
  listening_animation?: string | null;
  thinking_animation?: string | null;
  talking_animation?: string | null;
  reaction_animation?: string | null;
  audio_cues?: Record<string, string>;
};

export type PackModelConfig = {
  renderer?: "shell" | "live2d" | "vrm" | null;
  asset_path?: string | null;
  preview_image_path?: string | null;
  idle_hook?: string | null;
  attached_hook?: string | null;
  perched_hook?: string | null;
  speaking_hook?: string | null;
  blink_hook?: string | null;
  look_at_hook?: string | null;
  idle_eye_hook?: string | null;
};

export type PackCharacterProfile = {
  origin?: string | null;
  summary?: string | null;
  persona?: string | null;
  scenario?: string | null;
  opening_message?: string | null;
  example_dialogue?: string | null;
  creator_notes?: string | null;
  tags?: string[];
  style_notes?: string[];
};

export type InstalledPack = {
  id: string;
  name: string;
  version: string;
  display_name: string;
  author_name: string;
  license_name: string;
  content_rating: PackContentRating;
  required_capabilities: PackCapability[];
  optional_capabilities: PackCapability[];
  active: boolean;
  icon_data_url: string | null;
  installed_at: string | null;
  system_prompt?: string | null;
  style_rules?: string[];
  voice?: PackVoiceConfig;
  avatar?: PackAvatarConfig;
  model?: PackModelConfig;
  character_profile?: PackCharacterProfile;
};

export type PackListResponse = {
  active_pack_id: string | null;
  packs: InstalledPack[];
  schema_version: string;
};

export type PackInstallResponse = {
  active_pack_id: string | null;
  pack: InstalledPack;
};

export type PackSelectionResponse = {
  active_pack_id: string;
  pack: InstalledPack;
};

export type PackApi = {
  listPacks: () => Promise<PackListResponse>;
  installPack: (filename: string, archiveBase64: string) => Promise<PackInstallResponse>;
  importVrmModel: (filename: string, modelBase64: string) => Promise<PackInstallResponse>;
  createCharacterPack: (payload: {
    display_name: string;
    summary: string;
    opening_message?: string | null;
    scenario?: string | null;
    style_notes?: string[];
    source_pack_id?: string | null;
    portrait_filename?: string | null;
    portrait_image_base64?: string | null;
    voice_provider?: string;
    voice_id?: string;
    voice_model_id?: string | null;
    voice_locale?: string | null;
    voice_style?: string | null;
  }) => Promise<PackInstallResponse>;
  selectActivePack: (packId: string) => Promise<PackSelectionResponse>;
  importTavernCard: (
    filename: string,
    imageBase64: string,
  ) => Promise<PackInstallResponse>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export function buildPackAssetUrl(
  packId: string,
  assetType: "preview-image" | "model-asset",
): string {
  const encodedPackId = encodeURIComponent(packId);
  return `${API_BASE_URL}/api/packs/${encodedPackId}/${assetType}`;
}

export function buildPackAssetHashUrl(packId: string, assetHash: string): string {
  const encodedPackId = encodeURIComponent(packId);
  const encodedAssetHash = encodeURIComponent(assetHash);
  return `${API_BASE_URL}/api/packs/${encodedPackId}/assets/by-hash/${encodedAssetHash}`;
}

export function buildPackLive2DModelUrl(packId: string): string {
  const encodedPackId = encodeURIComponent(packId);
  return `${API_BASE_URL}/api/packs/${encodedPackId}/live2d-model`;
}

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

export const packApi: PackApi = {
  listPacks: () => request<PackListResponse>("/api/packs"),
  installPack: (filename, archiveBase64) =>
    request<PackInstallResponse>("/api/packs/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        archive_base64: archiveBase64,
      }),
    }),
  importVrmModel: (filename, modelBase64) =>
    request<PackInstallResponse>("/api/packs/import-vrm-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        model_base64: modelBase64,
      }),
    }),
  createCharacterPack: (payload) =>
    request<PackInstallResponse>("/api/packs/create-character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  selectActivePack: (packId) =>
    request<PackSelectionResponse>("/api/packs/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pack_id: packId,
      }),
    }),
  importTavernCard: (filename, imageBase64) =>
    request<PackInstallResponse>("/api/packs/import-tavern-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        image_base64: imageBase64,
      }),
    }),
};
