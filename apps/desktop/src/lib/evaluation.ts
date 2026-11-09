// Shared quiz evaluation orchestration (isomorphic — works in the Tauri
// desktop shell and in a plain browser through the AI Runtime).
//
// Correctness and the score come from Helix Core, never from this module and
// never from the model. The model contributes prose only: feedback and a
// per-question explanation. If the core cannot be reached the evaluation
// fails; there is no client-side scoring fallback.
import { aiRuntime, extractJsonFromResponse, repairJson } from "./ai-runtime";
import type { AIMessage } from "./ai-runtime";
import { getScore, type CoreScore } from "./coreClient";
import { validateEvaluateQuiz } from "./validation";
import { EVALUATION_OUTPUT_JSON_SCHEMA } from "./validation";

export interface QuizSubmission {
  quizId: string;
  questions: {
    question: string;
    options: string[];
    explanation: string;
  }[];
  answers: Record<number, number>;
  difficulty: string;
  lessonTitle: string;
}

export interface EvaluationResult {
  overallScore: number;
  totalQuestions: number;
  correctAnswers: number;
  rating: "excellent" | "good" | "fair" | "needs_review" | "offline";
  feedback: string;
  perQuestion: {
    questionIndex: number;
    userAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
    explanation: string;
  }[];
}

/** A question enriched with the core's authoritative correctness. */
interface PromptQuestion {
  questionIndex: number;
  question: string;
  options: string[];
  userAnswer: number;
  correctAnswer: number;
  userAnswerText: string;
  correctAnswerText: string;
  isCorrect: boolean;
  explanation: string;
}

export async function evaluateQuiz(body: unknown, model?: string): Promise<EvaluationResult> {
  const validated = validateEvaluateQuiz(body) as QuizSubmission;
  const { quizId, questions, difficulty, lessonTitle } = validated;

  // The core is the authority on correctness. A failure here is fatal for the
  // evaluation: the old local-scoring fallback is exactly what this change
  // removes.
  const score = await getScore(quizId);
  const promptQuestions = buildPromptQuestions(score, questions);
  const base = coreResult(score, promptQuestions, localFeedback(score));

  const health = await aiRuntime.health();
  if (!health.available) {
    return {
      ...base,
      rating: "offline",
      feedback:
        "The AI runtime is not running. The score comes from Helix Core; start the runtime for written feedback.",
    };
  }

  // Session model policy: evaluation uses ONLY the model the user selected
  // (the lesson's model). If it isn't available we return the core score with
  // local explanations — we never auto-switch to a different model.
  let modelToUse: string;
  try {
    modelToUse = model ? await aiRuntime.ensureModel(model) : health.recommendedModel;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[evaluation] Model unavailable; using core score with local explanations: ${errMsg}`);
    return withLocalExplanations(base, promptQuestions);
  }

  const { correctAnswers, totalQuestions, overallScore } = base;

  const evaluationPrompt = `You are an expert educational evaluator. A student has completed a quiz on "${lessonTitle}" at ${difficulty || "intermediate"} level.

For each question, evaluate the student's answer and provide detailed, personalized feedback that will genuinely help them improve their understanding.

Quiz Results (${correctAnswers}/${totalQuestions} correct, ${overallScore}%):
${promptQuestions.map((q, i) => `
Question ${i + 1}: "${q.question}"
Options: ${q.options.map((o, j) => `${j}) ${o}`).join(", ")}
Student's answer: ${q.userAnswerText} (option ${q.userAnswer})
Correct answer: ${q.correctAnswerText} (option ${q.correctAnswer})
${q.isCorrect ? "CORRECT" : "INCORRECT - " + q.explanation}
`).join("\n")}

Respond ONLY with valid JSON:
{
  "overallScore": ${overallScore},
  "totalQuestions": ${totalQuestions},
  "correctAnswers": ${correctAnswers},
  "rating": "${ratingFor(overallScore)}",
  "feedback": "A paragraph of personalized educational feedback assessing the student's understanding of the topic, identifying specific knowledge gaps, and recommending what to focus on. Be constructive and specific.",
  "perQuestion": [
    {
      "questionIndex": 0,
      "userAnswer": 0,
      "correctAnswer": 0,
      "isCorrect": true,
      "explanation": "Detailed explanation evaluating the student's answer choice and why it was right or wrong. Provide additional context and learning tips for each question."
    }
  ]
}`;

  const messages: AIMessage[] = [
    {
      role: "system",
      content: "You are an expert educational evaluator. Provide detailed, personalized feedback on quiz answers.",
    },
    { role: "user", content: evaluationPrompt },
  ];

  try {
    const rawContent = await aiRuntime.chat(
      messages,
      { temperature: 0.5, maxTokens: 4096, format: EVALUATION_OUTPUT_JSON_SCHEMA },
      modelToUse
    );
    const jsonStr = extractJsonFromResponse(rawContent);
    let evaluation: Record<string, unknown>;
    try {
      evaluation = JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      evaluation = JSON.parse(repairJson(jsonStr)) as Record<string, unknown>;
    }

    // Rebuild the per-question array from the core's items, not the model's.
    //
    // Two defects lived in the mapping that used to be here. It took its LENGTH
    // from the model — `(evaluation.perQuestion).map(...)` — so a model that
    // returned two entries for a six-question quiz produced a two-entry result,
    // and one that returned eight produced eight, with `questions[6]`
    // undefined and a fabricated `correctAnswer: 0`. And the model's own
    // `explanation` was bound to an unused `_eq` parameter and dropped, even
    // though `EvaluationResult` types it as required — so every per-question
    // explanation the prompt asked for was thrown away and the UI rendered
    // `undefined` after an AI evaluation, while the local paths supplied one.
    //
    // Correctness is also not the model's to decide. The core already scored
    // every item, so the score, the counts, `rating` and `isCorrect` are taken
    // from it. The model contributes exactly what only it can: the prose.
    const modelPerQuestion = Array.isArray(evaluation["perQuestion"])
      ? (evaluation["perQuestion"] as Array<Record<string, unknown>>)
      : [];

    return {
      ...base,
      feedback:
        typeof evaluation["feedback"] === "string" && evaluation["feedback"].trim()
          ? evaluation["feedback"]
          : base.feedback,
      perQuestion: base.perQuestion.map((entry, i) => {
        const modelExplanation = modelPerQuestion[i]?.["explanation"];
        return {
          ...entry,
          // The model's explanation when it wrote one, otherwise the
          // explanation authored with the question — never `undefined`, which
          // is what the old mapping produced for every entry.
          explanation:
            typeof modelExplanation === "string" && modelExplanation.trim()
              ? modelExplanation
              : entry.explanation,
        };
      }),
    };
  } catch (e) {
    const _err = e instanceof Error ? e : new Error(String(e));
    console.warn(`[evaluation] ${modelToUse} failed; using core score with local explanations:`, _err.message);
  }

  return withLocalExplanations(base, promptQuestions);
}

/**
 * The score bands, in one place.
 *
 * The prompt embeds the same thresholds, so a rating computed here matches what
 * the model was asked to produce — but it is computed rather than read out of
 * the response, because the score it derives from is already known.
 */
function ratingFor(score: number): EvaluationResult["rating"] {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "needs_review";
}

/** Enrich the core's items with the option text the prompt needs. */
function buildPromptQuestions(
  score: CoreScore,
  questions: QuizSubmission["questions"]
): PromptQuestion[] {
  return score.items.map((item) => {
    const authored = questions[item.position];
    const options = authored?.options ?? [];
    const userAnswer = item.selected_index ?? -1;
    const correctAnswer = item.correct_index ?? -1;
    return {
      questionIndex: item.position,
      question: item.question || authored?.question || "",
      options,
      userAnswer,
      correctAnswer,
      userAnswerText: userAnswer >= 0 ? options[userAnswer] ?? "Not answered" : "Not answered",
      correctAnswerText: correctAnswer >= 0 ? options[correctAnswer] ?? "" : "",
      isCorrect: item.correct ?? false,
      explanation: item.explanation || authored?.explanation || "",
    };
  });
}

/** The result the core alone can produce: authoritative score, raw explanations. */
function coreResult(score: CoreScore, questions: PromptQuestion[], feedback: string): EvaluationResult {
  return {
    overallScore: score.percentage,
    totalQuestions: score.total,
    correctAnswers: score.correct,
    rating: ratingFor(score.percentage),
    feedback,
    perQuestion: questions.map((q) => ({
      questionIndex: q.questionIndex,
      userAnswer: q.userAnswer,
      correctAnswer: q.correctAnswer,
      isCorrect: q.isCorrect,
      explanation: q.explanation,
    })),
  };
}

function localFeedback(score: CoreScore): string {
  return `You scored ${score.correct} out of ${score.total} (${score.percentage}%). Review the explanations below for each question to improve your understanding.`;
}

/** Add the "Correct! / Incorrect. The correct answer was …" framing. */
function withLocalExplanations(
  result: EvaluationResult,
  questions: PromptQuestion[]
): EvaluationResult {
  return {
    ...result,
    perQuestion: result.perQuestion.map((entry, i) => {
      const q = questions[i];
      return {
        ...entry,
        explanation: entry.isCorrect
          ? `Correct! ${entry.explanation}`
          : `Incorrect. The correct answer was "${q?.correctAnswerText ?? ""}". ${entry.explanation}`,
      };
    }),
  };
}
