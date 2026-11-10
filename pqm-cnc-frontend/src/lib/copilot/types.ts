export type CopilotIntent =
  | "help"
  | "greet"
  | "quality_overview"
  | "list_high_risk"
  | "list_warning"
  | "explain_balloon"
  | "open_drawing"
  | "open_trends"
  | "open_alerts"
  | "open_process"
  | "open_recommendations"
  | "next_actions"
  | "sim_status"
  | "next_piece"
  | "quality_trend"
  | "machine_inference"
  | "fallback";

export type CopilotEntities = {
  balloonCode?: string;
  balloonId?: string;
};

export type CopilotContext = {
  selectedBalloonId?: string | null;
  selectedBalloonCode?: string | null;
  selectedCharacteristic?: string | null;
  selectedRisk?: string | null;
  predictedValue?: number | null;
  passProbability?: number | null;
  simPhase?: "machining" | "review";
  simLabel?: string;
  canLoadNext?: boolean;
  summary?: {
    pass: number;
    warning: number;
    highRisk: number;
    notMachined: number;
    total: number;
  };
  highRiskCodes?: string[];
  warningCodes?: string[];
  alerts?: { title: string; detail: string; balloonId?: string }[];
  recommendations?: {
    title: string;
    detail: string;
    priority: string;
    balloonId?: string;
  }[];
};

export type CopilotAction = {
  label: string;
  href: string;
};

export type CopilotReply = {
  intent: CopilotIntent;
  confidence: number;
  entities: CopilotEntities;
  message: string;
  actions: CopilotAction[];
  chips: string[];
};
