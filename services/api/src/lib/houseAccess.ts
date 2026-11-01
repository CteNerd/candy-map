import { GetCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import type { HouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "./ddb.js";
import { houseClaimKey } from "./table.js";

export interface HouseMember {
  houseId: string; userId: string; role: "manager" | "editor";
  state: "active" | "removed"; eventId?: string; createdAt: string;
}
export const houseMemberKey = (houseId: string, userId: string, eventId?: string) => ({
  pk: `HOUSE#${houseId}`, sk: `MEMBER#${userId}${eventId ? `#${eventId}` : ""}`,
});

type Access = {
  role: "manager" | "editor"; source: "claim" | "membership";
  eventId?: string;
  condition: NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
};

export async function getHouseAccess(tableName: string, houseId: string, userId: string, eventId?: string): Promise<Access | undefined> {
  const [claimResult, memberResult, eventMemberResult] = await Promise.all([
    ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseClaimKey(houseId, userId), ConsistentRead: true })),
    ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseMemberKey(houseId, userId), ConsistentRead: true })),
    eventId ? ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseMemberKey(houseId, userId, eventId), ConsistentRead: true })) : Promise.resolve(undefined),
  ]);
  const claim = claimResult.Item as HouseClaim | undefined;
  if (claim?.status === "approved" && claim.userId === userId) {
    return { role: "manager" as const, source: "claim" as const, condition: {
      ConditionCheck: { TableName: tableName, Key: houseClaimKey(houseId, userId),
        ConditionExpression: "#status = :approved",
        ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":approved": "approved" } },
    } };
  }
  const candidates = [memberResult.Item, eventMemberResult?.Item] as Array<HouseMember | undefined>;
  const valid = candidates.filter((member): member is HouseMember =>
    member?.state === "active" && member.userId === userId && (!member.eventId || member.eventId === eventId));
  const member = valid.find((item) => item.role === "manager") ?? valid[0];
  if (!member) return undefined;
  return { role: member.role, source: "membership" as const, eventId: member.eventId, condition: {
    ConditionCheck: { TableName: tableName, Key: houseMemberKey(houseId, userId, member.eventId),
      ConditionExpression: "#state = :active AND #role = :role AND " + (member.eventId ? "eventId = :edition" : "attribute_not_exists(eventId)"),
      ExpressionAttributeNames: { "#state": "state", "#role": "role" },
      ExpressionAttributeValues: { ":active": "active", ":role": member.role, ...(member.eventId ? { ":edition": member.eventId } : {}) } },
  } };
}
