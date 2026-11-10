import type { InProcessPrediction } from "@/domain/types";
import { getLivePrediction, listLivePredictions } from "@/sim/store";

/** Latest in-process prediction for one machine (Phase D sim). */
export function queryLiveInferenceForMachine(
  machineId: string,
): InProcessPrediction | null {
  return getLivePrediction(machineId, new Date().toISOString()) ?? null;
}

/** Latest in-process prediction for every seeded machine. */
export function queryAllLiveInference(): InProcessPrediction[] {
  return listLivePredictions(new Date().toISOString());
}
