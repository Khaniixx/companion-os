import { useEffect, useMemo, useRef, useState } from "react";

import {
  packApi as defaultPackApi,
  type InstalledPack,
  type PackApi,
} from "../packApi";
import {
  marketplaceApi as defaultMarketplaceApi,
  type MarketplaceApi,
} from "../marketplaceApi";
import { MarketplaceBrowser } from "./MarketplaceBrowser";

type PersonalityPackSettingsProps = {
  packApi?: PackApi;
  marketplaceApi?: MarketplaceApi;
  onPacksChanged?: (packs: InstalledPack[], activePackId: string | null) => void;
};

function formatContentRating(pack: InstalledPack): string {
  if (pack.content_rating.maximum_age !== null) {
    return `${pack.content_rating.minimum_age}-${pack.content_rating.maximum_age}`;
  }

  return `${pack.content_rating.minimum_age}+`;
}

function formatInstallDate(value: string | null): string {
  if (!value) {
    return "Just now";
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Recently";
  }

  return parsedDate.toLocaleDateString();
}

function formatPackOrigin(pack: InstalledPack): string {
  const origin = pack.character_profile?.origin;
  if (origin === "tavern-card") {
    return "Imported Tavern character";
  }
  if (origin === "vrm-import") {
    return "Imported VRM body";
  }
  if (origin === "default") {
    return "Built-in companion";
  }
  return "Pack-defined character";
}

function getCharacterSummary(pack: InstalledPack): string | null {
  return (
    pack.character_profile?.summary ??
    pack.character_profile?.persona ??
    pack.system_prompt ??
    null
  );
}

function describeVoicePreset(provider: string): string {
  if (provider === "chatterbox") {
    return "Chatterbox local voice";
  }
  if (provider === "style-bert-vits2") {
    return "Style-Bert-VITS2 character voice";
  }
  return "Browser/local fallback voice";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("The selected file could not be read."));
        return;
      }

      const [, base64Payload = ""] = result.split(",", 2);
      if (!base64Payload) {
        reject(new Error("The selected file could not be encoded."));
        return;
      }

      resolve(base64Payload);
    };
    reader.onerror = () => {
      reject(new Error("The selected file could not be read."));
    };
    reader.readAsDataURL(file);
  });
}

export function PersonalityPackSettings({
  packApi = defaultPackApi,
  marketplaceApi = defaultMarketplaceApi,
  onPacksChanged,
}: PersonalityPackSettingsProps) {
  const onPacksChangedRef = useRef(onPacksChanged);
  const [packs, setPacks] = useState<InstalledPack[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInstallingZip, setIsInstallingZip] = useState(false);
  const [isImportingTavern, setIsImportingTavern] = useState(false);
  const [isImportingVrm, setIsImportingVrm] = useState(false);
  const [isCreatingCharacter, setIsCreatingCharacter] = useState(false);
  const [isSelectingPackId, setIsSelectingPackId] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [tavernFile, setTavernFile] = useState<File | null>(null);
  const [vrmFiles, setVrmFiles] = useState<File[]>([]);
  const [builderDisplayName, setBuilderDisplayName] = useState("");
  const [builderSummary, setBuilderSummary] = useState("");
  const [builderOpening, setBuilderOpening] = useState("");
  const [builderScenario, setBuilderScenario] = useState("");
  const [builderStyleNotes, setBuilderStyleNotes] = useState("");
  const [builderSourcePackId, setBuilderSourcePackId] = useState("");
  const [builderVoiceProvider, setBuilderVoiceProvider] = useState("local");
  const [builderVoiceStyle, setBuilderVoiceStyle] = useState("warm");
  const [builderPortraitFile, setBuilderPortraitFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onPacksChangedRef.current = onPacksChanged;
  }, [onPacksChanged]);

  async function refreshPacks(): Promise<void> {
    const response = await packApi.listPacks();
    setPacks(response.packs);
    setActivePackId(response.active_pack_id);
    onPacksChangedRef.current?.(response.packs, response.active_pack_id);
  }

  useEffect(() => {
    let active = true;

    async function load(): Promise<void> {
      try {
        const response = await packApi.listPacks();
        if (!active) {
          return;
        }

        setPacks(response.packs);
        setActivePackId(response.active_pack_id);
        onPacksChangedRef.current?.(response.packs, response.active_pack_id);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const detail =
          loadError instanceof Error ? loadError.message : "Unknown pack loading error";
        setError(detail);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [packApi]);

  const activePack = useMemo(
    () => packs.find((pack) => pack.id === activePackId) ?? null,
    [activePackId, packs],
  );
  const bodySourcePacks = useMemo(
    () =>
      packs.filter(
        (pack) =>
          pack.model?.renderer === "vrm" &&
          typeof pack.model.asset_path === "string" &&
          pack.model.asset_path.length > 0,
      ),
    [packs],
  );
  const selectedBodySourcePack = useMemo(
    () => bodySourcePacks.find((pack) => pack.id === builderSourcePackId) ?? null,
    [bodySourcePacks, builderSourcePackId],
  );
  const portraitPreviewUrl = useMemo(
    () => (builderPortraitFile ? URL.createObjectURL(builderPortraitFile) : null),
    [builderPortraitFile],
  );

  useEffect(() => {
    return () => {
      if (portraitPreviewUrl) {
        URL.revokeObjectURL(portraitPreviewUrl);
      }
    };
  }, [portraitPreviewUrl]);

  async function handleInstallZip(): Promise<void> {
    if (!zipFile || isInstallingZip) {
      return;
    }

    try {
      setIsInstallingZip(true);
      setError(null);
      const archiveBase64 = await fileToBase64(zipFile);
      const response = await packApi.installPack(zipFile.name, archiveBase64);
      await refreshPacks();
      setActivePackId(response.active_pack_id);
      setNotice(
        `${response.pack.display_name} is now installed on this device.`,
      );
      setZipFile(null);
    } catch (installError) {
      const detail =
        installError instanceof Error ? installError.message : "Unknown pack install error";
      setError(detail);
    } finally {
      setIsInstallingZip(false);
    }
  }

  async function handleImportTavern(): Promise<void> {
    if (!tavernFile || isImportingTavern) {
      return;
    }

    try {
      setIsImportingTavern(true);
      setError(null);
      const imageBase64 = await fileToBase64(tavernFile);
      const response = await packApi.importTavernCard(tavernFile.name, imageBase64);
      await refreshPacks();
      setActivePackId(response.active_pack_id);
      setNotice(
        `${response.pack.display_name} was converted from a Tavern Card and installed locally.`,
      );
      setTavernFile(null);
    } catch (importError) {
      const detail =
        importError instanceof Error ? importError.message : "Unknown Tavern import error";
      setError(detail);
    } finally {
      setIsImportingTavern(false);
    }
  }

  async function handleImportVrm(): Promise<void> {
    if (vrmFiles.length === 0 || isImportingVrm) {
      return;
    }

    try {
      setIsImportingVrm(true);
      setError(null);
      const importedNames: string[] = [];
      for (const vrmFile of vrmFiles) {
        const modelBase64 = await fileToBase64(vrmFile);
        const response = await packApi.importVrmModel(vrmFile.name, modelBase64);
        importedNames.push(response.pack.display_name);
      }
      await refreshPacks();
      setNotice(
        importedNames.length === 1
          ? `${importedNames[0]} was imported as a local VRM companion pack.`
          : `${importedNames.length} local VRM companion packs were imported.`,
      );
      setVrmFiles([]);
    } catch (importError) {
      const detail =
        importError instanceof Error ? importError.message : "Unknown VRM import error";
      setError(detail);
    } finally {
      setIsImportingVrm(false);
    }
  }

  async function handleSelectPack(packId: string): Promise<void> {
    if (isSelectingPackId || packId === activePackId) {
      return;
    }

    try {
      setIsSelectingPackId(packId);
      setError(null);
      const response = await packApi.selectActivePack(packId);
      await refreshPacks();
      setActivePackId(response.active_pack_id);
      setNotice(`${response.pack.display_name} is now the active companion pack.`);
    } catch (selectionError) {
      const detail =
        selectionError instanceof Error ? selectionError.message : "Unknown pack selection error";
      setError(detail);
    } finally {
      setIsSelectingPackId(null);
    }
  }

  async function handleCreateCharacterPack(): Promise<void> {
    if (!builderDisplayName.trim() || !builderSummary.trim() || isCreatingCharacter) {
      return;
    }

    try {
      setIsCreatingCharacter(true);
      setError(null);
      const portraitBase64 = builderPortraitFile
        ? await fileToBase64(builderPortraitFile)
        : null;
      const response = await packApi.createCharacterPack({
        display_name: builderDisplayName,
        summary: builderSummary,
        opening_message: builderOpening || null,
        scenario: builderScenario || null,
        style_notes: builderStyleNotes
          .split(",")
          .map((note) => note.trim())
          .filter((note) => note.length > 0),
        source_pack_id: builderSourcePackId || null,
        portrait_filename: builderPortraitFile?.name ?? null,
        portrait_image_base64: portraitBase64,
        voice_provider: builderVoiceProvider,
        voice_id: builderVoiceProvider === "local" ? "default" : `${builderVoiceProvider}-starter`,
        voice_model_id:
          builderVoiceProvider === "chatterbox"
            ? "chatterbox-turbo"
            : builderVoiceProvider === "style-bert-vits2"
              ? "style-bert-vits2"
              : null,
        voice_locale: "en-US",
        voice_style: builderVoiceStyle,
      });
      await refreshPacks();
      setActivePackId(response.active_pack_id);
      setNotice(`${response.pack.display_name} was built, saved locally, and activated.`);
      setBuilderDisplayName("");
      setBuilderSummary("");
      setBuilderOpening("");
      setBuilderScenario("");
      setBuilderStyleNotes("");
      setBuilderSourcePackId("");
      setBuilderPortraitFile(null);
      setBuilderVoiceProvider("local");
      setBuilderVoiceStyle("warm");
    } catch (creationError) {
      const detail =
        creationError instanceof Error
          ? creationError.message
          : "Unknown local character build error";
      setError(detail);
    } finally {
      setIsCreatingCharacter(false);
    }
  }

  return (
    <section className="pack-settings" aria-label="Personality packs">
      <div className="pack-settings__header">
        <div>
          <span className="eyebrow">Personality Packs</span>
          <h3>Choose how the companion feels on this device.</h3>
        </div>
        <span className="settings-health settings-health--ready">
          {activePack ? `Active: ${activePack.display_name}` : "No pack installed yet"}
        </span>
      </div>

      <p className="settings-panel__hint">
        Packs stay local. Each one carries its own display identity, content rating,
        capabilities, and avatar assets while preserving one continuous companion.
      </p>

      <div className="pack-settings__imports">
        <article className="settings-card">
          <span className="settings-card__label">Import pack zip</span>
          <p>Install a signed `pack.json` archive with local assets and companion rules.</p>
          <label className="pack-settings__file-label" htmlFor="pack-zip-upload">
            Choose zip archive
          </label>
          <input
            id="pack-zip-upload"
            className="pack-settings__file-input"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              setZipFile(event.target.files?.[0] ?? null);
            }}
          />
          <button
            className="settings-action-button settings-action-button--primary"
            disabled={!zipFile || isInstallingZip}
            type="button"
            onClick={() => {
              void handleInstallZip();
            }}
          >
            {isInstallingZip ? "Installing pack..." : "Install pack"}
          </button>
          {zipFile ? <p className="pack-settings__file-name">{zipFile.name}</p> : null}
        </article>

        <article className="settings-card">
          <span className="settings-card__label">Companion builder</span>
          <p>Assemble one usable local character from personality, body, portrait, and voice defaults.</p>
          <label className="settings-field">
            <span className="settings-field__label">Character name</span>
            <input
              value={builderDisplayName}
              onChange={(event) => {
                setBuilderDisplayName(event.target.value);
              }}
              placeholder="Momo"
              type="text"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Character summary</span>
            <textarea
              rows={3}
              value={builderSummary}
              onChange={(event) => {
                setBuilderSummary(event.target.value);
              }}
              placeholder="Sharp, expressive, protective, and still able to stay grounded on the desk."
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Opening line</span>
            <textarea
              rows={2}
              value={builderOpening}
              onChange={(event) => {
                setBuilderOpening(event.target.value);
              }}
              placeholder="You finally showed up. Sit down and tell me what the real problem is."
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Scenario</span>
            <input
              value={builderScenario}
              onChange={(event) => {
                setBuilderScenario(event.target.value);
              }}
              placeholder="On the desk, ready to pick up the next thread with me."
              type="text"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Tone notes</span>
            <input
              value={builderStyleNotes}
              onChange={(event) => {
                setBuilderStyleNotes(event.target.value);
              }}
              placeholder="direct, warm underneath, playful when it fits"
              type="text"
            />
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Body source</span>
            <select
              value={builderSourcePackId}
              onChange={(event) => {
                setBuilderSourcePackId(event.target.value);
              }}
            >
              <option value="">Portrait or shell only</option>
              {bodySourcePacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="pack-settings__file-label" htmlFor="builder-portrait-upload">
            Choose portrait image
          </label>
          <input
            id="builder-portrait-upload"
            className="pack-settings__file-input"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            onChange={(event) => {
              setBuilderPortraitFile(event.target.files?.[0] ?? null);
            }}
          />
          <label className="settings-field">
            <span className="settings-field__label">Voice path</span>
            <select
              value={builderVoiceProvider}
              onChange={(event) => {
                setBuilderVoiceProvider(event.target.value);
              }}
            >
              <option value="local">Browser/local fallback</option>
              <option value="chatterbox">Chatterbox</option>
              <option value="style-bert-vits2">Style-Bert-VITS2</option>
            </select>
          </label>
          <label className="settings-field">
            <span className="settings-field__label">Voice tone</span>
            <select
              value={builderVoiceStyle}
              onChange={(event) => {
                setBuilderVoiceStyle(event.target.value);
              }}
            >
              <option value="warm">Warm</option>
              <option value="direct">Direct</option>
              <option value="gentle">Gentle</option>
              <option value="dramatic">Dramatic</option>
              <option value="expressive">Expressive</option>
            </select>
          </label>
          <div className="pack-card pack-card--builder-preview">
            <div className="pack-card__header">
              <div className="pack-card__identity">
                {portraitPreviewUrl ? (
                  <img
                    className="pack-card__icon"
                    src={portraitPreviewUrl}
                    alt={`${builderDisplayName || "Draft"} portrait`}
                  />
                ) : (
                  <div className="pack-card__icon pack-card__icon--placeholder">
                    {(builderDisplayName || "C").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <strong>{builderDisplayName || "Draft companion"}</strong>
                  <p>
                    {selectedBodySourcePack ? (
                      <>
                        <span>Uses </span>
                        <span>{selectedBodySourcePack.display_name}</span>
                        <span> as the VRM body</span>
                      </>
                    ) : (
                      "Portrait or shell presentation"
                    )}
                  </p>
                </div>
              </div>
              <span className="pack-card__badge pack-card__badge--available">Preview</span>
            </div>
            <div className="pack-card__meta">
              <span>{describeVoicePreset(builderVoiceProvider)}</span>
              <span>{builderVoiceStyle}</span>
              <span>{builderPortraitFile ? "Portrait ready" : "No portrait yet"}</span>
            </div>
            <div className="pack-card__character">
              <span className="pack-card__character-label">First hello</span>
              <p>
                {builderOpening ||
                  "Give this companion an opening line so the first hello feels personal immediately."}
              </p>
              {builderSummary ? (
                <p className="pack-card__character-detail">
                  <strong>Character read:</strong> {builderSummary}
                </p>
              ) : null}
              {builderScenario ? (
                <p className="pack-card__character-detail">
                  <strong>Scenario:</strong> {builderScenario}
                </p>
              ) : null}
            </div>
          </div>
          <button
            className="settings-action-button settings-action-button--primary"
            disabled={!builderDisplayName.trim() || !builderSummary.trim() || isCreatingCharacter}
            type="button"
            onClick={() => {
              void handleCreateCharacterPack();
            }}
          >
            {isCreatingCharacter ? "Building character..." : "Build and use this companion"}
          </button>
        </article>

        <article className="settings-card">
          <span className="settings-card__label">Import Tavern card</span>
          <p>Convert a Tavern Card V2 or V3 PNG into a local companion pack.</p>
          <label className="pack-settings__file-label" htmlFor="tavern-card-upload">
            Choose Tavern PNG
          </label>
          <input
            id="tavern-card-upload"
            className="pack-settings__file-input"
            type="file"
            accept=".png,image/png"
            onChange={(event) => {
              setTavernFile(event.target.files?.[0] ?? null);
            }}
          />
          <button
            className="settings-action-button"
            disabled={!tavernFile || isImportingTavern}
            type="button"
            onClick={() => {
              void handleImportTavern();
            }}
          >
            {isImportingTavern ? "Converting card..." : "Convert and install"}
          </button>
          {tavernFile ? (
            <p className="pack-settings__file-name">{tavernFile.name}</p>
          ) : null}
        </article>

        <article className="settings-card">
          <span className="settings-card__label">Import VRM body</span>
          <p>
            Turn one or more local `.vrm` files into selectable companion packs with a
            VRM stage body.
          </p>
          <label className="pack-settings__file-label" htmlFor="vrm-model-upload">
            Choose VRM files
          </label>
          <input
            id="vrm-model-upload"
            className="pack-settings__file-input"
            type="file"
            accept=".vrm,model/gltf-binary,application/octet-stream"
            multiple
            onChange={(event) => {
              setVrmFiles(Array.from(event.target.files ?? []));
            }}
          />
          <button
            className="settings-action-button"
            disabled={vrmFiles.length === 0 || isImportingVrm}
            type="button"
            onClick={() => {
              void handleImportVrm();
            }}
          >
            {isImportingVrm
              ? "Importing VRM..."
              : vrmFiles.length > 1
                ? "Import selected VRMs"
                : "Import VRM"}
          </button>
          {vrmFiles.length > 0 ? (
            <p className="pack-settings__file-name">
              {vrmFiles.length === 1
                ? vrmFiles[0]?.name
                : `${vrmFiles.length} VRM files selected`}
            </p>
          ) : null}
        </article>
      </div>

      {isLoading ? (
        <p className="settings-panel__hint">Loading installed packs from this device.</p>
      ) : packs.length === 0 ? (
        <div className="settings-card">
          <span className="settings-card__label">Local library</span>
          <p>
            No personality packs are installed yet. Import a signed zip, convert a
            Tavern Card, or bring in a VRM body to get started.
          </p>
        </div>
      ) : (
        <div className="pack-list">
          {packs.map((pack) => (
            <article className="pack-card" key={pack.id}>
              <div className="pack-card__header">
                <div className="pack-card__identity">
                  {pack.icon_data_url ? (
                    <img
                      className="pack-card__icon"
                      src={pack.icon_data_url}
                      alt={`${pack.display_name} icon`}
                    />
                  ) : (
                    <div className="pack-card__icon pack-card__icon--placeholder">
                      {pack.display_name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <strong>{pack.display_name}</strong>
                    <p>{pack.name}</p>
                  </div>
                </div>
                <span
                  className={`pack-card__badge ${
                    pack.active ? "pack-card__badge--active" : "pack-card__badge--available"
                  }`}
                >
                  {pack.active ? "Active" : "Available"}
                </span>
              </div>

              <div className="pack-card__meta">
                <span>Age {formatContentRating(pack)}</span>
                <span>{pack.license_name}</span>
                <span>Installed {formatInstallDate(pack.installed_at)}</span>
                <span>{formatPackOrigin(pack)}</span>
              </div>

              <p className="pack-card__copy">
                By {pack.author_name}. Required capabilities:{" "}
                {pack.required_capabilities.length
                  ? pack.required_capabilities.map((capability) => capability.id).join(", ")
                  : "none"}.
              </p>

              {getCharacterSummary(pack) ? (
                <div className="pack-card__character">
                  <span className="pack-card__character-label">Character read</span>
                  <p>{getCharacterSummary(pack)}</p>
                  {pack.character_profile?.scenario ? (
                    <p className="pack-card__character-detail">
                      <strong>Scenario:</strong> {pack.character_profile.scenario}
                    </p>
                  ) : null}
                  {pack.character_profile?.opening_message ? (
                    <p className="pack-card__character-detail">
                      <strong>Opening line:</strong> {pack.character_profile.opening_message}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="pack-card__tags">
                {pack.content_rating.tags.map((tag) => (
                  <span className="pack-card__tag" key={`${pack.id}-${tag}`}>
                    {tag}
                  </span>
                ))}
                {pack.character_profile?.tags?.map((tag) => (
                  <span className="pack-card__tag pack-card__tag--character" key={`${pack.id}-character-${tag}`}>
                    {tag}
                  </span>
                ))}
              </div>

              {pack.required_capabilities.length ? (
                <ul className="pack-card__capabilities">
                  {pack.required_capabilities.map((capability) => (
                    <li key={`${pack.id}-${capability.id}`}>
                      <strong>{capability.id}</strong>: {capability.justification}
                    </li>
                  ))}
                </ul>
              ) : null}

              <button
                className="settings-action-button"
                disabled={pack.active || isSelectingPackId !== null}
                type="button"
                onClick={() => {
                  void handleSelectPack(pack.id);
                }}
              >
                {isSelectingPackId === pack.id
                  ? "Switching..."
                  : pack.active
                    ? "Using this pack"
                    : "Use this pack"}
              </button>
            </article>
          ))}
        </div>
      )}

      {notice ? (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      ) : null}
      <MarketplaceBrowser
        marketplaceApi={marketplaceApi}
        onInstalled={async () => {
          await refreshPacks();
        }}
        onNotice={(message) => {
          setNotice(message);
        }}
      />
      {error ? (
        <p className="installer-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
