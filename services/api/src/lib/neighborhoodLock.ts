import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "./ddb.js";
import { neighborhoodLockKey } from "./table.js";

/**
 * Acquires a short-lived, coarse-grained spatial lock before creating a neighborhood, so two
 * concurrent "create a neighborhood here" requests can't both pass the overlap check and create
 * duplicates. Single-cell POC per COPILOT_PLAN.md ("A single-cell lock is sufficient only for the
 * one-region POC; document multi-cell locking for production" — a polygon spanning multiple grid
 * cells only locks its centroid's cell here, not the full set it touches).
 *
 * Uses a TTL attribute rather than an explicit release/delete, so the Lambda never needs
 * `dynamodb:DeleteItem` — least privilege. The conditional write treats a past-TTL lock as free
 * even if DynamoDB's background TTL sweep hasn't physically removed the item yet.
 */
export async function acquireNeighborhoodLock(
  tableName: string,
  cellId: string,
  ttlSeconds = 30,
): Promise<boolean> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...neighborhoodLockKey(cellId), ttl: nowEpochSeconds + ttlSeconds },
        ConditionExpression: "attribute_not_exists(pk) OR #ttl < :now",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":now": nowEpochSeconds },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One retry after a short, jittered backoff — enough to ride out a near-simultaneous request. */
export async function acquireNeighborhoodLockWithRetry(tableName: string, cellId: string): Promise<boolean> {
  if (await acquireNeighborhoodLock(tableName, cellId)) return true;
  await sleep(200 + Math.random() * 200);
  return acquireNeighborhoodLock(tableName, cellId);
}
