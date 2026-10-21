import Image from "next/image";
import Link from "next/link";

/** The wordmark alone: the symbol needs 64 px or more to read, so it stays on the landing card. */
export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="header">
      <Link href="/" className="brand" aria-label="CipherPhi, start again">
        <Image src="/cipherphi-wordmark.png" alt="CipherPhi" width={109} height={24} priority />
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
