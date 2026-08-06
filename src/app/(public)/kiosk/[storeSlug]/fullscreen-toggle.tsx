"use client";

import { useEffect, useState } from "react";

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function handleChange() {
      setIsFullscreen(document.fullscreenElement !== null);
    }
    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, []);

  async function toggle() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen can be denied by the browser (no user gesture, unsupported
      // device) -- not worth surfacing an error for a UI nicety.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className="rounded-md p-2 text-xl leading-none text-muted-foreground hover:bg-accent"
    >
      {isFullscreen ? "⤡" : "⤢"}
    </button>
  );
}
