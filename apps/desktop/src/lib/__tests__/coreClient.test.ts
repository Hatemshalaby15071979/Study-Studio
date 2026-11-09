import {
  CoreUnavailableError,
  coreBaseUrl,
  getScore,
  registerQuiz,
  submitAnswer,
} from '@/lib/coreClient';

const fetchMock = jest.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('coreClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    delete process.env['NEXT_PUBLIC_HELIX_CORE_URL'];
    delete process.env['NEXT_PUBLIC_HELIX_CORE_TOKEN'];
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to the local core and honours the env override', () => {
    expect(coreBaseUrl()).toBe('http://127.0.0.1:8765');
    process.env['NEXT_PUBLIC_HELIX_CORE_URL'] = 'http://127.0.0.1:9999/';
    expect(coreBaseUrl()).toBe('http://127.0.0.1:9999');
  });

  it('registers a quiz with snake_case keys and returns public items', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        quiz_id: 'q1',
        topic: 't',
        title: 'T',
        items: [{ item_id: 'i1', position: 0, question: 'Q', options: ['a', 'b'] }],
      })
    );

    const quiz = await registerQuiz({
      topic: 't',
      title: 'T',
      items: [{ question: 'Q', options: ['a', 'b'], correctIndex: 1, explanation: 'why' }],
    });

    expect(quiz.quiz_id).toBe('q1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/quizzes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          topic: 't',
          title: 'T',
          items: [{ question: 'Q', options: ['a', 'b'], correct_index: 1, explanation: 'why' }],
        }),
      })
    );
  });

  it('submits an answer to the item endpoint', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ item_id: 'i1', correct: true, correct_index: 1, explanation: 'why' })
    );

    const result = await submitAnswer('q 1', 'i1', 1);

    expect(result.correct).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8765/v1/quizzes/q%201/answers',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('reads the score summary', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ quiz_id: 'q1', total: 2, answered: 1, correct: 1, percentage: 50, items: [] })
    );

    const score = await getScore('q1');
    expect(score.percentage).toBe(50);
  });

  it('sends a bearer token when configured', async () => {
    process.env['NEXT_PUBLIC_HELIX_CORE_TOKEN'] = 'token-1';
    fetchMock.mockResolvedValue(jsonResponse({ quiz_id: 'q1', total: 0, answered: 0, correct: 0, percentage: 0, items: [] }));

    await getScore('q1');

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('maps a network failure to CoreUnavailableError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getScore('q1')).rejects.toBeInstanceOf(CoreUnavailableError);
    await expect(getScore('q1')).rejects.toThrow(/helix-core --port 8765/);
  });

  it('surfaces the core error detail for a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'sealed key failed verification' }, false, 409));

    await expect(getScore('q1')).rejects.toThrow('sealed key failed verification');
  });
});
