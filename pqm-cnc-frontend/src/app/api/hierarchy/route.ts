import { NextResponse } from "next/server";
import { assets } from "@/seed/plant";

export async function GET() {
  return NextResponse.json({ assets });
}
