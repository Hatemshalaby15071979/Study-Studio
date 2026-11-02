export type WorkloadState =
  | "queued"
  | "preparing"
  | "running"
  | "unloading"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkloadKind = "text" | "audio" | "model-management";

export interface WorkloadProgress {
  current: number;
  total: number;
  message?: string;
}

export interface WorkloadJob {
  id: string;
  kind: WorkloadKind;
  state: WorkloadState;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  progress?: WorkloadProgress;
  error?: string;
}

export interface WorkloadContext {
  signal: AbortSignal;
  setState(state: "preparing" | "running" | "unloading" | "waiting"): void;
  setProgress(progress: WorkloadProgress): void;
}

type Listener = () => void;

export class WorkloadCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private sequence = 0;
  private jobs: WorkloadJob[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();

  getSnapshot = (): readonly WorkloadJob[] => this.jobs;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  cancel(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort(new Error("Workload cancelled by the user."));
    return true;
  }

  run<T>(
    kind: WorkloadKind,
    operation: (context: WorkloadContext) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const id = `workload-${Date.now()}-${++this.sequence}`;
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const now = new Date().toISOString();
    const job: WorkloadJob = {
      id,
      kind,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.controllers.set(id, controller);
    this.update(job);

    const run = this.queue.then(() => this.execute(job, controller, operation));
    this.queue = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(id);
    });
  }

  runStream<T>(
    kind: WorkloadKind,
    operation: (context: WorkloadContext) => AsyncIterable<T>,
    signal?: AbortSignal
  ): AsyncIterable<T> {
    let started = false;
    return {
      [Symbol.asyncIterator]: () => {
        if (started) throw new Error("A coordinated stream can only be consumed once.");
        started = true;

        const controller = new AbortController();
        const onAbort = () => controller.abort(signal?.reason);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });

        const buffered: T[] = [];
        const waiters: (() => void)[] = [];
        let complete = false;
        let failure: unknown;
        const wake = () => {
          for (const resolve of waiters.splice(0)) resolve();
        };
        const task = this.run(
          kind,
          async (context) => {
            for await (const value of operation(context)) {
              if (context.signal.aborted) throw context.signal.reason;
              buffered.push(value);
              wake();
            }
          },
          controller.signal
        );
        void task.then(
          () => {
            complete = true;
            wake();
          },
          (error: unknown) => {
            failure = error;
            complete = true;
            wake();
          }
        ).finally(() => signal?.removeEventListener("abort", onAbort));

        return {
          next: async (): Promise<IteratorResult<T>> => {
            while (buffered.length === 0 && !complete) {
              await new Promise<void>((resolve) => waiters.push(resolve));
            }
            if (buffered.length > 0) {
              return { done: false, value: buffered.shift()! };
            }
            if (failure !== undefined) throw failure;
            return { done: true, value: undefined };
          },
          return: async (): Promise<IteratorResult<T>> => {
            controller.abort(new Error("Workload stream closed by its consumer."));
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  private async execute<T>(
    job: WorkloadJob,
    controller: AbortController,
    operation: (context: WorkloadContext) => Promise<T>
  ): Promise<T> {
    if (controller.signal.aborted) {
      this.finish(job, "cancelled");
      throw this.abortError(controller.signal);
    }

    this.update({ ...job, state: "preparing", startedAt: new Date().toISOString() });
    const context: WorkloadContext = {
      signal: controller.signal,
      setState: (state) => this.update({ ...this.find(job.id), state }),
      setProgress: (progress) => {
        if (
          !Number.isFinite(progress.current) ||
          !Number.isFinite(progress.total) ||
          progress.total < 0
        ) {
          throw new Error("Workload progress must contain finite values and a nonnegative total.");
        }
        this.update({ ...this.find(job.id), progress: { ...progress } });
      },
    };

    try {
      context.setState("running");
      const result = await operation(context);
      if (controller.signal.aborted) throw this.abortError(controller.signal);
      this.finish(job, "completed");
      return result;
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        this.finish(job, "cancelled");
        throw this.abortError(controller.signal);
      }
      this.finish(job, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private abortError(signal: AbortSignal): Error {
    const error = signal.reason instanceof Error
      ? signal.reason
      : new Error("Workload cancelled.");
    error.name = "AbortError";
    return error;
  }

  private finish(job: WorkloadJob, state: "completed" | "failed" | "cancelled", error?: string): void {
    const current = this.find(job.id);
    this.update({
      ...current,
      state,
      completedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    });
  }

  private find(id: string): WorkloadJob {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job) throw new Error(`Unknown workload job "${id}".`);
    return job;
  }

  private update(job: WorkloadJob): void {
    const updated = {
      ...job,
      updatedAt: new Date().toISOString(),
    };
    const index = this.jobs.findIndex((candidate) => candidate.id === job.id);
    if (index === -1) this.jobs = [...this.jobs, updated].slice(-30);
    else this.jobs = this.jobs.map((candidate, candidateIndex) => (
      candidateIndex === index ? updated : candidate
    ));
    for (const listener of this.listeners) listener();
  }
}

export const workloadCoordinator = new WorkloadCoordinator();
