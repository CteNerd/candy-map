import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/getMyClaims.js";

const ddbMock = mockClient(ddbDocClient);

function makeEvent(userId = "resident-1"): APIGatewayProxyEventV2 {
  return {
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
});

describe("getMyClaims handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent(""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("queries gsi1 scoped to the caller's own user id and returns the claims", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ houseId: "house-1", userId: "resident-1", status: "pending" }] });

    const result = (await handler(makeEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);
    expect(body).toHaveLength(1);
    expect(body[0].houseId).toBe("house-1");

    const call = ddbMock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({ ":user": "USER#resident-1" });
  });
});
