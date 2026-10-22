import { useEffect, useState, type MouseEvent } from "react";

export function navigate(to: string, replace = false) {
  history[replace ? "replaceState" : "pushState"](null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useLocation(): URL {
  const [href, setHref] = useState(location.href);
  useEffect(() => {
    const sync = () => setHref(location.href);
    addEventListener("popstate", sync);
    return () => removeEventListener("popstate", sync);
  }, []);
  return new URL(href);
}

// ?next= only ever points back into this site, so a crafted link can't bounce
// someone from our sign-in page to another origin.
export function safeNext(raw: string | null, fallback = "/"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export function onLink(to: string) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}
