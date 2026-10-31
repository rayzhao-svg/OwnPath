/** The single source of truth for domain objects and HTTP contracts. */
export type LearningTrack =
  "data-science" | "web-development" | "product-design";
export type ModuleStatus =
  "not-started" | "in-progress" | "completed" | "locked";
export type ResourceType = "article" | "course" | "video" | "documentation";

export interface LearnerProfile {
  id: string;
  name: string;
  background: string;
  experience: string;
  skills: string[];
  goals: string;
  /** Hours per week, from 1 to 40. */
  availableStudyTime: number;
  track: LearningTrack;
}

export interface LearningResource {
  id: string;
  title: string;
  provider: string;
  url: string;
  type: ResourceType;
}

export interface Module {
  id: string;
  title: string;
  description: string;
  prerequisites: string[];
  resources: LearningResource[];
  /** Minutes. */
  estimatedDuration: number;
  status: ModuleStatus;
  topics: string[];
}

export interface StudyPlan {
  id: string;
  profileId: LearnerProfile["id"];
  title: string;
  summary: string;
  track: LearningTrack;
  modules: Module[];
  weeklyStudyHours: number;
  generatedAt: string;
}

export interface Slide {
  id: string;
  title: string;
  bullets: string[];
  narration: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  /** Zero-based index into options. Client-visible for local practice scoring. */
  correctAnswer: number;
  explanation: string;
}

export interface Lesson {
  id: string;
  moduleId: Module["id"];
  title: string;
  slides: Slide[];
  quiz: QuizQuestion[];
}

export interface QuizResult {
  lessonId: Lesson["id"];
  moduleId: Module["id"];
  score: number;
  correctAnswers: number;
  totalQuestions: number;
  passed: boolean;
  completedAt: string;
  /** Optional for compatibility with results saved before adaptive learning. */
  answers?: Record<string, number>;
  missedQuestionIds?: string[];
}

export interface QuizMistake {
  questionId: string;
  selectedAnswer: number;
  concept: string;
  slideId: string;
}

export interface ReviewRequest {
  lesson: Lesson;
  result: QuizResult;
}
export interface RemediationArea {
  questionId: string;
  concept: string;
  slideId: string;
  explanation: string;
  workedExample: string;
  steps: string[];
}
export interface Remediation {
  lessonId: string;
  moduleId: string;
  attemptedAt: string;
  summary: string;
  areas: RemediationArea[];
}
export interface ReviewResponse {
  review: Remediation;
  mode: "mock" | "claude";
  fallbackReason?: "generation-failed";
}
export interface SavedRemediation extends ReviewResponse {
  reviewedAt?: string;
}

export interface TutorMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface PlanRequest {
  profile: LearnerProfile;
}
export interface PlanResponse {
  plan: StudyPlan;
  mode: "mock" | "claude";
}
export interface LessonRequest {
  module: Module;
}
export interface LessonResponse {
  lesson: Lesson;
  mode: "mock" | "claude";
}
export interface ChatRequest {
  lesson: Lesson;
  question: string;
  messages: TutorMessage[];
}
export interface ChatResponse {
  message: TutorMessage;
  mode: "mock" | "claude";
}
export interface ApiError {
  error: {
    code:
      | "INVALID_JSON"
      | "VALIDATION_ERROR"
      | "PAYLOAD_TOO_LARGE"
      | "INTERNAL_ERROR";
    message: string;
  };
}

export interface LearningState {
  version: 1;
  profile: LearnerProfile | null;
  plan: StudyPlan | null;
  lessons: Record<string, Lesson>;
  /** Best result; a later failed practice attempt never removes completion. */
  quizResults: Record<string, QuizResult>;
  latestQuizResults?: Record<string, QuizResult>;
  quizHistory?: Record<string, QuizResult[]>;
  remediations?: Record<string, SavedRemediation>;
  /** Optional metadata keeps older version-1 browser stores compatible. */
  planMode?: PlanResponse["mode"];
  lessonModes?: Record<string, LessonResponse["mode"]>;
  /** Local generation identity, independent of deterministic mock plan IDs. */
  planGeneration?: string;
}
