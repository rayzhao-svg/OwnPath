import Link from "next/link";
import { Brand } from "@/components/brand";
import { ClaudeCredit } from "@/components/claude-credit";
import { Icon } from "@/components/icon";

function PathPreview() {
  return (
    <div
      className="path-preview"
      aria-label="Illustrative personalized data science learning path"
    >
      <div className="preview-heading">
        <span className="preview-overline">A PATH WITH YOUR NAME ON IT</span>
        <span className="preview-live">
          <span /> Made for you
        </span>
      </div>
      <div className="preview-path-title">
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h3>
            From curious
            <br />
            to capable.
          </h3>
        </div>
        <div className="preview-plant">
          <svg viewBox="0 0 130 150" fill="none" aria-hidden="true">
            <path d="M64 144V35" stroke="#405840" strokeWidth="2" />
            <path
              d="M64 79C30 80 17 55 20 32c30 0 45 18 44 47Z"
              fill="#b9cda6"
            />
            <path
              d="M65 108c34 0 49-23 47-46-31-2-46 19-47 46Z"
              fill="#6c8765"
            />
            <path
              d="M65 48C43 37 42 17 51 3c23 12 26 28 14 45Z"
              fill="#d4e6a7"
            />
            <path
              d="m64 80-30-32m31 60 34-30"
              stroke="#405840"
              strokeWidth="1"
            />
            <ellipse cx="65" cy="144" rx="40" ry="4" fill="#dee5d6" />
          </svg>
        </div>
      </div>
      <div className="preview-profile">
        <span className="preview-avatar">A</span>
        <div>
          <strong>Alex’s learning path</strong>
          <small>Business background → Data science</small>
        </div>
        <Icon name="sparkles" size={19} />
      </div>
      <div className="preview-module">
        <span className="preview-node completed">
          <Icon name="check" size={15} />
        </span>
        <div>
          <small>START WITH WHAT YOU KNOW</small>
          <strong>Your experience is your foundation</strong>
        </div>
      </div>
      <div className="preview-module current">
        <span className="preview-node">01</span>
        <div>
          <small>BUILD YOUR FOUNDATION</small>
          <strong>Think like a data scientist</strong>
          <span className="preview-module-meta">
            <Icon name="headphones" size={12} /> Narrated lesson <span>·</span>{" "}
            Your pace
          </span>
        </div>
        <span className="preview-play">
          <Icon name="play" size={15} />
        </span>
      </div>
      <div className="preview-module">
        <span className="preview-node">02</span>
        <div>
          <small>CONNECT THE DOTS</small>
          <strong>Turn information into insight</strong>
        </div>
        <Icon name="lock" size={15} />
      </div>
      <div className="preview-bottom">
        <Icon name="clock" size={14} />
        <span>Fits around your life. Grows with you.</span>
      </div>
      <div className="floating-note">
        <span>
          <Icon name="sparkles" size={18} />
        </span>
        <div>
          <strong>Less searching. More learning.</strong>
          <small>A clear next step, every time.</small>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-header page-container">
        <div className="landing-brand">
          <Brand />
          <ClaudeCredit />
        </div>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#your-toolkit">Your toolkit</a>
          <Link href="/dashboard" className="landing-nav-link">
            My learning <Icon name="arrow-right" size={15} />
          </Link>
          <Link href="/account" className="landing-nav-link">Sign in</Link>
        </nav>
      </header>
      <main id="main-content">
        <section className="landing-hero page-container">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span /> A LITTLE DIRECTION. A WORLD OF POSSIBILITY.
            </div>
            <h1>
              Your ambition.
              <br />
              Your pace.
              <br />
              <span>Your own path.</span>
            </h1>
            <p className="hero-tagline">
              Everything you need to learn.
              <br />
              Nothing you don&apos;t.
            </p>
            <p className="hero-description">
              Turn where you’ve been into where you want to go. A personal
              learning path shaped by your experience, your goals, and the time
              you actually have.
            </p>
            <div className="hero-actions">
              <Link href="/onboarding" className="button button-primary">
                Find my path <Icon name="arrow-right" size={18} />
              </Link>
              <Link href="/dashboard" className="button button-text">
                Explore a sample path <Icon name="chevron-right" size={16} />
              </Link>
            </div>
            <div className="hero-footnote">
              <span className="mini-check">
                <Icon name="check" size={11} />
              </span>
              No account needed <span className="dot-divider">·</span> Start
              with a simple conversation
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-orbit" />
            <PathPreview />
            <span className="visual-caption">
              Not another course catalog. A way forward.
            </span>
          </div>
        </section>
        <div className="principles-strip">
          <div className="page-container">
            <span>BUILT AROUND THE WAY YOU LEARN</span>
            <div>
              <Icon name="target" size={18} /> Your goals first
            </div>
            <div>
              <Icon name="book" size={18} /> Knowledge that connects
            </div>
            <div>
              <Icon name="clock" size={18} /> Room for real life
            </div>
          </div>
        </div>
        <section id="how-it-works" className="how-section page-container">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A CLEARER WAY FORWARD</span>
              <h2>
                You bring the curiosity.
                <br />
                We’ll bring the direction.
              </h2>
            </div>
            <p>
              You don’t have to start from scratch.
              <br />
              You just need a place to start.
            </p>
          </div>
          <div className="how-grid">
            {[
              {
                n: "01",
                icon: "target" as const,
                title: "Start with your story",
                text: "Tell us what you know, where you’ve worked, and what you want to do next.",
              },
              {
                n: "02",
                icon: "layers" as const,
                title: "See your next steps",
                text: "Get an ordered curriculum that connects your experience to your ambition.",
              },
              {
                n: "03",
                icon: "leaf" as const,
                title: "Make it your own",
                text: "Listen, ask questions, and check your understanding. Keep moving at your pace.",
              },
            ].map((step) => (
              <article className="how-card" key={step.n}>
                <div className="how-card-top">
                  <span className="feature-icon">
                    <Icon name={step.icon} size={23} />
                  </span>
                  <span>{step.n}</span>
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section id="your-toolkit" className="toolkit-section page-container">
          <div className="toolkit-copy">
            <span className="eyebrow">A SMALL TOOLKIT. A BIG DIFFERENCE.</span>
            <h2>
              Learn a little.
              <br />
              Understand a lot.
            </h2>
            <p>
              One connected space to turn a lesson into something that stays
              with you.
            </p>
            <Link href="/dashboard" className="text-link">
              Take a look inside <Icon name="arrow-right" size={17} />
            </Link>
          </div>
          <div className="toolkit-list">
            {[
              {
                icon: "headphones" as const,
                title: "Lessons you can listen to",
                body: "Listen to each lesson with natural narration, or follow the transcript at your own pace.",
              },
              {
                icon: "chat" as const,
                title: "A question is always welcome",
                body: "Explore the current lesson with a contextual practice tutor.",
              },
              {
                icon: "check" as const,
                title: "Know when you’re ready",
                body: "Quick knowledge checks help you review and unlock the next step.",
              },
            ].map((item) => (
              <div key={item.title}>
                <span className="feature-icon">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="landing-cta page-container">
          <Icon name="leaf" size={33} />
          <h2>Your next chapter starts with you.</h2>
          <p>You already have a foundation. Let’s build on it.</p>
          <Link href="/onboarding" className="button button-primary">
            Find my path <Icon name="arrow-right" size={17} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer page-container">
        <Brand small />
        <p>Made for the way forward.</p>
        <span>Your path · Your pace · Your learning</span>
      </footer>
    </div>
  );
}
