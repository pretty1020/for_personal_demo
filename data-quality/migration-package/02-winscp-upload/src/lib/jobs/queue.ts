import { recoverStuckValidatingFile } from "@/lib/services/validation-recovery";
import { isVercelRuntime } from "@/lib/storage";

type Job = () => Promise<void>;

const queue: Job[] = [];
let active = false;

async function drain() {
  if (active) return;
  active = true;
  while (queue.length) {
    const job = queue.shift();
    if (job) {
      try {
        await job();
      } catch (e) {
        console.error("[job-queue]", e);
      }
    }
  }
  active = false;
}

function wrapRunner(fileId: string, runner: (id: string) => Promise<void>): Job {
  return async () => {
    try {
      await runner(fileId);
    } catch (e) {
      console.error("[job-queue]", e);
      try {
        await recoverStuckValidatingFile(fileId, e);
      } catch (r) {
        console.error("[job-queue] recover failed", r);
      }
    }
  };
}

/** @deprecated Use scheduleValidationJob for Vercel-safe scheduling. */
export function enqueueValidationJob(fileId: string, runner: (id: string) => Promise<void>) {
  queue.push(wrapRunner(fileId, runner));
  void drain();
}

export function scheduleValidationJob(fileId: string, runner: (id: string) => Promise<void>) {
  const job = wrapRunner(fileId, runner);

  if (isVercelRuntime()) {
    void import("@vercel/functions")
      .then(({ waitUntil }) => waitUntil(job()))
      .catch(() => void job());
    return;
  }

  queue.push(job);
  void drain();
}
