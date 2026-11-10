"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DrawingBalloon,
  OpsDashboardSnapshot,
} from "@/domain/opsDashboard";
import {
  BALLOON_CYCLE_MS,
  applySimToSnapshot,
  createMachiningSim,
  rosterKeyOf,
  simStatus,
  startNextPiece,
  tickMachiningSim,
  type MachiningSimState,
  type SimStatus,
} from "./machiningCycle";

export function useMachiningSim(
  seed: OpsDashboardSnapshot,
  templateBalloons: DrawingBalloon[],
): {
  data: OpsDashboardSnapshot;
  status: SimStatus;
  speed: number;
  setSpeed: (n: number) => void;
  loadNextPiece: () => void;
} {
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<MachiningSimState>(() =>
    createMachiningSim(templateBalloons, seed.job.batchCompleted),
  );
  const stateRef = useRef(state);
  const balloonsRef = useRef(templateBalloons);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    balloonsRef.current = templateBalloons;
  }, [templateBalloons]);

  // Reset cycle when balloon roster changes (design add/delete).
  useEffect(() => {
    const key = rosterKeyOf(templateBalloons);
    if (key === stateRef.current.rosterKey) return;
    const fresh = createMachiningSim(
      templateBalloons,
      stateRef.current.batchCompleted,
    );
    stateRef.current = fresh;
    queueMicrotask(() => setState(fresh));
  }, [templateBalloons]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const next = tickMachiningSim(
        stateRef.current,
        templateBalloons,
        t,
        BALLOON_CYCLE_MS / speed,
      );
      if (next !== stateRef.current) {
        stateRef.current = next;
        setState(next);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [templateBalloons, speed]);

  const loadNextPiece = useCallback(() => {
    const next = startNextPiece(
      stateRef.current,
      balloonsRef.current,
      Date.now(),
    );
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    setNow(Date.now());
  }, []);

  const balloonMs = BALLOON_CYCLE_MS / speed;

  const status = useMemo(
    () => simStatus(state, templateBalloons, now, balloonMs),
    [state, templateBalloons, now, balloonMs],
  );

  const data = useMemo(
    () =>
      applySimToSnapshot(
        seed,
        state,
        templateBalloons,
        status,
        now,
        balloonMs,
      ),
    [seed, state, templateBalloons, status, now, balloonMs],
  );

  return { data, status, speed, setSpeed, loadNextPiece };
}
