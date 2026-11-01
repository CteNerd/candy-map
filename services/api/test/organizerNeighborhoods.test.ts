import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/organizerNeighborhoods.js";
import { neighborhoodKey, neighborhoodMembershipKey } from "../src/lib/table.js";
const mock = mockClient(ddbDocClient);
const neighborhood = { id: "n1", name: "Lakes of Example", normalizedName: "lakes of example", organizerIds: ["organizer"], polygon: { type: "Polygon", coordinates: [] } };
function event(routeKey = "PATCH /neighborhoods/{id}", body: unknown = { name: "Lakes of Example - North" }, user = "organizer"): APIGatewayProxyEventV2 {
  return { routeKey, pathParameters: { id: "n1" }, body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: user } } } },
  } as unknown as APIGatewayProxyEventV2;
}
async function response(input: APIGatewayProxyEventV2) { return await handler(input) as APIGatewayProxyStructuredResultV2; }
beforeEach(() => {
  process.env.TABLE_NAME = "test-table"; mock.reset();
  mock.on(GetCommand).resolves({});
  mock.on(GetCommand, { Key: neighborhoodKey("n1") }).resolves({ Item: { ...neighborhoodKey("n1"), ...neighborhood } });
  mock.on(GetCommand, { Key: neighborhoodMembershipKey("n1", "organizer") }).resolves({ Item: { role: "organizer", state: "active" } });
  mock.on(TransactWriteCommand).resolves({});
});
describe("organizer neighborhood names and worklists", () => {
  it("renames the same neighborhood and preserves its other fields", async () => {
    const result = await response(event());
    expect(result.statusCode).toBe(200);
    const put = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems?.find((item) => item.Put)?.Put;
    expect(put?.Item).toMatchObject({ ...neighborhood, name: "Lakes of Example - North", normalizedName: "lakes of example - north" });
    expect(put?.ConditionExpression).toBe("#name = :old");
    expect(JSON.parse(result.body!)).not.toHaveProperty("organizerIds");
  });
  it("rejects unrelated accounts and unauthenticated requests", async () => {
    expect((await response(event(undefined, undefined, "other"))).statusCode).toBe(403);
    expect((await response(event(undefined, undefined, ""))).statusCode).toBe(401);
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it.each([{}, { name: "" }, { name: "a".repeat(121) }, { name: 1 }])("rejects invalid names %j", async (body) => {
    expect((await response(event(undefined, body))).statusCode).toBe(400);
  });
  it("lists only neighborhoods with active organizer authorization and follows pagination", async () => {
    mock.on(ScanCommand).resolvesOnce({ Items: [neighborhood], LastEvaluatedKey: { pk: "cursor", sk: "METADATA" } }).resolves({ Items: [] });
    expect(JSON.parse((await response(event("GET /me/neighborhoods"))).body!)[0].name).toBe(neighborhood.name);
    expect(mock.commandCalls(ScanCommand)).toHaveLength(2);
  });
  it("returns private address labels for organizer claims rather than making users enter IDs", async () => {
    mock.on(QueryCommand).resolvesOnce({ Items: [{ id: "h1", addressDisplayPrivate: "100 Example Street" }] })
      .resolves({ Items: [{ houseId: "h1", userId: "claimant", status: "pending", createdAt: "now" }] });
    const result = await response(event("GET /neighborhoods/{id}/claims"));
    expect(JSON.parse(result.body!)).toEqual([{ claimKey: "h1::claimant", houseLabel: "100 Example Street", status: "pending", createdAt: "now" }]);
  });
});
