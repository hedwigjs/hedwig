import { useCallback, useEffect, useState } from "react";
import { MBDT_TAB_DEFINITIONS } from "../../tabs/definitions";
import { clampSizeMain, DEFAULT_SIZE_MAIN } from "./panelFrame";
import type { DevToolsLayoutState, DevToolsPanelPosition, DevToolsPreFullscreen, DevToolsTabId } from "./panelTypes";

// v3: FAB position was split from panel position — FAB anchors to the right
// edge as a stable rail, panel defaults back to "bottom" (its natural home for
// message flow inspection). Bumping the key so existing users whose v2 stored
// "right" get the new panel default without a manual localStorage wipe.
const DEFAULT_KEY = "mbdt.layout.v3";

function readJson(storageKey: string): Partial<DevToolsLayoutState> | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as Partial<DevToolsLayoutState>;
  } catch {
    return null;
  }
}

function writeJson(storageKey: string, data: DevToolsLayoutState) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const payload: Record<string, unknown> = {
      position: data.position,
      activeTab: data.activeTab,
      isOpen: data.isOpen,
      isFullscreen: data.isFullscreen,
      sizeMain: data.sizeMain,
    };
    if (data.isFullscreen && data.preFullscreen) {
      payload.preFullscreen = data.preFullscreen;
    }
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

const VALID_POSITION: DevToolsPanelPosition[] = [
  "top",
  "bottom",
  "left",
  "right",
];
const VALID_TAB: DevToolsTabId[] = MBDT_TAB_DEFINITIONS.map((t) => t.id);

function parsePre(
  raw: unknown,
  fallbackPos: DevToolsPanelPosition,
): DevToolsPreFullscreen | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as { sizeMain?: number; position?: string };
  if (typeof o.sizeMain !== "number" || !VALID_POSITION.includes(o.position as DevToolsPanelPosition)) {
    return null;
  }
  return {
    sizeMain: o.sizeMain,
    position: o.position as DevToolsPanelPosition,
  };
}

function normalize(
  raw: Partial<DevToolsLayoutState> | null,
  defaults: Pick<DevToolsLayoutState, "position" | "activeTab" | "isOpen">,
): DevToolsLayoutState {
  const position =
    raw?.position && VALID_POSITION.includes(raw.position)
      ? raw.position
      : defaults.position;
  const activeTab =
    raw?.activeTab && VALID_TAB.includes(raw.activeTab)
      ? raw.activeTab
      : defaults.activeTab;
  const isOpen = typeof raw?.isOpen === "boolean" ? raw.isOpen : defaults.isOpen;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const defaultMain = DEFAULT_SIZE_MAIN[position];
  const sizeRaw = typeof raw?.sizeMain === "number" ? raw.sizeMain : defaultMain;
  let sizeMain = clampSizeMain(position, sizeRaw, vw, vh);
  const wantFs = raw?.isFullscreen === true;
  const pre = wantFs ? parsePre(raw?.preFullscreen, position) : null;
  if (wantFs && !pre) {
    return {
      isOpen,
      position,
      activeTab,
      isFullscreen: false,
      sizeMain,
      preFullscreen: null,
    };
  }
  return {
    isOpen,
    position,
    activeTab,
    isFullscreen: wantFs && pre != null,
    sizeMain,
    preFullscreen: wantFs && pre ? pre : null,
  };
}

export function usePanelLayoutState(options: {
  storageKey?: string;
  defaultPosition: DevToolsPanelPosition;
  defaultOpen?: boolean;
}): [
  state: DevToolsLayoutState,
  actions: {
    setOpen: (v: boolean) => void;
    toggle: () => void;
    setPosition: (p: DevToolsPanelPosition) => void;
    setActiveTab: (t: DevToolsTabId) => void;
    setSizeMain: (px: number) => void;
    toggleFullscreen: () => void;
  },
] {
  const key = options.storageKey ?? DEFAULT_KEY;
  const [state, setState] = useState<DevToolsLayoutState>(() => {
    const stored = readJson(key);
    return normalize(stored, {
      position: options.defaultPosition,
      activeTab: "messages",
      isOpen: options.defaultOpen ?? false,
    });
  });

  useEffect(() => {
    writeJson(key, state);
  }, [key, state]);

  useEffect(() => {
    const onResize = () => {
      setState((s) => {
        if (s.isFullscreen) {
          return s;
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
          ...s,
          sizeMain: clampSizeMain(s.position, s.sizeMain, vw, vh),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setOpen = useCallback((isOpen: boolean) => {
    setState((s) => ({ ...s, isOpen }));
  }, []);

  const toggle = useCallback(() => {
    setState((s) => ({ ...s, isOpen: !s.isOpen }));
  }, []);

  const setPosition = useCallback((position: DevToolsPanelPosition) => {
    setState((s) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nextMain = clampSizeMain(
        position,
        s.sizeMain,
        vw,
        vh,
      );
      return { ...s, position, sizeMain: nextMain };
    });
  }, []);

  const setActiveTab = useCallback((activeTab: DevToolsTabId) => {
    setState((s) => ({ ...s, activeTab }));
  }, []);

  const setSizeMain = useCallback((px: number) => {
    setState((s) => {
      if (s.isFullscreen) {
        return s;
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return { ...s, sizeMain: clampSizeMain(s.position, px, vw, vh) };
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setState((s) => {
      if (s.isFullscreen) {
        const pre = s.preFullscreen;
        if (!pre) {
          return {
            ...s,
            isFullscreen: false,
            preFullscreen: null,
            sizeMain: DEFAULT_SIZE_MAIN[s.position],
          };
        }
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        return {
          ...s,
          isFullscreen: false,
          preFullscreen: null,
          position: pre.position,
          sizeMain: clampSizeMain(pre.position, pre.sizeMain, vw, vh),
        };
      }
      return {
        ...s,
        isFullscreen: true,
        preFullscreen: { sizeMain: s.sizeMain, position: s.position },
      };
    });
  }, []);

  return [state, { setOpen, toggle, setPosition, setActiveTab, setSizeMain, toggleFullscreen }];
}
