import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromLegacyCandy } from "@candy-map/shared";
import type { CandyParticipation, EventEdition, EventParticipation } from "@candy-map/shared";
import { ddbDocClient } from "./ddb.js";
import { houseEventParticipationKey, houseParticipationKey } from "./table.js";

export async function readEventParticipation(tableName: string, houseId: string, edition: EventEdition): Promise<EventParticipation | undefined> {
  const result = await ddbDocClient.send(new GetCommand({
    TableName: tableName, Key: houseEventParticipationKey(houseId, edition.id), ConsistentRead: true,
  }));
  const item = result.Item as EventParticipation | undefined;
  if (item) {
    return {
      houseId: item.houseId, eventId: item.eventId, status: item.status,
      updatedAt: item.updatedAt, expiresAt: item.expiresAt, publicOptIn: item.publicOptIn,
    };
  }
  // Legacy year keys belong exclusively to Halloween. Never read them for another holiday.
  if (edition.type !== "halloween") return undefined;
  const legacy = await ddbDocClient.send(new GetCommand({
    TableName: tableName, Key: houseParticipationKey(houseId, edition.id.slice(-4)), ConsistentRead: true,
  }));
  const candy = legacy.Item as CandyParticipation | undefined;
  return candy ? fromLegacyCandy(candy, edition) : undefined;
}
