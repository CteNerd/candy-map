import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { House } from "@candy-map/shared";
import { ddbDocClient } from "./ddb.js";

export const addressBlockKey = (addressKey: string) => ({ pk: `PRIVACY_ADDRESS#${addressKey}`, sk: "BLOCK" });
export const houseBlockKey = (houseId: string) => ({ pk: `PRIVACY_HOUSE#${houseId}`, sk: "BLOCK" });
export const privacyRequestKey = (id: string) => ({ pk: `PRIVACY_REQUEST#${id}`, sk: "REQUEST" });

export async function isHouseBlocked(tableName: string, house: Pick<House, "id" | "canonicalAddressKey">): Promise<boolean> {
  const results = await Promise.all([houseBlockKey(house.id), addressBlockKey(house.canonicalAddressKey)].map((Key) =>
    ddbDocClient.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }))));
  return results.some((result) => result.Item?.blocked === true);
}

export function publicationPrivacyConditions(tableName: string, house: Pick<House, "id" | "canonicalAddressKey">) {
  return [houseBlockKey(house.id), addressBlockKey(house.canonicalAddressKey)].map((Key) => ({
    ConditionCheck: {
      TableName: tableName, Key,
      ConditionExpression: "attribute_not_exists(pk) OR blocked = :no",
      ExpressionAttributeValues: { ":no": false },
    },
  }));
}
