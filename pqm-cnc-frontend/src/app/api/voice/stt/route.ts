import { createSttHandler } from "copilot-kit/server";
import { queryOpsDashboard } from "@/lib/queries/opsDashboard";

export const dynamic = "force-dynamic";

/** POST multipart {audio} -> {text}. Audio is transcribed locally (Whisper on GPU). */
export const POST = createSttHandler({
  vocabulary: () => {
    const seed = queryOpsDashboard();
    const balloons = seed.balloons
      .map((b) => `${b.code} ${b.characteristic}`)
      .join(", ");
    return `Predictive quality questions for a CNC machine shop. Part: Valve Body A12 on a Makino Slim3n. Balloons B1 to B17: ${balloons}. Terms: balloon, Cpk, scrap risk, high risk, warning, pass probability, flatness, roundness, boss OD, port ID, counterbore, quality trend, QC measurement, CMM, recommendations, next piece.`;
  },
});
