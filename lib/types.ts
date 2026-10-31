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
  /** Zero-based index into options. Client-visible in mock mode only. */
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
  quizResults: Record<string, QuizResult>;
}
