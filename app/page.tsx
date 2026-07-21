import { KayakChat } from "./components/kayak-chat";

export default function Home() {
  return (
    <>
      <div className="backdrop" aria-hidden>
        <div className="sun" />
        <svg className="wave wave-back" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0,64 C100,40 200,88 300,64 C400,40 500,88 600,64 C700,40 800,88 900,64 C1000,40 1100,88 1200,64 L1200,120 L0,120 Z" />
        </svg>
        <svg className="paddler" viewBox="0 0 120 60">
          <circle cx="60" cy="21" r="5.5" />
          <path d="M53,42 Q60,26 67,42 Z" />
          <g className="paddle-swing">
            <line x1="36" y1="16" x2="84" y2="36" strokeWidth="2.6" strokeLinecap="round" />
            <ellipse cx="36" cy="16" rx="4.5" ry="7.5" transform="rotate(24 36 16)" />
            <ellipse cx="84" cy="36" rx="4.5" ry="7.5" transform="rotate(24 84 36)" />
          </g>
          <path d="M6,45 Q60,34 114,45 Q60,56 6,45 Z" />
        </svg>
        <svg className="wave wave-mid" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0,58 C100,34 200,82 300,58 C400,34 500,82 600,58 C700,34 800,82 900,58 C1000,34 1100,82 1200,58 L1200,120 L0,120 Z" />
        </svg>
        <svg className="wave wave-front" viewBox="0 0 1200 120" preserveAspectRatio="none">
          <path d="M0,72 C100,52 200,92 300,72 C400,52 500,92 600,72 C700,52 800,92 900,72 C1000,52 1100,92 1200,72 L1200,120 L0,120 Z" />
        </svg>
      </div>
      <main>
        <header className="hero">
          <p className="eyebrow"><span className="eyebrow-dot" />Hudson River · Live conditions</p>
          <h1>Paddle <em>Agent</em></h1>
          <p className="lede">
            <span className="verse">&ldquo;The tide rises, the tide falls,<br />the twilight darkens, the curlew calls.&rdquo;</span>
            <span className="cite">— Henry Wadsworth Longfellow</span>
          </p>
        </header>
        <KayakChat />
        <aside className="launch-note">
          <span className="launch-glyph" aria-hidden>🛶</span>
          <p>
            Ready to paddle for real?{" "}
            <a href="https://sites.google.com/hobokencoveboathouse.org/hccb/home" target="_blank" rel="noreferrer">Hoboken Cove Community Boathouse</a>{" "}
            runs New Jersey&apos;s largest <em>free</em> paddling program — kayaks, paddleboards, and outrigger canoes on the Hoboken waterfront. All volunteer-run, no experience needed.
          </p>
        </aside>
        <footer className="colophon">
          <span>USGS + NOAA sensors</span><span className="flow-arrow">→</span>
          <span>ClickHouse</span><span className="flow-arrow">→</span>
          <span>Trigger.dev</span><span className="flow-arrow">→</span>
          <span>your paddle plan</span>
        </footer>
      </main>
    </>
  );
}
