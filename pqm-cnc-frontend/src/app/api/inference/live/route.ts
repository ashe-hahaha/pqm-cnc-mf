import { NextResponse } from "next/server";
import {
  queryAllLiveInference,
  queryLiveInferenceForMachine,
} from "@/lib/queries/inference";

/**
 * GET /api/inference/live?machineId=
 * Machine-level in-process quality. Omit machineId for all machines.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const machineId = searchParams.get("machineId");

  if (machineId) {
    const prediction = queryLiveInferenceForMachine(machineId);
    if (!prediction) {
      return NextResponse.json(
        { error: "No in-process prediction for machine", machineId },
        { status: 404 },
      );
    }
    return NextResponse.json({ prediction });
  }

  return NextResponse.json({ predictions: queryAllLiveInference() });
}
