"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { CopilotContext as CopilotCtxPayload } from "@/lib/copilot/types";

type Store = {
  getContext: () => CopilotCtxPayload | undefined;
  setContext: (ctx: CopilotCtxPayload | null) => void;
};

const CopilotLiveContext = createContext<Store | null>(null);

export function CopilotContextProvider({ children }: { children: ReactNode }) {
  const ref = useRef<CopilotCtxPayload | null>(null);

  const setContext = useCallback((ctx: CopilotCtxPayload | null) => {
    ref.current = ctx;
  }, []);

  const getContext = useCallback(() => ref.current ?? undefined, []);

  const value = useMemo(
    () => ({ getContext, setContext }),
    [getContext, setContext],
  );

  return (
    <CopilotLiveContext.Provider value={value}>
      {children}
    </CopilotLiveContext.Provider>
  );
}

export function useCopilotLiveStore(): Store {
  const ctx = useContext(CopilotLiveContext);
  if (!ctx) {
    return {
      getContext: () => undefined,
      setContext: () => {},
    };
  }
  return ctx;
}

/** Publish live dashboard fields for the scripted copilot. */
export function usePublishCopilotContext(ctx: CopilotCtxPayload) {
  const { setContext } = useCopilotLiveStore();
  useEffect(() => {
    setContext(ctx);
    return () => setContext(null);
  }, [ctx, setContext]);
}
