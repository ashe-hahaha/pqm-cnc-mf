/** One rasterized drawing page shown as a dashboard tab. */
export type DrawingPageImage = {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
};

export type DrawingLoadPhase =
  | "idle"
  | "converting"
  | "ready"
  | "error";
