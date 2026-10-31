import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDocClient } from "./ddb.js";
import { rateLimitKey } from "./table.js";

/**
 * Per-(user, house, action) rate limiting via a conditional-write TTL window — "Limit report
 * submissions and claim attempts by account, house, and time" (COPILOT_PLAN.md "Security and
 * privacy"). No `dynamodb:DeleteItem` needed: the window just expires via TTL.
 *
 * This is a single-window POC limiter (one slot, no sliding/token-bucket precision) — fine for
 * "one report per house per person every N minutes," not a general-purpose rate limiter.
 */
export async function tryConsumeRateLimit(
  tableName: string,
  action: string,
  userId: string,
  houseId: string,
  windowSeconds: number,
): Promise<boolean> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  try {
    await ddbDocClient.send(
      new PutCommand({
        TableName: tableName,
        Item: { ...rateLimitKey(action, userId, houseId), ttl: nowEpochSeconds + windowSeconds },
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
