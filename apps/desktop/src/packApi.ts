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
  locale?: string | null;
  style?: string | null;
};

export type PackAvatarConfig = {
  icon_path?: string | null;
  model_path?: string | null;
  idle_animation?: string | null;
  listening_animation?: string | null;
  thinking_animation?: string | null;
  talking_animation?: string | null;
  reaction_animation?: string | null;
  audio_cues?: Record<string, string>;
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
  selectActivePack: (packId: string) => Promise<PackSelectionResponse>;
  importTavernCard: (
    filename: string,
    imageBase64: string,
  ) => Promise<PackInstallResponse>;
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
