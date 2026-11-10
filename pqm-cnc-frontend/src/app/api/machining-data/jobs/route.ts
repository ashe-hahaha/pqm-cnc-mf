import { NextResponse } from "next/server";
import { listMachiningJobs } from "@/lib/machiningData";

/** GET /api/machining-data/jobs — catalog of drawings under data/MachiningData. */
export async function GET() {
  try {
    const jobs = listMachiningJobs();
    return NextResponse.json({
      root: "data/MachiningData",
      jobs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
