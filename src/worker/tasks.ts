import type { AddJobFunction, TaskList } from "graphile-worker";
import { z } from "zod";
import type { NipIndexer } from "../server/indexer";
import { nipCoordinateSchema } from "../server/types";

export const INDEX_NIP_COORDINATE_TASK = "index_nip_coordinate";
export const NIGHTLY_NIP_INDEX_TASK = "nightly_nip_index";

const coordinatePayloadSchema = z.object({ coordinate: nipCoordinateSchema });

export function createTaskList(indexer: NipIndexer): TaskList {
  return {
    [INDEX_NIP_COORDINATE_TASK]: async (rawPayload) => {
      const { coordinate } = coordinatePayloadSchema.parse(rawPayload);
      await indexer.indexCoordinate(coordinate);
      await indexer.settleLazyRequest(coordinate);
    },
    [NIGHTLY_NIP_INDEX_TASK]: async () => {
      await indexer.nightly();
    },
  };
}

export interface JobAdder {
  addJob: AddJobFunction;
}

export function enqueueCoordinateIndex(worker: JobAdder, coordinate: string): Promise<unknown> {
  const validated = nipCoordinateSchema.parse(coordinate);
  return worker.addJob(
    INDEX_NIP_COORDINATE_TASK,
    { coordinate: validated },
    {
      jobKey: `nip:${validated}`,
      maxAttempts: 5,
    },
  );
}
