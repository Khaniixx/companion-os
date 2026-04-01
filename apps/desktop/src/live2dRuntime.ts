import { buildPackLive2DModelUrl } from "./packApi";

type PixiTicker = {
  shared: unknown;
};

type PixiRuntimeModule = {
  Ticker: PixiTicker;
};

type Live2DModelInstance = {
  anchor: {
    set: (x: number, y?: number) => void;
  };
  x: number;
  y: number;
  width: number;
  height: number;
  scale: {
    set: (value: number) => void;
  };
  focus: (x: number, y: number, instant?: boolean) => void;
};

type Live2DModelConstructor = {
  from: (
    source: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<Live2DModelInstance>;
  registerTicker: (tickerClass: PixiTicker) => void;
};

type VendoredLive2DModule = {
  Live2DModel: Live2DModelConstructor;
};

type VendoredLive2DRuntime =
  | {
      available: true;
      pixi: PixiRuntimeModule;
      Live2DModel: Live2DModelConstructor;
    }
  | {
      available: false;
      reason: "cubism-core-missing" | "runtime-load-failed";
    };

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

const LIVE2D_CORE_SCRIPT_URL = "/runtime/live2d/live2dcubismcore.min.js";

let runtimePromise: Promise<VendoredLive2DRuntime> | null = null;

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[data-live2d-runtime="${src}"]`,
    );
    if (existingScript?.dataset.loaded === "true") {
      resolve(true);
      return;
    }

    const scriptElement = existingScript ?? document.createElement("script");
    scriptElement.src = src;
    scriptElement.async = true;
    scriptElement.dataset.live2dRuntime = src;
    scriptElement.onload = () => {
      scriptElement.dataset.loaded = "true";
      resolve(true);
    };
    scriptElement.onerror = () => resolve(false);
    if (!existingScript) {
      document.head.appendChild(scriptElement);
    }
  });
}

export async function ensureVendoredLive2DRuntime(): Promise<VendoredLive2DRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        const pixi = (await import("pixi.js-legacy")) as unknown as PixiRuntimeModule;
        if (!window.Live2DCubismCore) {
          const loaded = await loadScript(LIVE2D_CORE_SCRIPT_URL);
          if (!loaded || !window.Live2DCubismCore) {
            return {
              available: false,
              reason: "cubism-core-missing",
            };
          }
        }

        const live2dModule = (await import(
          "./vendor/pixi-live2d-display/index.es.js"
        )) as unknown as VendoredLive2DModule;
        live2dModule.Live2DModel.registerTicker(pixi.Ticker);
        return {
          available: true,
          pixi,
          Live2DModel: live2dModule.Live2DModel,
        };
      } catch {
        return {
          available: false,
          reason: "runtime-load-failed",
        };
      }
    })();
  }

  return runtimePromise;
}

export async function fetchLive2DModelManifest(
  packId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(buildPackLive2DModelUrl(packId));
  if (!response.ok) {
    throw new Error(`Failed to load Live2D manifest for ${packId}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}
