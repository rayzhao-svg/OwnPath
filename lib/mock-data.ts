import type {
  LearnerProfile,
  LearningResource,
  LearningTrack,
  Module,
  QuizQuestion,
  StudyPlan,
} from "@/lib/types";

export const DEMO_PROFILE: LearnerProfile = {
  id: "demo-learner",
  name: "Alex",
  background:
    "Business administration graduate with a foundation in statistics.",
  experience:
    "Two years in marketing, using spreadsheets to understand customer behavior.",
  skills: ["Excel", "Statistics", "Problem solving"],
  goals:
    "Transition into data science and turn customer data into useful decisions.",
  availableStudyTime: 5,
  track: "data-science",
};

interface Checkpoint {
  question: string;
  answer: string;
  distractors: [string, string, string];
  explanation: string;
}

export interface ModuleContent {
  title: string;
  description: string;
  topics: [string, string, string];
  takeaways: [string, string, string];
  example: string;
  practice: string;
  misconception: string;
  duration: number;
  skillKeywords: string[];
  resource: Omit<LearningResource, "id" | "type">;
  checkpoints: [Checkpoint, Checkpoint];
}

const python = {
  title: "The Python tutorial",
  provider: "Python",
  url: "https://docs.python.org/3/tutorial/",
};
const pandas = {
  title: "Getting started with pandas",
  provider: "pandas",
  url: "https://pandas.pydata.org/docs/getting_started/intro_tutorials/index.html",
};
const sklearn = {
  title: "Getting started with machine learning",
  provider: "scikit-learn",
  url: "https://scikit-learn.org/stable/getting_started.html",
};
const mdn = {
  title: "Learn web development",
  provider: "MDN Web Docs",
  url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
};
const wai = {
  title: "Introduction to web accessibility",
  provider: "W3C WAI",
  url: "https://www.w3.org/WAI/fundamentals/accessibility-intro/",
};
const govDesign = {
  title: "GOV.UK Design System",
  provider: "GOV.UK",
  url: "https://design-system.service.gov.uk/",
};

export const TRACK_TITLES: Record<LearningTrack, string> = {
  "data-science": "Data Science",
  "web-development": "Web Development",
  "product-design": "Product Design",
};

export const MODULE_CONTENT: Record<LearningTrack, ModuleContent[]> = {
  "data-science": [
    {
      title: "Python for data thinking",
      description:
        "Build a practical Python foundation, one useful question at a time.",
      topics: ["Variables & types", "Lists & loops", "Functions"],
      takeaways: [
        "A variable gives a value a readable name; its type determines the operations you can use.",
        "A list stores an ordered collection. A for loop processes each item without repeating code.",
        "A function packages a small task with clear inputs and a return value.",
      ],
      example:
        "Given sales = [10, 20, 30], sum(sales) / len(sales) returns 20. Python can answer a business question using a list and two reusable functions.",
      practice:
        "Write a function that accepts a list of prices and returns their average. Decide what should happen when the list is empty before dividing by its length.",
      misconception:
        "A number stored as text is not automatically a numeric value. Convert and validate input before doing arithmetic.",
      duration: 90,
      skillKeywords: ["python", "programming"],
      resource: python,
      checkpoints: [
        {
          question:
            "Which structure holds an ordered collection of sales values?",
          answer: "A list",
          distractors: ["A single boolean", "An import statement", "A comment"],
          explanation:
            "A list preserves a sequence of values that you can iterate over or summarize.",
        },
        {
          question: "What is the average of [10, 20, 30]?",
          answer: "20",
          distractors: ["60", "3", "30"],
          explanation:
            "The sum is 60 and there are 3 values, so the average is 60 / 3 = 20.",
        },
      ],
    },
    {
      title: "Make sense of messy data",
      description: "Turn raw tables into a reliable foundation for analysis.",
      topics: ["DataFrames", "Missing values", "Data cleaning"],
      takeaways: [
        "A DataFrame is a table with labeled columns and rows; inspect its schema before analyzing it.",
        "Missing values may mean unknown, unavailable, or not applicable. Investigate before replacing them.",
        "Check duplicates, types, and impossible values, and record each cleaning decision.",
      ],
      example:
        "In a customer table, two rows with the same customer ID may be duplicates or separate visits. Check the unit represented by each row before dropping either record.",
      practice:
        "Inspect a small table of customer purchases. Count missing amounts and duplicate transaction IDs, then explain a cleaning rule without changing the raw source.",
      misconception:
        "Replacing every missing amount with zero changes the meaning of unknown data and can bias the average.",
      duration: 120,
      skillKeywords: ["pandas", "data cleaning", "excel"],
      resource: pandas,
      checkpoints: [
        {
          question:
            "What should you do before replacing all missing values with zero?",
          answer: "Investigate what missing means in each column",
          distractors: [
            "Delete the entire dataset",
            "Assume all missing values are free purchases",
            "Train a model immediately",
          ],
          explanation:
            "A missing value is not necessarily a real zero. Its meaning should guide the cleaning rule.",
        },
        {
          question:
            "What identifies a potentially duplicated transaction most reliably?",
          answer: "A repeated transaction ID",
          distractors: [
            "Two customers with the same first name",
            "A high purchase amount",
            "An empty optional note",
          ],
          explanation:
            "A transaction ID is designed to identify a transaction, though context still matters when confirming duplication.",
        },
      ],
    },
    {
      title: "Statistics that tell a story",
      description: "Understand variation, typical values, and uncertainty.",
      topics: ["Mean & median", "Variation", "Sampling"],
      takeaways: [
        "The mean uses every value; the median is the middle value and is less sensitive to extreme observations.",
        "Spread matters: two groups can share an average but have very different distributions.",
        "A sample can support a broader conclusion only when its selection and uncertainty are considered.",
      ],
      example:
        "For purchase amounts [10, 12, 13, 15, 200], the median is 13 and the mean is 50. The large purchase pulls the mean far above a typical order.",
      practice:
        "Compare the mean and median for five order amounts. Add one unusually large order and describe which summary changes most.",
      misconception:
        "A correlation between two quantities does not establish that one causes the other.",
      duration: 100,
      skillKeywords: ["statistics", "math", "mathematics"],
      resource: {
        title: "Statistics in Python",
        provider: "Python",
        url: "https://docs.python.org/3/library/statistics.html",
      },
      checkpoints: [
        {
          question:
            "Which summary is less sensitive to a single extremely large order?",
          answer: "The median",
          distractors: ["The mean", "The sum", "The maximum"],
          explanation:
            "The median depends on the middle position rather than the magnitude of every value.",
        },
        {
          question:
            "A chart shows that two measures rise together. What can you conclude?",
          answer: "They are associated; causation needs more evidence",
          distractors: [
            "The first definitely causes the second",
            "The second definitely causes the first",
            "No further investigation is needed",
          ],
          explanation:
            "Confounding, reverse causation, or coincidence could explain an observed association.",
        },
      ],
    },
    {
      title: "Explore, visualize, discover",
      description: "Ask better questions and reveal useful patterns visually.",
      topics: ["Exploratory analysis", "Chart selection", "Communication"],
      takeaways: [
        "Start with a specific question and inspect distributions before comparing groups.",
        "Use a line chart for change over time, a histogram for a distribution, and a scatter plot for two numeric variables.",
        "Label axes and units, show relevant context, and avoid scales that exaggerate small differences.",
      ],
      example:
        "To understand monthly sales, use a time-ordered line chart with months on the horizontal axis and sales in dollars on the vertical axis. A scatter plot is better for comparing ad spend and revenue.",
      practice:
        "Choose charts for monthly revenue, individual order sizes, and the relationship between visits and purchases. Write one question each chart should answer.",
      misconception:
        "A visually striking chart is not automatically informative. The chart type and scale must support the question.",
      duration: 100,
      skillKeywords: ["visualization", "tableau", "charts"],
      resource: {
        title: "Plotting with pandas",
        provider: "pandas",
        url: "https://pandas.pydata.org/docs/getting_started/intro_tutorials/04_plotting.html",
      },
      checkpoints: [
        {
          question:
            "Which chart is best suited to monthly revenue over one year?",
          answer: "A line chart ordered by month",
          distractors: [
            "An unordered pie chart",
            "A word cloud",
            "A single number without context",
          ],
          explanation:
            "A line chart preserves time order and makes trends easier to inspect.",
        },
        {
          question: "What should every quantitative chart make clear?",
          answer: "The measures, units, and relevant scale",
          distractors: [
            "As many colors as possible",
            "Only the largest value",
            "A decorative background",
          ],
          explanation:
            "Labels, units, and scale let readers interpret what the visual actually measures.",
        },
      ],
    },
    {
      title: "Your first predictive model",
      description: "Move from observations to a simple, testable prediction.",
      topics: ["Features & targets", "Train/test split", "Model evaluation"],
      takeaways: [
        "Features are information available at prediction time; the target is what you want to predict.",
        "Hold out test data before fitting transformations or the model to avoid leaking future information.",
        "Compare a model with a simple baseline using a metric that reflects the cost of errors.",
      ],
      example:
        "To predict next month's sales, train on earlier months and evaluate on later held-out months. Compare the model with a baseline that predicts the previous month's sales.",
      practice:
        "Define a target, three features available before prediction, and a baseline for forecasting weekly store sales. Describe a time-aware split.",
      misconception:
        "High training accuracy does not guarantee useful predictions on new data. Evaluate on data the model has not seen.",
      duration: 150,
      skillKeywords: ["machine learning", "scikit-learn", "regression"],
      resource: sklearn,
      checkpoints: [
        {
          question: "Why keep a test set separate from training?",
          answer: "To estimate performance on unseen data",
          distractors: [
            "To make training accuracy perfect",
            "To remove the need for a baseline",
            "To ensure every prediction is correct",
          ],
          explanation:
            "An untouched test set helps estimate how well a model generalizes.",
        },
        {
          question:
            "Which feature would leak information when predicting a future refund?",
          answer: "The refund amount recorded after the decision",
          distractors: [
            "The original purchase price",
            "The customer's earlier purchase count",
            "The product category known at checkout",
          ],
          explanation:
            "A value known only after the event would not be available when a real prediction is made.",
        },
      ],
    },
    {
      title: "Build your data story",
      description: "Bring your skills together in a focused portfolio project.",
      topics: ["Project framing", "Reproducibility", "Recommendations"],
      takeaways: [
        "Frame one useful question, define the audience, and decide how a successful answer would inform a decision.",
        "Keep data sources, cleaning steps, assumptions, and analysis reproducible.",
        "Present findings with limitations and connect recommendations to the evidence.",
      ],
      example:
        "A small project could ask which product categories have the most repeat purchases. A reproducible notebook shows cleaning steps, a clear comparison, and limitations such as incomplete purchase history.",
      practice:
        "Outline a project with one question, an accessible dataset, three analysis steps, one chart, and one limitation. Explain what decision it could support.",
      misconception:
        "A portfolio project does not need the most complex model. A clear question and defensible evidence are more useful than unnecessary complexity.",
      duration: 180,
      skillKeywords: ["portfolio", "jupyter", "data analysis"],
      resource: {
        title: "Jupyter Notebook documentation",
        provider: "Project Jupyter",
        url: "https://jupyter-notebook.readthedocs.io/en/stable/",
      },
      checkpoints: [
        {
          question: "What makes an analysis reproducible?",
          answer: "Documented data sources, steps, and assumptions",
          distractors: [
            "Only a final screenshot",
            "An undocumented spreadsheet",
            "A complex chart with no labels",
          ],
          explanation:
            "Another person should be able to follow the inputs and steps and understand the resulting evidence.",
        },
        {
          question: "What belongs alongside a project recommendation?",
          answer: "Supporting evidence and limitations",
          distractors: [
            "A guarantee of future results",
            "Only the most favorable chart",
            "Claims beyond the available data",
          ],
          explanation:
            "Evidence and limitations help the audience judge how much confidence to place in a recommendation.",
        },
      ],
    },
  ],
  "web-development": [
    {
      title: "The web, from first principles",
      description: "Understand how pages travel from server to browser.",
      topics: ["HTTP", "Semantic HTML", "Page structure"],
      takeaways: [
        "A browser requests a resource from a server using HTTP and receives a response with a status and content.",
        "HTML describes document meaning and structure; use headings, links, buttons, and landmarks for their intended purpose.",
        "A clear document structure makes a page easier to navigate with a keyboard or assistive technology.",
      ],
      example:
        "Opening a page sends an HTTP request. The server returns HTML; a real button element gives a form action keyboard behavior and semantics without custom code.",
      practice:
        "Sketch a page using header, nav, main, and footer. Use a link to navigate and a button for an action.",
      misconception:
        "A clickable div does not automatically provide the behavior and accessibility of a button.",
      duration: 90,
      skillKeywords: ["html", "http"],
      resource: mdn,
      checkpoints: [
        {
          question: "What is the appropriate element for submitting a form?",
          answer: "A button",
          distractors: [
            "A decorative div",
            "A heading",
            "An image with no label",
          ],
          explanation:
            "A native button supports expected semantics and keyboard interaction.",
        },
        {
          question: "What does an HTTP response contain?",
          answer: "A status and usually requested content",
          distractors: [
            "Only CSS",
            "Only a database password",
            "The browser's full history",
          ],
          explanation:
            "HTTP responses communicate the outcome of a request through status codes, headers, and optional body content.",
        },
      ],
    },
    {
      title: "Layouts that adapt",
      description: "Create clear, responsive interfaces with modern CSS.",
      topics: ["Box model", "Flexbox & grid", "Responsive design"],
      takeaways: [
        "The box model combines content, padding, border, and margin to determine layout space.",
        "Flexbox arranges items along one primary axis; grid supports rows and columns together.",
        "Use flexible sizes and media queries, and test content at narrow and wide viewports.",
      ],
      example:
        "A course list can use a one-column grid on a phone and two columns when there is enough room. A flexible container avoids horizontal overflow.",
      practice:
        "Build a card grid that becomes one column on a narrow screen. Verify long titles wrap and controls remain usable.",
      misconception:
        "Responsive design is not just shrinking text; content order, spacing, and controls must still work.",
      duration: 120,
      skillKeywords: ["css", "tailwind", "flexbox"],
      resource: mdn,
      checkpoints: [
        {
          question: "Which CSS layout supports explicit rows and columns?",
          answer: "Grid",
          distractors: ["Text decoration", "Opacity", "A comment"],
          explanation: "CSS Grid is a two-dimensional layout system.",
        },
        {
          question: "What is a useful responsive-design check?",
          answer: "Test a narrow viewport with long real content",
          distractors: [
            "Check only a large monitor",
            "Hide every overflow without inspection",
            "Use fixed widths for every element",
          ],
          explanation:
            "Realistic content at narrow widths reveals wrapping, overflow, and control usability issues.",
        },
      ],
    },
    {
      title: "JavaScript in action",
      description: "Use state and events to make a page respond.",
      topics: ["Functions", "Events", "Async requests"],
      takeaways: [
        "Functions package behavior and can receive values and return results.",
        "An event handler responds to user input; keep the current state as the source of rendered behavior.",
        "Await asynchronous requests and handle loading, success, and failure states explicitly.",
      ],
      example:
        "A search form starts in an idle state, shows a loading message after submission, then renders results or a useful error. A failed request should allow retrying.",
      practice:
        "Describe the idle, loading, success, and failure states for a search button. Prevent duplicate requests while loading.",
      misconception:
        "A fetch promise can resolve for an HTTP error. Check response.ok before trusting the result.",
      duration: 130,
      skillKeywords: ["javascript", "typescript"],
      resource: mdn,
      checkpoints: [
        {
          question: "What should you check after a fetch resolves?",
          answer: "Whether the HTTP response was successful",
          distractors: [
            "Assume every response is successful",
            "Always discard the response",
            "Reload immediately",
          ],
          explanation:
            "Network success and HTTP success are distinct; response.ok identifies successful HTTP status codes.",
        },
        {
          question: "Which states should a request-driven interface handle?",
          answer: "Loading, success, and failure",
          distractors: [
            "Success only",
            "Loading forever",
            "Only the initial render",
          ],
          explanation:
            "Explicit request states provide useful feedback and allow recovery when a request fails.",
        },
      ],
    },
    {
      title: "Think in React",
      description: "Compose reusable interfaces with props and state.",
      topics: ["Components", "Props", "State"],
      takeaways: [
        "A component describes a reusable part of an interface using its inputs and current state.",
        "Props pass data down from a parent; state stores values that change through interaction.",
        "Update state immutably and derive values from existing state instead of storing redundant copies.",
      ],
      example:
        "A lesson component receives a slides prop and stores only the current slide index. The displayed slide is derived from slides[index], so the data stays consistent.",
      practice:
        "Design a slide viewer with a slides prop and currentIndex state. Derive the slide count rather than storing it separately.",
      misconception:
        "Mutating a state array in place can prevent expected updates. Create a new array when updating state.",
      duration: 130,
      skillKeywords: ["react", "components"],
      resource: {
        title: "Learn React",
        provider: "React",
        url: "https://react.dev/learn",
      },
      checkpoints: [
        {
          question: "What is the usual way to pass data from parent to child?",
          answer: "Props",
          distractors: [
            "Mutating a global HTML string",
            "Changing a package version",
            "A CSS border",
          ],
          explanation:
            "Props are the explicit inputs passed from a parent to a child component.",
        },
        {
          question: "How should you add an item to React array state?",
          answer: "Create a new array and set that as state",
          distractors: [
            "Mutate the existing array without a state update",
            "Edit the DOM manually",
            "Change an unrelated prop",
          ],
          explanation:
            "An immutable update gives React a new value and keeps updates predictable.",
        },
      ],
    },
    {
      title: "From pages to applications",
      description: "Connect routes, data, and reliable server boundaries.",
      topics: ["Routing", "API contracts", "Validation"],
      takeaways: [
        "A route maps a URL to a page or handler; dynamic segments represent resources with stable IDs.",
        "A request/response contract defines what crosses the boundary between a client and server.",
        "Validate unknown data on the server and keep credentials in server-only environment variables.",
      ],
      example:
        "A lesson page reads an ID from the URL and calls a typed API. The server validates the request and returns either lesson data or a consistent error object.",
      practice:
        "Write a JSON request and success/error response for creating a study plan. Identify the fields the server must validate.",
      misconception:
        "TypeScript types disappear at runtime. External JSON still requires runtime validation.",
      duration: 140,
      skillKeywords: ["next.js", "nextjs", "api"],
      resource: {
        title: "Next.js App Router",
        provider: "Next.js",
        url: "https://nextjs.org/docs/app",
      },
      checkpoints: [
        {
          question: "Why validate JSON on the server when using TypeScript?",
          answer: "Types do not validate runtime inputs",
          distractors: [
            "JSON always includes trusted types",
            "The browser can never be modified",
            "Validation is only visual styling",
          ],
          explanation:
            "Runtime requests can contain arbitrary values regardless of the compile-time contract.",
        },
        {
          question: "Where should a private API key be used?",
          answer: "Only in server-side code",
          distractors: [
            "In a public browser bundle",
            "In a client-visible URL",
            "In a committed screenshot",
          ],
          explanation:
            "Private credentials must not be exposed to clients or tracked source files.",
        },
      ],
    },
    {
      title: "Ship a thoughtful project",
      description: "Test, polish, and share a small complete application.",
      topics: ["Accessibility", "Testing", "Deployment"],
      takeaways: [
        "Check key flows with a keyboard, clear labels, visible focus, and meaningful error messages.",
        "Test user-visible outcomes and important boundaries, including invalid input and failure states.",
        "Build for production and verify environment configuration before deployment.",
      ],
      example:
        "A project is ready to share when a learner can complete a form, recover from an error, and reach the result on a phone as well as a desktop.",
      practice:
        "Create a release checklist for the main user flow, a failed request, keyboard navigation, and a production build.",
      misconception:
        "A page that works in development can still fail a production build or a fresh-browser visit.",
      duration: 180,
      skillKeywords: ["testing", "accessibility", "deployment"],
      resource: wai,
      checkpoints: [
        {
          question: "What is a meaningful accessibility check?",
          answer: "Complete the main flow using only a keyboard",
          distractors: [
            "Use color alone for every error",
            "Remove visible focus",
            "Test only with a mouse",
          ],
          explanation:
            "Keyboard navigation reveals issues with focus order, native controls, and unreachable actions.",
        },
        {
          question:
            "Which check belongs before sharing a deployed application?",
          answer: "Run a production build and verify the main flow",
          distractors: [
            "Assume development success is sufficient",
            "Commit secret credentials",
            "Remove every error message",
          ],
          explanation:
            "Production compilation and a real flow check catch issues that development rendering can miss.",
        },
      ],
    },
  ],
  "product-design": [
    {
      title: "Start with the right problem",
      description: "Frame user needs before drawing a solution.",
      topics: ["Problem framing", "User needs", "Assumptions"],
      takeaways: [
        "A useful problem statement names a user, their context, and the outcome they need.",
        "Separate observations from assumptions and test the riskiest assumptions early.",
        "Define success in terms of a user outcome rather than the number of features shipped.",
      ],
      example:
        "Instead of deciding to add a dashboard, ask how a learner can identify the next useful study task when they have only twenty minutes.",
      practice:
        "Write a problem statement for a busy learner. List one observation, one assumption, and a question that could test that assumption.",
      misconception:
        "A requested feature is a possible solution, not proof of the underlying need.",
      duration: 90,
      skillKeywords: ["product", "problem framing", "strategy"],
      resource: govDesign,
      checkpoints: [
        {
          question: "What should a problem statement clarify?",
          answer: "The user, context, and needed outcome",
          distractors: [
            "Only the color palette",
            "Only a preferred feature",
            "A guaranteed business result",
          ],
          explanation:
            "User, context, and outcome establish what the design must help someone accomplish.",
        },
        {
          question: "Which statement is an assumption to investigate?",
          answer: "Learners will prefer a new dashboard",
          distractors: [
            "Three observed participants could not find the next lesson",
            "A recorded task took five minutes",
            "A participant said they were confused",
          ],
          explanation:
            "A preference predicted without supporting observation is a hypothesis, not established evidence.",
        },
      ],
    },
    {
      title: "Listen before you design",
      description: "Gather useful evidence through respectful research.",
      topics: ["Interviews", "Observation", "Synthesis"],
      takeaways: [
        "Ask open questions about recent real behavior rather than leading questions about a proposed feature.",
        "Observe what participants do as well as what they say, and record evidence with consent.",
        "Look for recurring needs while preserving differences between participant contexts.",
      ],
      example:
        "Ask a learner to describe their most recent study session. Follow up on where they stopped and what they used, instead of asking whether they want an AI tutor.",
      practice:
        "Write three open questions about a recent learning experience. Avoid suggesting an answer or a feature.",
      misconception:
        "Five interviews can reveal useful problems, but they do not establish the percentage of all users who share a preference.",
      duration: 120,
      skillKeywords: ["research", "interviews", "ux research"],
      resource: {
        title: "User research guidance",
        provider: "GOV.UK Service Manual",
        url: "https://www.gov.uk/service-manual/user-research",
      },
      checkpoints: [
        {
          question: "Which interview question is least leading?",
          answer: "Tell me about the last time you tried to learn a new skill",
          distractors: [
            "Wouldn't an AI dashboard be better?",
            "You prefer our design, right?",
            "Why is our new feature perfect?",
          ],
          explanation:
            "A question about recent behavior allows the participant to describe their own context without prescribing a solution.",
        },
        {
          question: "What should a research finding be linked to?",
          answer: "Observed or reported evidence and its context",
          distractors: [
            "Only the designer's favorite idea",
            "An invented quote",
            "A guess presented as a fact",
          ],
          explanation:
            "Traceable evidence and context help a team evaluate the strength and limits of a finding.",
        },
      ],
    },
    {
      title: "Give ideas a clear structure",
      description: "Make content and task flows easier to understand.",
      topics: ["Information architecture", "User flows", "Wireframes"],
      takeaways: [
        "Group content using labels and categories that match how users think about their task.",
        "A user flow maps decisions and states between a starting point and a useful outcome.",
        "Low-fidelity wireframes test hierarchy and flow before visual polish.",
      ],
      example:
        "A learner's flow might be choose a goal, review a path, open a lesson, and check understanding. Include empty and error states in that sequence.",
      practice:
        "Map a learner's path from arriving on a homepage to completing one lesson. Add a branch for a failed request.",
      misconception:
        "A sitemap lists pages; it does not fully describe the user's decisions and application states.",
      duration: 110,
      skillKeywords: ["wireframes", "information architecture", "user flows"],
      resource: govDesign,
      checkpoints: [
        {
          question: "What does a user flow help describe?",
          answer: "Actions, decisions, and states toward an outcome",
          distractors: [
            "Only font sizes",
            "Only a logo",
            "A list of unrelated colors",
          ],
          explanation:
            "A flow connects the steps and branches someone takes to accomplish a task.",
        },
        {
          question: "Why use low-fidelity wireframes early?",
          answer: "To test hierarchy and flow cheaply",
          distractors: [
            "To avoid all user feedback",
            "To guarantee the final design",
            "To choose a database",
          ],
          explanation:
            "Simple wireframes let teams revise structure before investing in detailed visuals.",
        },
      ],
    },
    {
      title: "Design a visual language",
      description: "Build readable, consistent interfaces with purpose.",
      topics: ["Typography", "Hierarchy", "Design systems"],
      takeaways: [
        "Use typography, spacing, and contrast to show which information and actions matter most.",
        "A small set of reusable tokens and components makes an interface more consistent.",
        "Keep interactive states, labels, and errors visible and understandable across the system.",
      ],
      example:
        "A shared button component can use consistent padding, readable labels, visible focus, and disabled/loading states across onboarding and lessons.",
      practice:
        "Define a text scale, spacing steps, and button states for a learning interface. Explain which action should be visually strongest.",
      misconception:
        "Consistency does not mean every element must look identical. Different roles need a clear, repeatable hierarchy.",
      duration: 120,
      skillKeywords: ["figma", "visual design", "design systems"],
      resource: govDesign,
      checkpoints: [
        {
          question: "What is the main purpose of visual hierarchy?",
          answer: "Help people notice and understand priority",
          distractors: [
            "Make every element equally prominent",
            "Hide important actions",
            "Use the maximum number of fonts",
          ],
          explanation:
            "Hierarchy guides attention and makes relationships and next actions easier to understand.",
        },
        {
          question: "What belongs in a reusable button specification?",
          answer: "Default, focus, disabled, and loading states",
          distractors: [
            "Only a static screenshot",
            "A color with no label",
            "Only the hover state",
          ],
          explanation:
            "Interactive components need defined states to remain understandable throughout real use.",
        },
      ],
    },
    {
      title: "Make the experience work for more people",
      description: "Build accessibility into everyday design decisions.",
      topics: ["Contrast", "Keyboard access", "Inclusive interaction"],
      takeaways: [
        "Provide sufficient text contrast and avoid communicating meaning through color alone.",
        "Interactive controls need accessible names, logical keyboard order, and visible focus.",
        "Use clear language, helpful errors, and alternatives for audio or visual-only content.",
      ],
      example:
        "A quiz should label each option, show selection with more than color, allow keyboard input, and explain errors in text.",
      practice:
        "Review a form for visible labels, keyboard focus, error explanations, and color-only feedback. Write one fix for each issue found.",
      misconception:
        "Accessibility cannot be confirmed by a color checker alone. Interaction, structure, content, and assistive technology behavior also matter.",
      duration: 100,
      skillKeywords: ["accessibility", "wcag", "inclusive design"],
      resource: wai,
      checkpoints: [
        {
          question: "How should an error be communicated?",
          answer: "With clear text in addition to any color",
          distractors: [
            "Through red color alone",
            "Only through sound",
            "By silently removing the field",
          ],
          explanation:
            "Text explains the problem and supports people who cannot perceive color or sound cues.",
        },
        {
          question: "What helps a keyboard user locate their current control?",
          answer: "A visible focus indicator",
          distractors: [
            "Removing outlines everywhere",
            "A hover effect only",
            "A decorative background",
          ],
          explanation: "Visible focus shows where keyboard actions will apply.",
        },
      ],
    },
    {
      title: "Prototype, test, refine",
      description: "Turn a design into a tested, explainable case study.",
      topics: ["Prototyping", "Usability testing", "Iteration"],
      takeaways: [
        "Choose prototype fidelity based on the question you need to test.",
        "Give participants realistic tasks and observe where they struggle without coaching them through.",
        "Prioritize revisions by evidence and severity, then test whether the change resolves the issue.",
      ],
      example:
        "Ask a participant to find and start their next lesson in a prototype. If several people miss the same action, revise its label or placement and repeat the task with new participants.",
      practice:
        "Write one realistic usability task, a success criterion, and a neutral prompt. Plan how to document observations and decide what to revise.",
      misconception:
        "A usability test is not a sales demonstration. Coaching participants can hide the problems the test should reveal.",
      duration: 180,
      skillKeywords: ["prototyping", "usability", "testing"],
      resource: {
        title: "User research guidance",
        provider: "GOV.UK Service Manual",
        url: "https://www.gov.uk/service-manual/user-research",
      },
      checkpoints: [
        {
          question: "What makes a usability task useful?",
          answer:
            "A realistic goal without instructions that reveal the solution",
          distractors: [
            "A step-by-step tour of the correct clicks",
            "Only asking whether the page is attractive",
            "Telling the participant what to prefer",
          ],
          explanation:
            "A realistic neutral task reveals whether the interface supports independent use.",
        },
        {
          question: "What should follow a design revision?",
          answer: "Check whether it resolves the observed problem",
          distractors: [
            "Assume every change is an improvement",
            "Discard the original evidence",
            "Add unrelated features immediately",
          ],
          explanation:
            "Iteration should close the loop between observed problems, changes, and measured outcomes.",
        },
      ],
    },
  ],
};

export function getModuleContent(id: string): ModuleContent | undefined {
  for (const [track, modules] of Object.entries(MODULE_CONTENT)) {
    const index = modules.findIndex(
      (_, i) => `${track}-${String(i + 1).padStart(2, "0")}` === id,
    );
    if (index >= 0) return modules[index];
  }
  return undefined;
}

function profileHash(profile: LearnerProfile): string {
  const value = JSON.stringify(profile);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

/** Stable curriculum and IDs for a profile; only generatedAt reflects request time. */
export function createMockPlan(profile: LearnerProfile): StudyPlan {
  const priorKnowledge =
    `${profile.skills.join(" ")} ${profile.background} ${profile.experience}`.toLowerCase();
  const modules: Module[] = MODULE_CONTENT[profile.track].map(
    (content, index) => {
      const id = `${profile.track}-${String(index + 1).padStart(2, "0")}`;
      const familiar = content.skillKeywords.some((keyword) =>
        priorKnowledge.includes(keyword),
      );
      return {
        id,
        title: content.title,
        description:
          content.description +
          (familiar
            ? " A shorter review builds on the experience you shared."
            : ""),
        prerequisites:
          index === 0
            ? []
            : [`${profile.track}-${String(index).padStart(2, "0")}`],
        resources: [
          { ...content.resource, id: `${id}-resource`, type: "documentation" },
        ],
        estimatedDuration: Math.round(content.duration * (familiar ? 0.65 : 1)),
        status: index === 0 ? "not-started" : "locked",
        topics: [...content.topics],
      };
    },
  );
  const familiarModules = modules.filter(
    (module, i) =>
      module.estimatedDuration < MODULE_CONTENT[profile.track][i].duration,
  ).length;
  const totalMinutes = modules.reduce(
    (total, module) => total + module.estimatedDuration,
    0,
  );
  const weeks = Math.max(
    1,
    Math.ceil(totalMinutes / (profile.availableStudyTime * 60)),
  );
  const background = profile.background.trim().replace(/[.!?]+$/, "");
  const experience = profile.experience.trim().replace(/[.!?]+$/, "");
  return {
    id: `plan-${profileHash(profile)}`,
    profileId: profile.id,
    title: `Your path to ${TRACK_TITLES[profile.track].toLowerCase()}`,
    summary: `Built around your goal: ${profile.goals.trim()} Your background (${background})${experience ? ` and experience (${experience}) shape` : " shapes"} the starting point. ${familiarModules > 0 ? `${familiarModules} module${familiarModules === 1 ? " includes" : "s include"} a shorter review based on your existing knowledge.` : "Start with the foundations and build toward a practical project."} At ${profile.availableStudyTime} hours a week, plan for about ${weeks} week${weeks === 1 ? "" : "s"}. This is a sample curriculum, not an academic credential or prerequisite assessment.`,
    track: profile.track,
    modules,
    weeklyStudyHours: profile.availableStudyTime,
    generatedAt: new Date().toISOString(),
  };
}

export function createQuestions(
  moduleId: string,
  content: ModuleContent,
): QuizQuestion[] {
  const questions: QuizQuestion[] = content.checkpoints.map(
    (checkpoint, index) => {
      const correctAnswer = (index + 1) % 4;
      const options: string[] = [...checkpoint.distractors];
      options.splice(correctAnswer, 0, checkpoint.answer);
      return {
        id: `${moduleId}-q${index + 1}`,
        question: checkpoint.question,
        options,
        correctAnswer,
        explanation: checkpoint.explanation,
      };
    },
  );
  questions.push({
    id: `${moduleId}-q3`,
    question: `Which approach best demonstrates understanding of ${content.title.toLowerCase()}?`,
    options: [
      "Memorize the title without applying it",
      content.practice,
      "Skip all checks and assume the result is correct",
      "Copy a result without understanding its context",
    ],
    correctAnswer: 1,
    explanation: `Applying the concept to a concrete task helps reveal gaps in understanding. ${content.takeaways[0]}`,
  });
  return questions;
}
