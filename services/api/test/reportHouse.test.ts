import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/reportHouse.js";
import { houseKey } from "../src/lib/table.js";

const ddbMock = mockClient(ddbDocClient);

function makeEvent(body: unknown, userId = "visitor-1"): APIGatewayProxyEventV2 {
  return {
    pathParameters: { id: "house-1" },
    body: body ? JSON.stringify(body) : undefined,
    requestContext: userId ? { authorizer: { jwt: { claims: { sub: userId } } } } : {},
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "test-table";
  ddbMock.on(GetCommand, { Key: houseKey("house-1") }).resolves({ Item: { id: "house-1" } });
  ddbMock.on(PutCommand).resolves({});
});

describe("reportHouse handler", () => {
  it("returns 401 when unauthenticated", async () => {
    const result = (await handler(makeEvent({ status: "finished" }, ""))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(401);
  });

  it("returns 400 for an invalid status", async () => {
    const result = (await handler(makeEvent({ status: "nope" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("records the report as pending moderation", async () => {
    const result = (await handler(makeEvent({ status: "finished" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.moderationState).toBe("pending");

    const putCall = ddbMock.commandCalls(PutCommand).find((call) => "moderationState" in (call.args[0].input.Item ?? {}));
    expect(putCall?.args[0].input.Item).toMatchObject({ moderationState: "pending", status: "finished" });
  });

  it("returns 429 once the per-house report rate limit is exhausted", async () => {
    const rateLimitError = new Error("Conditional check failed");
    rateLimitError.name = "ConditionalCheckFailedException";
    ddbMock.on(PutCommand).rejects(rateLimitError);

    const result = (await handler(makeEvent({ status: "finished" }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(429);
  });
});
