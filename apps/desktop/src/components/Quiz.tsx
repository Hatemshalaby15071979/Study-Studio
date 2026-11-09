"use client";

import { useEffect, useRef, useState } from "react";
import { QuizQuestion, QuizEvaluation } from "@/types";
import { evaluateQuiz } from "@/lib/api";
import {
  registerQuiz,
  submitAnswer,
  type CoreAnswerResult,
} from "@/lib/coreClient";

interface Props {
  questions: QuizQuestion[];
  difficulty?: string;
  lessonTitle?: string;
  model?: string;
  onEvaluationComplete?: (evaluation: QuizEvaluation) => void;
}

export default function Quiz({ questions, difficulty, lessonTitle, model, onEvaluationComplete }: Props) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, CoreAnswerResult>>({});
  const [animatingIndex, setAnimatingIndex] = useState<number | null>(null);
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<QuizEvaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Registration runs once per lesson. The ref keeps the effect from
  // re-firing when the parent re-renders with a new array identity, and
  // from registering twice under React StrictMode's double-invoked effect.
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const registrationRef = useRef<{ key: string; promise: ReturnType<typeof registerQuiz> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = lessonTitle || "lesson";
    setQuizId(null);
    setItemIds([]);
    setResults({});
    setAnswers({});
    setSubmitted({});
    setCoreError(null);

    if (!registrationRef.current || registrationRef.current.key !== key) {
      registrationRef.current = {
        key,
        promise: registerQuiz({
          topic: key,
          title: lessonTitle,
          items: questionsRef.current.map((q) => ({
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
          })),
        }),
      };
    }

    registrationRef.current.promise
      .then((quiz) => {
        if (cancelled) return;
        setQuizId(quiz.quiz_id);
        setItemIds(quiz.items.map((item) => item.item_id));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCoreError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [lessonTitle]);

  const handleAnswer = async (qIndex: number, optionIndex: number) => {
    if (submitted[qIndex] || !quizId || !itemIds[qIndex] || coreError) return;

    setAnimatingIndex(qIndex);
    setAnswers((prev) => ({ ...prev, [qIndex]: optionIndex }));
    setSubmitted((prev) => ({ ...prev, [qIndex]: true }));
    setPendingIndex(qIndex);

    try {
      const result = await submitAnswer(quizId, itemIds[qIndex], optionIndex);
      setResults((prev) => ({ ...prev, [qIndex]: result }));
    } catch (error) {
      // The core refused or disappeared: undo the submission so the
      // learner can retry once the service is back.
      setCoreError(error instanceof Error ? error.message : String(error));
      setSubmitted((prev) => ({ ...prev, [qIndex]: false }));
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[qIndex];
        return next;
      });
    } finally {
      setPendingIndex(null);
      setTimeout(() => setAnimatingIndex(null), 400);
    }
  };

  const calculateScore = () => Object.values(results).filter((result) => result.correct).length;

  const handleEvaluateAll = async () => {
    if (!allAnswered) return;
    setEvaluating(true);
    setEvalError(null);
    try {
      const data = await evaluateQuiz({
        questions,
        answers,
        difficulty: difficulty || "intermediate",
        lessonTitle: lessonTitle || "Untitled",
      }, model);
      const evaluationResult: QuizEvaluation = data as QuizEvaluation;
      setEvaluation(evaluationResult);
      if (onEvaluationComplete) onEvaluationComplete(evaluationResult);
    } catch (e) {
      console.error("Evaluation error:", e);
      setEvalError(e instanceof Error ? e.message : "Evaluation failed. Check that the AI runtime is running.");
    } finally {
      setEvaluating(false);
    }
  };

  const handleRetry = () => {
    setAnswers({});
    setSubmitted({});
    setResults({});
    setEvaluation(null);
    setEvalError(null);
  };

  const score = calculateScore();
  const total = questions.length;
  const allAnswered = total > 0 && questions.every((_, i) => results[i] !== undefined);
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;
  const scoringUnavailable = Boolean(coreError);

  return (
    <div className="card mb-6 animate-scale-in" id="quiz">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <span className="text-xl">✍️</span>
          <h2 className="text-xl font-semibold">Quiz</h2>
          {allAnswered && !evaluation && (
            <span className="badge" style={{background: percentage >= 80 ? 'rgba(34,197,94,0.1)' : percentage >= 50 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: percentage >= 80 ? 'var(--accent-green)' : percentage >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)'}}>
              {percentage}%
            </span>
          )}
          {evaluation && (
            <span className="badge" style={{background: evaluation.overallScore >= 80 ? 'rgba(34,197,94,0.1)' : evaluation.overallScore >= 50 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)', color: evaluation.overallScore >= 80 ? 'var(--accent-green)' : evaluation.overallScore >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)'}}>
              {evaluation.overallScore}%
            </span>
          )}
        </div>
      </div>

      {scoringUnavailable && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800/40 dark:bg-red-900/10 dark:text-red-300" role="alert">
          ⚠️ {coreError}
        </div>
      )}

      {!quizId && !scoringUnavailable && (
        <p className="mb-5 text-sm text-muted">Connecting to the scoring service…</p>
      )}

      {allAnswered && !evaluation && (
        <div className="p-5 rounded-xl mb-5 text-center bg-gradient-to-br from-primary-soft to-transparent dark:from-primary-soft/30 border border-primary/10 animate-scale-in">
          <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
            {score}/{total}
          </div>
          <div className="text-sm text-muted mt-1 mb-3">
            {percentage >= 80 ? "🎉 All done!" : percentage >= 50 ? "💪 Good attempt!" : "📖 Review and try again"}
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={handleEvaluateAll}
              disabled={evaluating}
              className="btn btn-primary text-sm"
            >
              {evaluating ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Evaluating...
                </span>
              ) : "📊 Get AI Evaluation"}
            </button>
            <button onClick={handleRetry} className="btn btn-ghost text-sm">🔄 Retry</button>
          </div>
          {evalError && (
            <div className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
              ⚠️ {evalError}
            </div>
          )}
        </div>
      )}

      {evaluation && (
        <div className="p-5 rounded-xl mb-5 border animate-scale-in" style={{borderColor: 'var(--primary)'}}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-3xl font-bold bg-gradient-to-r from-primary to-accent-blue bg-clip-text text-transparent">
                {evaluation.overallScore}%
              </div>
              <div className="text-xs text-muted mt-0.5">
                {evaluation.correctAnswers}/{evaluation.totalQuestions} correct
                <span className="ml-2">
                  {evaluation.rating === "excellent" ? "🌟 Excellent" : evaluation.rating === "good" ? "👍 Good" : evaluation.rating === "fair" ? "📖 Fair" : "🔁 Needs Review"}
                </span>
              </div>
            </div>
            <button onClick={handleRetry} className="btn btn-ghost text-xs">🔄 Retry</button>
          </div>
          {evaluation.feedback && (
            <p className="text-sm text-foreground/80 leading-relaxed p-3 rounded-lg bg-sidebar">
              {evaluation.feedback}
            </p>
          )}
        </div>
      )}

      <div className="space-y-5">
        {questions.map((q, qIndex) => {
          const globalIndex = qIndex;
          const selected = answers[globalIndex];
          const result = results[globalIndex];
          const isSubmitted = submitted[globalIndex];
          const isPending = pendingIndex === globalIndex;
          const isCorrect = result?.correct === true;
          const correctIndex = result?.correct_index;
          const isAnimating = animatingIndex === globalIndex;

          const evalQuestion = evaluation?.perQuestion?.find((eq) => eq.questionIndex === globalIndex);

          return (
            <div
              key={globalIndex}
              className={`border border-card-border rounded-xl p-4 transition-all duration-300 ${
                isAnimating ? "scale-[1.02] shadow-md" : ""
              } ${isSubmitted ? "bg-primary-soft/20 dark:bg-primary-soft/10" : ""} ${
                evalQuestion ? (evalQuestion.isCorrect ? "border-green-200 dark:border-green-800/30" : "border-amber-200 dark:border-amber-800/30") : ""
              }`}
            >
              <p className="font-medium mb-3 flex items-start gap-2">
                <span className="flex-shrink-0 w-6 h-6 rounded-md bg-primary-soft dark:bg-opacity-20 flex items-center justify-center text-primary text-xs font-bold mt-0.5">
                  {globalIndex + 1}
                </span>
                <span>{q.question}</span>
              </p>
              <div className="space-y-2 ml-8">
                {q.options.map((opt, oIndex) => {
                  let optionClass = "w-full text-left p-3 rounded-xl border transition-all duration-200 text-sm flex items-center gap-3 ";

                  if (result) {
                    if (oIndex === correctIndex) {
                      optionClass += "border-accent-green bg-green-50 dark:bg-green-900/20 text-accent-green font-medium";
                    } else if (oIndex === selected && !isCorrect) {
                      optionClass += "border-accent-red bg-red-50 dark:bg-red-900/20 text-accent-red";
                    } else {
                      optionClass += "border-card-border opacity-50";
                    }
                  } else if (isPending) {
                    optionClass += "border-card-border opacity-50";
                  } else {
                    optionClass += "border-card-border hover:border-primary hover:bg-primary-soft/50 cursor-pointer";
                  }

                  return (
                    <button
                      key={oIndex}
                      onClick={() => handleAnswer(globalIndex, oIndex)}
                      disabled={isSubmitted || !quizId || scoringUnavailable}
                      className={optionClass}
                    >
                      <span className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
                        result && oIndex === correctIndex
                          ? "bg-green-500 text-white"
                          : result && oIndex === selected && !isCorrect
                          ? "bg-red-500 text-white"
                          : "bg-sidebar text-muted"
                      }`}>
                        {result && oIndex === correctIndex ? "✓" : result && oIndex === selected && !isCorrect ? "✗" : String.fromCharCode(65 + oIndex)}
                      </span>
                      <span className="flex-1">{opt}</span>
                    </button>
                  );
                })}
              </div>
              {isPending && (
                <div className="mt-2 ml-8 text-xs text-muted animate-fade-in">Checking answer…</div>
              )}
              {result && (
                <div className={`mt-2 ml-8 text-xs p-2.5 rounded-lg ${
                  isCorrect
                    ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800/20"
                    : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/20"
                } animate-fade-in`}>
                  {isCorrect ? "✅ Correct!" : `❌ ${result.explanation || q.explanation}`}
                </div>
              )}
              {evalQuestion && (
                <div className={`mt-2 ml-8 text-xs p-2.5 rounded-lg animate-fade-in ${
                  evalQuestion.isCorrect
                    ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/10"
                    : "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10"
                }`}>
                  {evalQuestion.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
