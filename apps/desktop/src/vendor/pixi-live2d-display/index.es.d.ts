export const Live2DModel: {
  from: (
    source: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<{
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
  }>;
  registerTicker: (tickerClass: unknown) => void;
};
