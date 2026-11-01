import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/getNeighborhoodHouses.js";
import { getCurrentSeasonId, houseParticipationKey } from "../src/lib/table.js";
import type { CandyParticipation, House } from "@candy-map/shared";
import { houseBlockKey } from "../src/lib/privacy.js";

const ddbMock = mockClient(ddbDocClient);
const seasonId = getCurrentSeasonId();

const PUBLIC_AVAILABLE_HOUSE: House = {
  id: "house-1",
  canonicalAddressKey: "fallback:abc",
  addressDisplayPrivate: "123 Secret St",
  point: { lat: 37.774, lon: -122.43 },
  neighborhoodId: "n1",
  visibility: "public",
  createdAt: "2024-01-01T00:00:00.000Z",
};

const PRIVATE_HOUSE: House = { ...PUBLIC_AVAILABLE_HOUSE, id: "house-2", visibility: "private" };
const PUBLIC_FINISHED_HOUSE: House = { ...PUBLIC_AVAILABLE_HOUSE, id: "house-3" };
const PUBLIC_NO_PARTICIPATION_HOUSE: House = { ...PUBLIC_AVAILABLE_HOUSE, id: "house-4" };

function participationFor(houseId: string, overrides: Partial<CandyParticipation> = {}): CandyParticipation {
  return {
    houseId,
    seasonId,
    status: "available",
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    publicOptIn: true,
    ...overrides,
  };
}

function makeEvent(id?: string): APIGatewayProxyEventV2 {
  return { pathParameters: id ? { id } : undefined } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  ddbMock.reset();
  ddbMock.on(GetCommand).resolves({});
  process.env.TABLE_NAME = "test-table";
});

describe("getNeighborhoodHouses handler", () => {
  it("returns 400 when the neighborhood id path parameter is missing", async () => {
    const result = (await handler(makeEvent(undefined))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it("returns only public, opted-in, active pins — no address or claimant fields", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [PUBLIC_AVAILABLE_HOUSE, PRIVATE_HOUSE, PUBLIC_FINISHED_HOUSE, PUBLIC_NO_PARTICIPATION_HOUSE],
    });
    ddbMock
      .on(GetCommand, { Key: houseParticipationKey("house-1", seasonId) })
      .resolves({ Item: participationFor("house-1") })
      .on(GetCommand, { Key: houseParticipationKey("house-3", seasonId) })
      .resolves({ Item: participationFor("house-3", { status: "finished" }) })
      .on(GetCommand, { Key: houseParticipationKey("house-4", seasonId) })
      .resolves({ Item: undefined });

    const result = (await handler(makeEvent("n1"))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body!);

    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("house-1");
    expect(body[0]).not.toHaveProperty("addressDisplayPrivate");
    expect(body[0]).not.toHaveProperty("canonicalAddressKey");
  });

  it("returns an empty array when a neighborhood has no houses", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const result = (await handler(makeEvent("n-empty"))) as APIGatewayProxyStructuredResultV2;
    expect(JSON.parse(result.body!)).toEqual([]);
  });
  it("suppresses blocked houses even on the legacy public route", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [PUBLIC_AVAILABLE_HOUSE] });
    ddbMock.on(GetCommand, { Key: houseBlockKey("house-1") }).resolves({ Item: { blocked: true } });
    ddbMock.on(GetCommand, { Key: houseParticipationKey("house-1", seasonId) }).resolves({ Item: participationFor("house-1") });
    const result = await handler(makeEvent("n1")) as APIGatewayProxyStructuredResultV2;
    expect(JSON.parse(result.body!)).toEqual([]);
    expect(result.headers?.["Cache-Control"]).toBe("no-store");
  });
});
