import type { CopilotEntities, CopilotIntent } from "./types";

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract balloon codes like B17 / b3 from free text. */
export function extractEntities(message: string): CopilotEntities {
  const entities: CopilotEntities = {};
  const m = message.match(/\bB(\d+)\b/i);
  if (m) {
    entities.balloonCode = `B${m[1]}`;
    entities.balloonId = `b${m[1]}`;
  }
  return entities;
}

type Rule = { intent: CopilotIntent; confidence: number; re: RegExp };

const RULES: Rule[] = [
  { intent: "greet", confidence: 0.95, re: /^(hi|hello|hey|good\s+(morning|afternoon)|yo)\b/i },
  { intent: "help", confidence: 0.95, re: /\b(help|what can you|how do i use|capabilities)\b/i },
  {
    intent: "next_piece",
    confidence: 0.92,
    re: /\b(next\s+piece|load\s+next|new\s+(blank|piece)|start\s+next)\b/i,
  },
  {
    intent: "sim_status",
    confidence: 0.88,
    re: /\b(sim(ulation)?\s+status|machining\s+status|piece\s+(status|progress)|what('?s| is)\s+running)\b/i,
  },
  {
    intent: "list_high_risk",
    confidence: 0.93,
    re: /\b(high\s*risk|at\s+risk|risk\s+balloons?|critical\s+balloons?)\b/i,
  },
  {
    intent: "list_warning",
    confidence: 0.9,
    re: /\b(warning\s+balloons?|near\s+limit|watch\s+list|warnings?)\b/i,
  },
  {
    intent: "quality_overview",
    confidence: 0.9,
    re: /\b(quality\s+(looking|overview|summary|status)|how\s+is\s+quality|overall\s+quality|balloon\s+summary)\b/i,
  },
  {
    intent: "quality_trend",
    confidence: 0.9,
    re: /\b(quality\s+trend|trend\s+chart|measured\s+points?|spc|history)\b/i,
  },
  {
    intent: "explain_balloon",
    confidence: 0.9,
    re: /\b(why\s+.*(risk|warn)|selected\s+balloon|explain\s+balloon|balloon\s+detail|this\s+balloon)\b/i,
  },
  // Must precede next_actions (whose /recommend/ would swallow "open recommendations").
  {
    intent: "open_recommendations",
    confidence: 0.88,
    re: /\b(open\s+recommend\w*|show\s+recommend\w*|ai\s+recommendations?\s+panel)\b/i,
  },
  {
    intent: "next_actions",
    confidence: 0.9,
    re: /\b(what\s+should\s+i\s+do|recommend|next\s+actions?|ai\s+rec)\b/i,
  },
  {
    intent: "machine_inference",
    confidence: 0.85,
    re: /\b(in[\s-]?process|machine\s+quality|defect\s+prob\w*|vmc[\s-]?0?\d|cnc[\s-]?t0?\d|turning\s+center)\b/i,
  },
  {
    intent: "open_drawing",
    confidence: 0.88,
    re: /\b(open\s+drawing|show\s+drawing|balloon\s+map|drawing\s+map)\b/i,
  },
  {
    intent: "open_trends",
    confidence: 0.88,
    re: /\b(open\s+trend|show\s+trend|go\s+to\s+trend)\b/i,
  },
  {
    intent: "open_alerts",
    confidence: 0.88,
    re: /\b(open\s+alerts?|show\s+alerts?|go\s+to\s+alerts?)\b/i,
  },
  {
    intent: "open_process",
    confidence: 0.88,
    re: /\b(open\s+process|process\s+context|show\s+process)\b/i,
  },
];

export function classifyIntent(
  message: string,
  entities: CopilotEntities,
): { intent: CopilotIntent; confidence: number } {
  const text = norm(message);
  if (!text) return { intent: "fallback", confidence: 0.2 };

  for (const rule of RULES) {
    if (rule.re.test(message) || rule.re.test(text)) {
      return { intent: rule.intent, confidence: rule.confidence };
    }
  }

  // Bare balloon code → explain that balloon
  if (entities.balloonCode && /^b\d+\s*$/i.test(text.replace(/\s/g, ""))) {
    return { intent: "explain_balloon", confidence: 0.85 };
  }
  if (entities.balloonCode && /\b(balloon|detail|risk|why)\b/i.test(message)) {
    return { intent: "explain_balloon", confidence: 0.86 };
  }

  return { intent: "fallback", confidence: 0.35 };
}
