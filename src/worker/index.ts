import { run } from "graphile-worker";
import type { NipIndexer } from "../server/indexer";
import { createTaskList, NIGHTLY_NIP_INDEX_TASK } from "./tasks";

export function nightlyCrontab(schedule: string): string {
  return `${schedule} ${NIGHTLY_NIP_INDEX_TASK} ?queue=nip-nightly&jobKey=nip-nightly`;
}

export const DEFAULT_WORKER_CRONTAB = nightlyCrontab("0 3 * * *");

export interface RunIndexWorkerOptions {
  connectionString: string;
  indexer: NipIndexer;
  concurrency?: number;
  pollInterval?: number;
  noHandleSignals?: boolean;
  crontab?: string;
}

/** Starts Graphile Worker; the caller retains the returned runner for shutdown. */
export function runIndexWorker(options: RunIndexWorkerOptions) {
  return run({
    connectionString: options.connectionString,
    concurrency: options.concurrency ?? 4,
    pollInterval: options.pollInterval ?? 1_000,
    noHandleSignals: options.noHandleSignals,
    taskList: createTaskList(options.indexer),
    crontab: options.crontab ?? DEFAULT_WORKER_CRONTAB,
  });
}

export {
  createTaskList,
  enqueueCoordinateIndex,
  INDEX_NIP_COORDINATE_TASK,
  NIGHTLY_NIP_INDEX_TASK,
  type JobAdder,
} from "./tasks";
