import { useEffect, useRef, useState } from "react";

import { ensureVendoredLive2DRuntime, fetchLive2DModelManifest } from "../live2dRuntime";

type PixiApp = {
  view: HTMLCanvasElement;
  stage: {
    addChild: (child: unknown) => void;
  };
  ticker: {
    add: (callback: () => void) => void;
  };
  destroy: (
    removeView?: boolean,
    options?: {
      children?: boolean;
      texture?: boolean;
      baseTexture?: boolean;
    },
  ) => void;
};

type PixiSprite = {
  anchor: {
    set: (value: number) => void;
  };
  x: number;
  y: number;
  scale: {
    x: number;
    set: (value: number) => void;
  };
};

type PixiAura = {
  clear: () => void;
  beginFill: (color: number, alpha: number) => void;
  drawEllipse: (x: number, y: number, width: number, height: number) => void;
  endFill: () => void;
};

type Live2DActor = {
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

type Live2DPixiPreviewProps = {
  packId?: string | null;
  modelUrl?: string | null;
  imageUrl: string | null | undefined;
  accentColor?: string | null;
  auraColor?: string | null;
  listeningIntensity: number;
  speechIntensity: number;
  displayName: string;
};

function parseHexColor(value: string | null | undefined, fallback: number): number {
  if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return fallback;
  }
  return Number.parseInt(value.slice(1), 16);
}

export function Live2DPixiPreview({
  packId,
  modelUrl,
  imageUrl,
  accentColor,
  auraColor,
  listeningIntensity,
  speechIntensity,
  displayName,
}: Live2DPixiPreviewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeValuesRef = useRef({
    listeningIntensity,
    speechIntensity,
  });
  const [runtimeState, setRuntimeState] = useState<"live2d" | "pixi" | "fallback">("fallback");
  const [runtimeEngine, setRuntimeEngine] = useState<"pixi" | "vendored-live2d">("pixi");

  runtimeValuesRef.current = {
    listeningIntensity,
    speechIntensity,
  };

  useEffect(() => {
    const hostElement = hostRef.current;
    const previewUrl = imageUrl;
    if (!hostElement || !previewUrl) {
      setRuntimeState("fallback");
      return;
    }
    const hostNode = hostElement;
    const resolvedPreviewUrl = previewUrl;

    let cancelled = false;
    let app: PixiApp | null = null;
    let sprite: PixiSprite | null = null;
    let aura: PixiAura | null = null;
    let live2dActor: Live2DActor | null = null;

    async function mountSpritePreview(
      pixi: typeof import("pixi.js-legacy"),
      stageAura: PixiAura,
    ): Promise<void> {
      const texture = await pixi.Texture.fromURL(resolvedPreviewUrl);
      if (cancelled) {
        return;
      }

      sprite = new pixi.Sprite(texture) as unknown as PixiSprite;
      sprite.anchor.set(0.5);
      sprite.x = 130;
      sprite.y = 164;
      const maxWidth = 176;
      const maxHeight = 238;
      const scale = Math.min(
        maxWidth / Math.max(texture.width, 1),
        maxHeight / Math.max(texture.height, 1),
      );
      sprite.scale.set(scale);
      app?.stage.addChild(sprite);

      const stageSprite = sprite;
      const baseY = stageSprite.y;
      const baseScale = stageSprite.scale.x;
      const stageAuraColor = parseHexColor(auraColor, 0x87ead8);

      app?.ticker.add(() => {
        const elapsed = performance.now() / 1000;
        const { listeningIntensity: listen, speechIntensity: speech } = runtimeValuesRef.current;
        const speechLift = speech * 7;
        const listenLift = listen * 5;
        const idleFloat = Math.sin(elapsed * 1.8) * 4;
        const motionScale = 1 + speech * 0.035 + listen * 0.02;

        stageSprite.y = baseY + idleFloat - speechLift - listenLift;
        stageSprite.scale.set(baseScale * motionScale);

        stageAura.clear();
        stageAura.beginFill(stageAuraColor, 0.12 + listen * 0.12 + speech * 0.08);
        stageAura.drawEllipse(
          130,
          166 - listenLift * 0.35,
          94 + speech * 10,
          118 + listen * 12,
        );
        stageAura.endFill();
      });

      setRuntimeEngine("pixi");
      setRuntimeState("pixi");
    }

    async function mountPreview(): Promise<void> {
      try {
        const pixi = await import("pixi.js-legacy");
        if (cancelled) {
          return;
        }

        app = new pixi.Application({
          width: 260,
          height: 320,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.max(window.devicePixelRatio || 1, 1),
          autoDensity: true,
        }) as unknown as PixiApp;
        hostNode.appendChild(app.view);

        aura = new pixi.Graphics() as unknown as PixiAura;
        const auraColorValue = parseHexColor(auraColor, 0x87ead8);
        aura.beginFill(auraColorValue, 0.16);
        aura.drawEllipse(130, 166, 94, 118);
        aura.endFill();
        app.stage.addChild(aura);

        const accentColorValue = parseHexColor(accentColor, 0x9db9ff);
        const rim = new pixi.Graphics();
        rim.lineStyle(2, accentColorValue, 0.28);
        rim.drawRoundedRect(34, 34, 192, 252, 28);
        app.stage.addChild(rim);

        if (packId && modelUrl) {
          const runtime = await ensureVendoredLive2DRuntime();
          if (runtime.available) {
            const modelManifest = await fetchLive2DModelManifest(packId);
            if (cancelled) {
              return;
            }

            live2dActor = (await runtime.Live2DModel.from(modelManifest, {
              autoInteract: false,
              autoUpdate: true,
            })) as Live2DActor;
            if (cancelled) {
              return;
            }

            live2dActor.anchor.set(0.5, 0.5);
            live2dActor.x = 130;
            live2dActor.y = 178;
            const maxWidth = 176;
            const maxHeight = 238;
            const scale = Math.min(
              maxWidth / Math.max(live2dActor.width, 1),
              maxHeight / Math.max(live2dActor.height, 1),
            );
            live2dActor.scale.set(scale);
            app.stage.addChild(live2dActor);

            const stageActor = live2dActor;
            const stageAura = aura;
            const stageAuraColor = auraColorValue;
            const baseY = stageActor.y;
            app.ticker.add(() => {
              const elapsed = performance.now() / 1000;
              const { listeningIntensity: listen, speechIntensity: speech } =
                runtimeValuesRef.current;
              const idleFloat = Math.sin(elapsed * 1.5) * 3;
              const focusX = speech > listen ? 0.25 : listen > 0 ? -0.18 : 0;
              const focusY = listen > 0 ? 0.08 : -0.02;

              stageActor.y = baseY + idleFloat - speech * 5 - listen * 4;
              stageActor.focus(focusX, focusY, false);

              stageAura.clear();
              stageAura.beginFill(stageAuraColor, 0.12 + listen * 0.12 + speech * 0.08);
              stageAura.drawEllipse(
                130,
                166 - listen * 3,
                94 + speech * 10,
                118 + listen * 10,
              );
              stageAura.endFill();
            });

            setRuntimeEngine("vendored-live2d");
            setRuntimeState("live2d");
            return;
          }
        }

        await mountSpritePreview(pixi, aura);
      } catch {
        setRuntimeEngine("pixi");
        setRuntimeState("fallback");
      }
    }

    void mountPreview();

    return () => {
      cancelled = true;
      if (app) {
        app.destroy(true, {
          children: true,
          texture: false,
          baseTexture: false,
        });
      }
      hostNode.innerHTML = "";
    };
  }, [accentColor, auraColor, imageUrl, modelUrl, packId]);

  return (
    <div
      ref={hostRef}
      aria-label={`${displayName} Pixi preview`}
      className={`live2d-stage__pixi live2d-stage__pixi--${runtimeState}`}
      data-live2d-runtime={runtimeState}
      data-live2d-runtime-engine={runtimeEngine}
    >
      {runtimeState === "fallback" ? (
        imageUrl ? (
          <img alt="" className="live2d-stage__pixi-fallback-image" src={imageUrl} />
        ) : (
          <span className="live2d-stage__pixi-fallback-letter">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )
      ) : null}
    </div>
  );
}
