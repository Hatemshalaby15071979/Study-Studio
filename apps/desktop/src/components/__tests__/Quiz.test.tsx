import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';
import Quiz from '@/components/Quiz';
import { evaluateQuiz } from '@/lib/api';
import { registerQuiz, submitAnswer } from '@/lib/coreClient';

jest.mock('@/lib/api', () => ({
  evaluateQuiz: jest.fn(),
}));

jest.mock('@/lib/coreClient', () => ({
  registerQuiz: jest.fn(),
  submitAnswer: jest.fn(),
}));

const mockQuestions = [
  {
    question: 'What is the capital of France?',
    options: ['Paris', 'London', 'Berlin', 'Madrid'],
    correctIndex: 0,
    explanation: 'Paris is the capital of France.'
  },
  {
    question: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Jupiter', 'Venus'],
    correctIndex: 1,
    explanation: 'Mars is known as the Red Planet.'
  }
];

const renderQuiz = () => {
  return render(
    <ThemeProvider>
      <Quiz
        questions={mockQuestions}
        difficulty="intermediate"
        lessonTitle="Test Lesson"
      />
    </ThemeProvider>
  );
};

/** Wait until the core registration has resolved and options are clickable. */
const waitForReady = async () => {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Paris/ })).toBeEnabled();
  });
};

describe('Quiz Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (registerQuiz as jest.Mock).mockResolvedValue({
      quiz_id: 'quiz-1',
      topic: 'Test Lesson',
      title: 'Test Lesson',
      items: mockQuestions.map((q, i) => ({
        item_id: `item-${i}`,
        position: i,
        question: q.question,
        options: q.options,
      })),
    });

    (submitAnswer as jest.Mock).mockImplementation(
      async (_quizId: string, itemId: string, selectedIndex: number) => {
        const index = Number(itemId.split('-')[1]);
        const question = mockQuestions[index];
        return {
          item_id: itemId,
          correct: selectedIndex === question.correctIndex,
          correct_index: question.correctIndex,
          explanation: question.explanation,
        };
      }
    );
  });

  it('renders quiz questions', async () => {
    renderQuiz();
    await waitForReady();

    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('Which planet is known as the Red Planet?')).toBeInTheDocument();
  });

  it('renders answer options', async () => {
    renderQuiz();
    await waitForReady();

    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Mars')).toBeInTheDocument();
    expect(screen.getByText('Jupiter')).toBeInTheDocument();
  });

  it('registers the quiz with the core instead of scoring locally', async () => {
    renderQuiz();
    await waitForReady();

    expect(registerQuiz).toHaveBeenCalledTimes(1);
    expect(registerQuiz).toHaveBeenCalledWith({
      topic: 'Test Lesson',
      title: 'Test Lesson',
      items: mockQuestions.map((q) => ({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      })),
    });
  });

  it('allows selecting an answer', async () => {
    renderQuiz();
    await waitForReady();

    const firstOption = screen.getByRole('button', { name: /Paris/ });
    fireEvent.click(firstOption);

    expect(firstOption).toBeDisabled();
  });

  it('asks the core to score the answer and shows its feedback', async () => {
    renderQuiz();
    await waitForReady();

    fireEvent.click(screen.getByText('Paris'));

    expect(await screen.findByText('✅ Correct!')).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenCalledWith('quiz-1', 'item-0', 0);
  });

  it('calculates score from core responses', async () => {
    renderQuiz();
    await waitForReady();

    fireEvent.click(screen.getByText('Paris'));
    await screen.findByText('✅ Correct!');
    fireEvent.click(screen.getByText('Mars'));

    expect(await screen.findByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('does not offer the dead-end single-answer mode', async () => {
    renderQuiz();
    await waitForReady();

    expect(screen.queryByRole('button', { name: /Single mode/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing 1 of/i)).not.toBeInTheDocument();
  });

  it('always renders all questions so evaluation is reachable', async () => {
    renderQuiz();
    await waitForReady();

    fireEvent.click(screen.getByText('Paris'));
    await screen.findByText('✅ Correct!');
    fireEvent.click(screen.getByText('Mars'));

    expect(await screen.findByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get AI Evaluation/i })).toBeInTheDocument();
  });

  it('surfaces an evaluation error instead of failing silently', async () => {
    (evaluateQuiz as jest.Mock).mockRejectedValue(new Error('Runtime unreachable'));
    renderQuiz();
    await waitForReady();

    fireEvent.click(screen.getByText('Paris'));
    await screen.findByText('✅ Correct!');
    fireEvent.click(screen.getByText('Mars'));
    await screen.findByText('2/2');

    fireEvent.click(screen.getByRole('button', { name: /Get AI Evaluation/i }));

    expect(await screen.findByText(/Runtime unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/correct/)).not.toBeInTheDocument();
  });

  it('reports an unavailable core instead of scoring locally', async () => {
    (registerQuiz as jest.Mock).mockRejectedValue(
      new Error('Scoring service is not reachable. Start Helix Core with `helix-core --port 8765` and try again.')
    );
    renderQuiz();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Scoring service is not reachable/);
    expect(screen.getByRole('button', { name: /Paris/ })).toBeDisabled();
  });
});
