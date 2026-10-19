import { makeWorkerUtils, type WorkerUtils } from "graphile-worker";
import { getServerEnv } from "./env";
import { enqueueCoordinateIndex } from "../worker/tasks";
import {
  countAdmittedNips,
  getIndexedNip,
  reserveLazyIndexRequest,
} from "./repository";

let workerUtilsPromise: Promise<WorkerUtils> | undefined;

async function getWorkerUtils(): Promise<WorkerUtils> {
  workerUtilsPromise ??= makeWorkerUtils({
    connectionString: getServerEnv().DATABASE_URL,
  });
  return workerUtilsPromise;
}

export async function enqueueNipCoordinate(coordinate: string): Promise<void> {
  await enqueueCoordinateIndex(await getWorkerUtils(), coordinate);
}

export async function enqueueNipCoordinateIfCapacity(coordinate: string): Promise<boolean> {
  const env = getServerEnv();
  const state = await getIndexedNip(coordinate);
  if (state.status === "active") return false;
  if (state.status === "missing" && (await countAdmittedNips()) >= env.MAX_INDEXED_NIPS) {
    return false;
  }
  const reserved = await reserveLazyIndexRequest(
    coordinate,
    env.MAX_PENDING_INDEX_JOBS,
    env.LAZY_INDEX_COOLDOWN_MINUTES,
  );
  if (!reserved) return false;
  await enqueueNipCoordinate(coordinate);
  return true;
}
