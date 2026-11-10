import { createTtsHandler } from "copilot-kit/server";

export const dynamic = "force-dynamic";

/** POST {text} → audio/wav (local Piper voice). Used by devices without a speech engine, e.g. Android TV. */
export const POST = createTtsHandler();
