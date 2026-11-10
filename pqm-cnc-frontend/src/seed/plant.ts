import type {
  AssetNode,
  Characteristic,
  PartFamily,
} from "@/domain/types";

/** Minimal CNC seed for S0/S1 — expand in later milestones. */
export const assets: AssetNode[] = [
  {
    id: "ent-1",
    code: "ENT",
    name: "Precision Machining Group",
    level: "enterprise",
    parentId: null,
    active: true,
  },
  {
    id: "plt-1",
    code: "MS1",
    name: "Machine Shop 1",
    level: "plant",
    parentId: "ent-1",
    active: true,
  },
  {
    id: "cell-mill-a",
    code: "MILL-A",
    name: "Milling Cell A",
    level: "cell",
    parentId: "plt-1",
    active: true,
  },
  {
    id: "cell-turn-b",
    code: "TURN-B",
    name: "Turning Cell B",
    level: "cell",
    parentId: "plt-1",
    active: true,
  },
  {
    id: "cell-grind-c",
    code: "GRIND-C",
    name: "Grinding Cell C",
    level: "cell",
    parentId: "plt-1",
    active: true,
  },
  {
    id: "mch-mill-01",
    code: "VMC-01",
    name: "VMC 01",
    level: "machine",
    parentId: "cell-mill-a",
    active: true,
  },
  {
    id: "mch-mill-03",
    code: "VMC-03",
    name: "VMC 03 (golden)",
    level: "machine",
    parentId: "cell-mill-a",
    active: true,
  },
  {
    id: "mch-turn-02",
    code: "CNC-T02",
    name: "Turning Center 02",
    level: "machine",
    parentId: "cell-turn-b",
    active: true,
  },
  {
    id: "met-cmm-01",
    code: "CMM-01",
    name: "CMM Station 01",
    level: "metrology",
    parentId: "plt-1",
    active: true,
  },
];

export const partFamilies: PartFamily[] = [
  {
    id: "pf-housing",
    code: "HSG-A",
    name: "Aluminum Housing A",
    industry: "automotive",
  },
  {
    id: "pf-shaft",
    code: "SHF-B",
    name: "Steel Shaft B",
    industry: "aerospace",
  },
];

export const characteristics: Characteristic[] = [
  {
    id: "char-housing-od",
    partFamilyId: "pf-housing",
    code: "OD-01",
    name: "Bore OD",
    type: "OD",
    nominal: 42.0,
    upperTol: 0.02,
    lowerTol: 0.02,
    unit: "mm",
    critical: true,
  },
  {
    id: "char-housing-flat",
    partFamilyId: "pf-housing",
    code: "FLT-01",
    name: "Mount flatness",
    type: "FLATNESS",
    nominal: 0,
    upperTol: 0.015,
    lowerTol: 0,
    unit: "mm",
    critical: true,
  },
  {
    id: "char-shaft-od",
    partFamilyId: "pf-shaft",
    code: "OD-10",
    name: "Journal OD",
    type: "OD",
    nominal: 18.0,
    upperTol: 0.01,
    lowerTol: 0.01,
    unit: "mm",
    critical: true,
  },
];

export const plantName = "Machine Shop 1";
export const productName = "Predictive Quality";
