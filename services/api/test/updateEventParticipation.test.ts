import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/updateEventParticipation.js";
import { houseClaimKey, houseEventParticipationKey, houseKey } from "../src/lib/table.js";

const mock = mockClient(ddbDocClient);
function event(body: unknown = { status: "displaying", publicOptIn: true }, eventId = "christmas-lights-2026", userId = "u1"): APIGatewayProxyEventV2 {
  return {
    pathParameters: { id: "h1", eventId }, body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
  } as unknown as APIGatewayProxyEventV2;
}
async function response(input: APIGatewayProxyEventV2) {
  return await handler(input) as APIGatewayProxyStructuredResultV2;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-01T20:00:00Z"));
  process.env.TABLE_NAME = "test-table";
  mock.reset();
  mock.on(GetCommand, { Key: houseKey("h1") }).resolves({ Item: { id: "h1", visibility: "public" } });
  mock.on(GetCommand, { Key: houseClaimKey("h1", "u1") }).resolves({ Item: { houseId: "h1", userId: "u1", status: "approved" } });
  mock.on(PutCommand).resolves({});
});
afterEach(() => vi.useRealTimers());

describe("event participation updates", () => {
  it("writes only the explicit Christmas edition, never the legacy candy key", async () => {
    const result = await response(event());
    expect(result.statusCode).toBe(200);
    expect(mock.commandCalls(PutCommand)[0]!.args[0].input.Item).toMatchObject({
      ...houseEventParticipationKey("h1", "christmas-lights-2026"), publicOptIn: true, expiresAt: "2027-01-07T06:00:00.000Z",
    });
  });
  it.each([null, [], { status: "available", publicOptIn: true }, { status: "displaying" }, { status: "displaying", publicOptIn: "true" }])("rejects invalid input %j", async (body) => {
    expect((await response(event(body))).statusCode).toBe(400);
    expect(mock.commandCalls(PutCommand)).toHaveLength(0);
  });
  it("rejects invalid editions and past editions", async () => {
    expect((await response(event(undefined, ""))).statusCode).toBe(400);
    expect((await response(event({ status: "available", publicOptIn: true }, "halloween-2026"))).statusCode).toBe(409);
  });
  it("requires sign-in and property-specific approval, not neighborhood organizer access", async () => {
    expect((await response(event(undefined, undefined, ""))).statusCode).toBe(401);
    mock.on(GetCommand, { Key: houseClaimKey("h1", "u1") }).resolves({});
    expect((await response(event())).statusCode).toBe(403);
    expect(mock.commandCalls(PutCommand)).toHaveLength(0);
  });
  it("does not allow publication of a private house but permits a private saved update", async () => {
    mock.on(GetCommand, { Key: houseKey("h1") }).resolves({ Item: { id: "h1", visibility: "private" } });
    expect((await response(event())).statusCode).toBe(409);
    expect((await response(event({ status: "displaying", publicOptIn: false }))).statusCode).toBe(200);
  });
  it("surfaces database write failures", async () => {
    mock.on(PutCommand).rejects(new Error("Write failed"));
    await expect(handler(event())).rejects.toThrow("Write failed");
  });
});
