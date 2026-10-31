import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { NeighborhoodMembership } from "@candy-map/shared";
import { ddbDocClient } from "./ddb.js";
import { neighborhoodMembershipKey } from "./table.js";

/** True if `userId` has an active organizer membership for `neighborhoodId`. */
export async function isActiveOrganizer(
  tableName: string,
  neighborhoodId: string,
  userId: string,
): Promise<boolean> {
  const result = await ddbDocClient.send(
    new GetCommand({ TableName: tableName, Key: neighborhoodMembershipKey(neighborhoodId, userId) }),
  );
  const membership = result.Item as NeighborhoodMembership | undefined;
  return membership?.role === "organizer" && membership.state === "active";
}
