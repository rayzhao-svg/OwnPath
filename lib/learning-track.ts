import type { LearningTrack } from "@/lib/types";

const signals: { track: LearningTrack; strong: RegExp; weak: RegExp }[] = [
  {
    track: "data-science",
    strong: /\b(?:data\s+(?:science|scientist|analysis|analyst|analytics|engineering)|machine\s+learning|statistical\s+analysis|analy[sz](?:e|ing)\s+(?:\w+\s+){0,3}data)\b/,
    weak: /\b(?:python|sql|pandas|statistics)\b/,
  },
  {
    track: "web-development",
    strong: /\b(?:web(?:site)?s?|web\s+(?:development|developer|apps?|applications?)|(?:front|back|full)\s*[- ]?\s*stack|front\s*[- ]?\s*end|back\s*[- ]?\s*end)\b/,
    weak: /\b(?:html|css|javascript|typescript|react|next\.?js|node\.?js)\b/,
  },
  {
    track: "product-design",
    strong: /\b(?:product\s+design|ux|ui|user\s+(?:experience|interface|research)|prototyp(?:e|es|ing)|wirefram(?:e|es|ing)|interaction\s+design)\b/,
    weak: /\b(?:figma|usability)\b/,
  },
];

/** Map a goal to the supported curriculum; ambiguous goals keep the existing track. */
export function inferLearningTrack(
  goals: string,
  fallback: LearningTrack = "data-science",
): LearningTrack {
  const text = goals.toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, "-");
  const clauses = text
    .split(/[!?;\n]|\.(?:\s|$)|\b(?:but|however)\b/)
    .map((part) => part.split(/\brather than\b|\binstead of\b|,\s*not\b/)[0]);
  const intent = /\b(?:(?:want|hope|aim|plan|need|would\s+like)\s+to|(?:my\s+)?goal\s+is(?:\s+to)?|(?:switch|transition|move|pivot)\s+(?:from\b.*?\b)?(?:to|into))\b/g;
  const focused: string[] = [];
  const neutral: string[] = [];

  for (const clause of clauses) {
    const matches = [...clause.matchAll(intent)];
    const last = matches.at(-1);
    if (last) {
      const prefix = clause.slice(0, last.index);
      if (!/\b(?:don't|do\s+not|not|never|no\s+longer)\s*$/.test(prefix)) {
        focused.push(clause.slice(last.index + last[0].length));
      }
    } else if (!/\b(?:don't|do\s+not|not|never|no\s+longer)\b/.test(clause)) {
      neutral.push(clause);
    }
  }

  // Explicit aspirations outweigh background mentions; subject names outweigh tools.
  const target = (focused.length ? focused : neutral).join(" ");
  const scores = signals.map(({ track, strong, weak }) => ({
    track,
    score: (strong.test(target) ? 4 : 0) + (weak.test(target) ? 1 : 0),
  }));
  const best = Math.max(...scores.map((item) => item.score));
  const winners = scores.filter((item) => item.score === best);
  return best > 0 && winners.length === 1 ? winners[0].track : fallback;
}
