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
  const [isSelectingPackId, setIsSelectingPackId] = useState<string | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [tavernFile, setTavernFile] = useState<File | null>(null);
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
      </div>

      {isLoading ? (
        <p className="settings-panel__hint">Loading installed packs from this device.</p>
      ) : packs.length === 0 ? (
        <div className="settings-card">
          <span className="settings-card__label">Local library</span>
          <p>
            No personality packs are installed yet. Import a signed zip or convert a
            Tavern Card to get started.
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
              </div>

              <p className="pack-card__copy">
                By {pack.author_name}. Required capabilities:{" "}
                {pack.required_capabilities.length
                  ? pack.required_capabilities.map((capability) => capability.id).join(", ")
                  : "none"}.
              </p>

              <div className="pack-card__tags">
                {pack.content_rating.tags.map((tag) => (
                  <span className="pack-card__tag" key={`${pack.id}-${tag}`}>
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
