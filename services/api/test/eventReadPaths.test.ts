import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler as publicHandler } from "../src/handlers/getNeighborhoodHouses.js";
import { handler as claimsHandler } from "../src/handlers/getMyClaims.js";
import { houseEventParticipationKey, houseParticipationKey } from "../src/lib/table.js";
const mock = mockClient(ddbDocClient);
const house = { id: "h1", visibility: "public", point: { lat: 1, lon: 2 }, addressDisplayPrivate: "private address" };
function event(eventId: string): APIGatewayProxyEventV2 {
  return {
    pathParameters: { id: "n1" }, queryStringParameters: { eventId },
    requestContext: { authorizer: { jwt: { claims: { sub: "u1" } } } },
  } as unknown as APIGatewayProxyEventV2;
}
async function body(handler: typeof publicHandler, eventId: string) {
  const result = await handler(event(eventId)) as APIGatewayProxyStructuredResultV2;
  expect(result.statusCode).toBe(200);
  return JSON.parse(result.body!);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-01T20:00:00Z"));
  process.env.TABLE_NAME = "test-table";
  mock.reset();
  mock.on(GetCommand).resolves({});
});
afterEach(() => vi.useRealTimers());
describe("explicit edition read paths", () => {
  it("never reads Halloween keys when Christmas has no participation", async () => {
    mock.on(QueryCommand).resolves({ Items: [house] });
    mock.on(GetCommand, { Key: houseParticipationKey("h1", "2026") }).resolves({ Item: { status: "available", publicOptIn: true } });
    expect(await body(publicHandler, "christmas-lights-2026")).toEqual([]);
    expect(mock.commandCalls(GetCommand)).toHaveLength(1);
    expect(mock.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual(houseEventParticipationKey("h1", "christmas-lights-2026"));
  });
  it("returns only the Christmas public projection with an edition-specific identifier", async () => {
    mock.on(QueryCommand).resolves({ Items: [house] });
    mock.on(GetCommand).resolves({ Item: {
      houseId: "h1", eventId: "christmas-lights-2026", status: "displaying", publicOptIn: true,
      updatedAt: "now", expiresAt: "2027-01-07T06:00:00Z", reporterId: "private",
    } });
    const pins = await body(publicHandler, "christmas-lights-2026");
    expect(pins).toHaveLength(1);
    expect(Object.keys(pins[0]).sort()).toEqual(["id", "point", "status", "updatedAt"]);
    expect(pins[0].id).not.toContain("h1");
  });
  it("restores Halloween legacy records privately, even after the event ends", async () => {
    mock.on(QueryCommand).resolves({ Items: [{ houseId: "h1", userId: "u1", status: "approved" }] });
    mock.on(GetCommand, { Key: houseParticipationKey("h1", "2026") }).resolves({ Item: {
      houseId: "h1", seasonId: "2026", status: "finished", expiresAt: "2026-11-01T00:00:00Z", publicOptIn: true, updatedAt: "then",
    } });
    const claims = await body(claimsHandler, "halloween-2026");
    expect(claims[0].eventParticipation).toMatchObject({ eventId: "halloween-2026", status: "finished" });
    expect(claims[0].participation).toBeNull();
  });
  it("rejects unsupported editions without querying houses or claims", async () => {
    for (const handler of [publicHandler, claimsHandler]) {
      expect((await handler(event("bad")) as APIGatewayProxyStructuredResultV2).statusCode).toBe(400);
    }
    expect(mock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
