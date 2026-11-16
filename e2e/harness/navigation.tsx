import type { AnchorHTMLAttributes } from "react";
export function useRouter() {
  return { replace: (url: string) => window.location.assign(url), refresh: () => {} };
}
export function usePathname() { return window.location.pathname; }
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} />; }
