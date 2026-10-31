import type { LearningResource, LearningTrack, Lesson, Module } from "@/lib/types";

type ResourceKey = keyof typeof CATALOG;
type ResourceEntry = Omit<LearningResource, "id">;

// Official project, university, author, and government pages checked 2026-10-31.
// These fixed URLs supplement saved modules without regenerating learner data.
const CATALOG = {
  sql: { title: "PostgreSQL tutorial: SQL and relational concepts", provider: "PostgreSQL", url: "https://www.postgresql.org/docs/current/tutorial.html", type: "documentation" },
  joins: { title: "Joins between tables", provider: "PostgreSQL", url: "https://www.postgresql.org/docs/current/tutorial-join.html", type: "documentation" },
  aggregates: { title: "Aggregate functions and GROUP BY", provider: "PostgreSQL", url: "https://www.postgresql.org/docs/current/tutorial-agg.html", type: "documentation" },
  python: { title: "The Python tutorial", provider: "Python", url: "https://docs.python.org/3/tutorial/", type: "documentation" },
  controlFlow: { title: "Python control flow and functions", provider: "Python", url: "https://docs.python.org/3/tutorial/controlflow.html", type: "documentation" },
  csv: { title: "Reading and writing CSV files", provider: "Python", url: "https://docs.python.org/3/library/csv.html", type: "documentation" },
  pandas: { title: "Getting started with pandas", provider: "pandas", url: "https://pandas.pydata.org/docs/getting_started/intro_tutorials/index.html", type: "documentation" },
  missingData: { title: "Working with missing data", provider: "pandas", url: "https://pandas.pydata.org/docs/user_guide/missing_data.html", type: "documentation" },
  merging: { title: "Merge, join, concatenate and compare", provider: "pandas", url: "https://pandas.pydata.org/docs/user_guide/merging.html", type: "documentation" },
  statistics: { title: "Statistics with scipy.stats", provider: "SciPy", url: "https://docs.scipy.org/doc/scipy/tutorial/stats.html", type: "documentation" },
  dataScience: { title: "Introduction to Computational Thinking and Data Science", provider: "MIT OpenCourseWare", url: "https://ocw.mit.edu/courses/6-0002-introduction-to-computational-thinking-and-data-science-fall-2016/", type: "course" },
  statisticalLearning: { title: "An Introduction to Statistical Learning", provider: "ISL authors", url: "https://www.statlearning.com/", type: "course" },
  matplotlib: { title: "Matplotlib plotting tutorials", provider: "Matplotlib", url: "https://matplotlib.org/stable/tutorials/index.html", type: "documentation" },
  seaborn: { title: "Statistical visualization with seaborn", provider: "seaborn", url: "https://seaborn.pydata.org/tutorial.html", type: "documentation" },
  machineLearning: { title: "Getting started with machine learning", provider: "scikit-learn", url: "https://scikit-learn.org/stable/getting_started.html", type: "documentation" },
  evaluation: { title: "Metrics and scoring for predictions", provider: "scikit-learn", url: "https://scikit-learn.org/stable/modules/model_evaluation.html", type: "documentation" },
  web: { title: "Learn web development", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development", type: "documentation" },
  css: { title: "CSS guides and layout reference", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Web/CSS", type: "documentation" },
  javascript: { title: "JavaScript guide", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide", type: "documentation" },
  http: { title: "An overview of HTTP", provider: "MDN Web Docs", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview", type: "documentation" },
  webCourse: { title: "CS50’s Web Programming with Python and JavaScript", provider: "Harvard University", url: "https://cs50.harvard.edu/web/", type: "course" },
  fullStack: { title: "Full Stack open", provider: "University of Helsinki", url: "https://fullstackopen.com/en/", type: "course" },
  react: { title: "React quick start", provider: "React", url: "https://react.dev/learn", type: "documentation" },
  thinkingReact: { title: "Thinking in React", provider: "React", url: "https://react.dev/learn/thinking-in-react", type: "documentation" },
  designSystem: { title: "GOV.UK Design System", provider: "GOV.UK", url: "https://design-system.service.gov.uk/", type: "documentation" },
  userResearch: { title: "User research methods and planning", provider: "GOV.UK", url: "https://www.gov.uk/service-manual/user-research", type: "article" },
  userCentered: { title: "User-centered design", provider: "MIT OpenCourseWare", url: "https://ocw.mit.edu/courses/6-831-user-interface-design-and-implementation-spring-2011/pages/in-class-activities/user-centered-design/", type: "article" },
  prototyping: { title: "Prototyping", provider: "MIT OpenCourseWare", url: "https://ocw.mit.edu/courses/6-831-user-interface-design-and-implementation-spring-2011/pages/in-class-activities/prototyping/", type: "article" },
  userTesting: { title: "User testing", provider: "MIT OpenCourseWare", url: "https://ocw.mit.edu/courses/6-831-user-interface-design-and-implementation-spring-2011/pages/in-class-activities/user-testing/", type: "article" },
  accessibility: { title: "Introduction to web accessibility", provider: "W3C WAI", url: "https://www.w3.org/WAI/fundamentals/accessibility-intro/", type: "article" },
  accessibleDesign: { title: "Accessibility in interface design", provider: "MIT OpenCourseWare", url: "https://ocw.mit.edu/courses/6-831-user-interface-design-and-implementation-spring-2011/pages/in-class-activities/accessibility/", type: "article" },
  accessibilityTutorials: { title: "Web accessibility tutorials", provider: "W3C WAI", url: "https://www.w3.org/WAI/tutorials/", type: "documentation" },
} satisfies Record<string, ResourceEntry>;

const FAMILIES: { patterns: RegExp[]; resources: ResourceKey[] }[] = [
  { patterns: [/\bsql\b/i, /\bdatabases?\b/i, /\bjoins?\b/i, /\bgroup by\b/i, /\bqueries\b/i], resources: ["sql", "joins", "aggregates"] },
  { patterns: [/\bpython\b/i, /\bvariables?\b/i, /\bfunctions?\b/i, /\bloops?\b/i, /\bcsv\b/i], resources: ["python", "controlFlow", "csv"] },
  { patterns: [/\bpandas\b/i, /\bdataframes?\b/i, /\bmissing (?:data|values)\b/i, /\b(?:data cleaning|messy data)\b/i], resources: ["pandas", "missingData", "merging"] },
  { patterns: [/\bstatistics?\b/i, /\bprobability\b/i, /\bsampling\b/i, /\b(?:mean|median|variation)\b/i], resources: ["statistics", "dataScience", "statisticalLearning"] },
  { patterns: [/\bvisualiz(?:e|ation)\b/i, /\bcharts?\b/i, /\bexploratory\b/i, /\bdata story\b/i], resources: ["matplotlib", "seaborn", "pandas"] },
  { patterns: [/\bmachine learning\b/i, /\bpredictive\b/i, /\b(?:regression|classification)\b/i, /\bmodel evaluation\b/i, /\btrain[ /-]test\b/i], resources: ["machineLearning", "evaluation", "statisticalLearning"] },
  { patterns: [/\bhtml\b/i, /\bhttp\b/i, /\bweb\b/i, /\bsemantic\b/i], resources: ["web", "http", "webCourse"] },
  { patterns: [/\bcss\b/i, /\b(?:flexbox|grid)\b/i, /\bresponsive\b/i, /\bbox model\b/i, /\blayouts?\b/i], resources: ["css", "web", "webCourse"] },
  { patterns: [/\bjavascript\b/i, /\basync\b/i, /\bevents?\b/i], resources: ["javascript", "webCourse", "fullStack"] },
  { patterns: [/\breact\b/i, /\bcomponents?\b/i, /\bprops\b/i, /\bstate\b/i], resources: ["react", "thinkingReact", "fullStack"] },
  { patterns: [/\bapi\b/i, /\brouting\b/i, /\bvalidation\b/i, /\bapplications?\b/i], resources: ["http", "fullStack", "webCourse"] },
  { patterns: [/\buser (?:needs|research)\b/i, /\binterviews?\b/i, /\bobservation\b/i, /\bproblem framing\b/i], resources: ["userResearch", "userCentered", "userTesting"] },
  { patterns: [/\b(?:prototyp(?:e|es|ing)|wireframes?)\b/i, /\busability\b/i, /\buser flows?\b/i, /\biteration\b/i], resources: ["prototyping", "userTesting", "userCentered"] },
  { patterns: [/\bdesign systems?\b/i, /\btypography\b/i, /\bvisual language\b/i, /\binformation architecture\b/i, /\bhierarchy\b/i], resources: ["designSystem", "userCentered", "prototyping"] },
  { patterns: [/\baccessibility\b/i, /\b(?:inclusive|contrast|keyboard)\b/i], resources: ["accessibility", "accessibilityTutorials", "accessibleDesign"] },
];

const FOUNDATIONS: Record<LearningTrack, ResourceKey[]> = {
  "data-science": ["python", "pandas", "dataScience", "statistics"],
  "web-development": ["web", "http", "webCourse", "accessibility"],
  "product-design": ["userCentered", "userResearch", "designSystem", "accessibility"],
};

function urlKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch { return null; }
}

/** Add useful reading to both old and new lessons without modifying saved state. */
export function resourcesForLesson(lesson: Lesson, module: Module, track: LearningTrack = "data-science"): LearningResource[] {
  const heading = `${lesson.title} ${module.title} ${module.topics.join(" ")}`;
  const context = `${module.description} ${lesson.slides.map((slide) => `${slide.title} ${slide.bullets.join(" ")}`).join(" ")}`;
  const ranked = FAMILIES.map((family, index) => ({
    ...family, index,
    score: family.patterns.reduce((score, pattern) => score + (pattern.test(heading) ? 8 : 0) + (pattern.test(context) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const recommendations = ranked[0].score > 0 ? ranked[0].resources : FOUNDATIONS[track];
  const result: LearningResource[] = [];
  const seen = new Set<string>();
  function add(resource: LearningResource) {
    const key = urlKey(resource.url);
    if (!key || seen.has(key) || result.length >= 5) return;
    seen.add(key);
    result.push({ ...resource });
  }
  module.resources.forEach(add);
  for (const key of recommendations) add({ ...CATALOG[key], id: `${module.id}-reading-${key}` });
  // A saved source may already be one of the recommendations. Supply enough
  // distinct reading choices while retaining its existing title and provider.
  for (const key of FOUNDATIONS[track]) {
    if (result.length >= 4) break;
    add({ ...CATALOG[key], id: `${module.id}-reading-${key}` });
  }
  return result;
}
