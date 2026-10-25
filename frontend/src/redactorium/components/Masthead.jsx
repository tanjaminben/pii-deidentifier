import { TID } from "@/redactorium/constants/testIds";

export default function Masthead() {
  return (
    <header data-testid={TID.siteHeader}>
      <div className="af-site-bar">
        <a className="af-wordmark" href="https://advokatfrida.com/">Advokat Frida</a>
        <a className="af-subscribe" href="https://advokatfrida.com/#/portal/signup">Subscribe</a>
        <nav className="af-bar-nav" aria-label="Sections">
          <ul>
            <li><a href="https://advokatfrida.com/tag/toolkit/">Toolkit</a></li>
            <li><a href="https://advokatfrida.com/tag/field-guides/">Field Guides</a></li>
            <li><a href="https://advokatfrida.com/tag/fridas-desk/">Frida&rsquo;s Desk</a></li>
            <li><a href="https://shop.advokatfrida.com">The Mercantile</a></li>
            <li><a href="https://advokatfrida.com/about/">About</a></li>
          </ul>
        </nav>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 pt-8 md:pt-10 pb-2">
        <h1
          data-testid={TID.mastheadTitle}
          tabIndex="-1"
          className="uppercase leading-none break-words"
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: "clamp(3rem, 7vw, 5.5rem)",
            letterSpacing: "-0.02em",
          }}
        >
          Redactorium
        </h1>
      </div>
    </header>
  );
}
