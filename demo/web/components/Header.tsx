import Link from "next/link";
import { Mark } from "./Mark";

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="header">
      <Link href="/" className="brand" aria-label="CipherPhi, start again">
        <Mark size={34} />
        <span className="brand-name">CipherPhi</span>
      </Link>
      {children}
    </header>
  );
}

export function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}
