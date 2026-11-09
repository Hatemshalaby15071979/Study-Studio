// Helix Core client.
//
// Quiz scoring is owned by the local Helix Core service, not by this
// client. The UI registers a quiz once, receives public items (no answer
// key, no explanation), and asks the core to score each committed answer.
//
// The core is a separate local process: `helix-core --port 8765`. Point
// the app at it with NEXT_PUBLIC_HELIX_CORE_URL; when the service is not
// running the quiz reports that explicitly instead of silently falling
// back to client-side scoring.

export interface CoreQuizItemInput {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface CorePublicItem {
  item_id: string;
  position: number;
  question: string;
  options: string[];
}

export interface CoreRegisteredQuiz {
  quiz_id: string;
  topic: string;
  title: string | null;
  items: CorePublicItem[];
}

export interface CoreAnswerResult {
  item_id: string;
  correct: boolean;
  correct_index: number;
  explanation: string;
}

export interface CoreItemScore {
  item_id: string;
  position: number;
  question: string;
  answered: boolean;
  selected_index: number | null;
  correct: boolean | null;
  correct_index: number | null;
  explanation: string | null;
}

export interface CoreScore {
  quiz_id: string;
  total: number;
  answered: number;
  correct: number;
  percentage: number;
  items: CoreItemScore[];
}

export class CoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreUnavailableError";
  }
}

const DEFAULT_URL = "http://127.0.0.1:8765";
const REQUEST_TIMEOUT_MS = 10_000;

/** Base URL of the Helix Core service. */
export function coreBaseUrl(): string {
  const configured = process.env["NEXT_PUBLIC_HELIX_CORE_URL"];
  return ((configured && configured.trim()) || DEFAULT_URL).replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env["NEXT_PUBLIC_HELIX_CORE_TOKEN"];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${coreBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
      },
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : "is not reachable";
    throw new CoreUnavailableError(
      `Scoring service ${reason}. Start Helix Core with \`helix-core --port 8765\` and try again.`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = `Scoring service returned HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

/** Register a quiz and receive the public items. */
export async function registerQuiz(input: {
  topic: string;
  title?: string;
  items: CoreQuizItemInput[];
}): Promise<CoreRegisteredQuiz> {
  return request<CoreRegisteredQuiz>("/v1/quizzes", {
    method: "POST",
    body: JSON.stringify({
      topic: input.topic,
      title: input.title ?? null,
      items: input.items.map((item) => ({
        question: item.question,
        options: item.options,
        correct_index: item.correctIndex,
        explanation: item.explanation,
      })),
    }),
  });
}

/** Score one committed answer against the sealed key. */
export async function submitAnswer(
  quizId: string,
  itemId: string,
  selectedIndex: number
): Promise<CoreAnswerResult> {
  return request<CoreAnswerResult>(`/v1/quizzes/${encodeURIComponent(quizId)}/answers`, {
    method: "POST",
    body: JSON.stringify({ item_id: itemId, selected_index: selectedIndex }),
  });
}

/** Read the authoritative score summary for a quiz. */
export async function getScore(quizId: string): Promise<CoreScore> {
  return request<CoreScore>(`/v1/quizzes/${encodeURIComponent(quizId)}/score`);
}
