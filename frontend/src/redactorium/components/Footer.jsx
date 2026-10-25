// The standalone page's footer: the Toolkit shell's footer (docs/design/DESIGN-SYSTEM.md §7,
// the 2026-09-23 shared footer), so a visitor who reaches the page directly sees the same
// band as everywhere else. Hidden in embed mode, where the shell's own footer follows the tool.
export default function Footer() {
  return (
    <footer className="af-colophon">
      <a className="af-colophon-brand" href="https://advokatfrida.com/">Advokat Frida</a>
      <nav aria-label="Footer">
        <a href="https://advokatfrida.com/about/">About</a>
        <a href="mailto:hello@advokatfrida.com">Contact</a>
        <a href="https://advokatfrida.com/privacy/">Privacy</a>
        <a href="https://advokatfrida.com/rss/">RSS</a>
      </nav>
    </footer>
  );
}
