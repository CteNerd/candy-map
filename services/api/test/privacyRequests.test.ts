import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { canonicalAddressKey } from "@candy-map/shared";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/privacyRequests.js";
import { houseKeyReservationKey } from "../src/lib/table.js";
import { addressBlockKey, houseBlockKey, privacyRequestKey, isHouseBlocked } from "../src/lib/privacy.js";

const mock = mockClient(ddbDocClient);
const address = { street: "100 Example St", postalCode: "77000", country: "US", mode: "block" };
function event(method = "POST", body: unknown = address, groups: unknown = [], id?: string): APIGatewayProxyEventV2 {
  return { pathParameters: id ? { id } : undefined, body: JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "192.0.2.1" }, authorizer: { jwt: { claims: { sub: "reviewer", "cognito:groups": groups } } } },
  } as unknown as APIGatewayProxyEventV2;
}
async function response(input: APIGatewayProxyEventV2) { return await handler(input) as APIGatewayProxyStructuredResultV2; }
beforeEach(() => {
  process.env.TABLE_NAME = "test-table"; mock.reset();
  mock.on(GetCommand).resolves({}); mock.on(PutCommand).resolves({}); mock.on(TransactWriteCommand).resolves({});
});
describe("privacy requests and durable holds", () => {
  it("lets signed-out visitors request preemptive suppression without disclosing property existence", async () => {
    const input = event();
    const result = await response(input);
    expect(result.statusCode).toBe(201);
    const resultBody = JSON.parse(result.body!);
    expect(Object.keys(resultBody).sort()).toEqual(["id", "state"]);
    const transaction = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(transaction.find((item) => item.Put?.Item?.sk === "BLOCK")?.Put?.Item).toMatchObject({
      ...addressBlockKey(canonicalAddressKey(address)), blocked: true, requestId: resultBody.id,
    });
    expect(transaction.find((item) => item.ConditionCheck)?.ConditionCheck?.ConditionExpression).toBe("attribute_not_exists(pk)");
  });
  it("suppresses an existing canonical house and guards concurrent address resolution", async () => {
    mock.on(GetCommand, { Key: houseKeyReservationKey(canonicalAddressKey(address)) }).resolves({ Item: { houseId: "h1" } });
    expect((await response(event())).statusCode).toBe(201);
    const items = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(items.some((item) => item.Put?.Item?.pk === houseBlockKey("h1").pk && item.Put.Item.blocked)).toBe(true);
    expect(items.find((item) => item.ConditionCheck)?.ConditionCheck?.ExpressionAttributeValues).toEqual({ ":house": "h1" });
  });
  it.each([null, [], {}, { ...address, mode: "invalid" }, { ...address, unit: 123 }, { ...address, message: "a".repeat(1001) }])("rejects invalid input %j", async (body) => {
    expect((await response(event("POST", body))).statusCode).toBe(400);
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it("enforces anonymous request rate limits", async () => {
    mock.on(PutCommand).rejects({ name: "ConditionalCheckFailedException" });
    expect((await response(event())).statusCode).toBe(429);
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it("does not expose private queues or permit review to ordinary users", async () => {
    expect((await response(event("GET"))).statusCode).toBe(403);
    expect((await response(event("PATCH", { decision: "approve", note: "Reviewed" }, [], "r1"))).statusCode).toBe(403);
    expect(mock.commandCalls(QueryCommand)).toHaveLength(0);
  });
  it.each([["privacy-reviewers"], "[privacy-reviewers]", '["privacy-reviewers"]'])("recognizes reviewer claims %j and limits response shape", async (groups) => {
    mock.on(QueryCommand).resolves({ Items: [{ id: "r1", address: "100 Example Street", state: "pending", mode: "block", message: "", createdAt: "now", addressKey: "private" }] });
    const result = await response(event("GET", undefined, groups));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)[0]).not.toHaveProperty("addressKey");
  });
  it("retains rejected holds pending appeal and expires resolved private detail after 90 days", async () => {
    mock.on(GetCommand, { Key: privacyRequestKey("r1") }).resolves({ Item: {
      id: "r1", address: "100 Example Street", addressKey: "a1", houseId: "h1", state: "pending", createdAt: "now",
    } });
    expect((await response(event("PATCH", { decision: "reject", note: "Needs authority review" }, ["privacy-reviewers"], "r1"))).statusCode).toBe(200);
    const items = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    expect(items[0]?.Put?.Item?.ttl).toBeGreaterThan(Date.now() / 1000 + 89 * 86400);
    expect(items.slice(1).every((item) => item.Put?.Item?.blocked === true && !item.Put.Item.ttl)).toBe(true);
  });
  it("requires reviewed authority to release a hold and cannot override a newer request", async () => {
    expect((await response(event("PATCH", { decision: "restore", note: "Reviewed" }, ["privacy-reviewers"], "r1"))).statusCode).toBe(400);
    mock.on(GetCommand, { Key: privacyRequestKey("r1") }).resolves({ Item: { id: "r1", addressKey: "a1", state: "approved" } });
    mock.on(TransactWriteCommand).rejects({ name: "TransactionCanceledException" });
    expect((await response(event("PATCH", { decision: "restore", note: "Reviewed", authorityConfirmed: true }, ["privacy-reviewers"], "r1"))).statusCode).toBe(409);
  });
  it("uses strongly consistent suppression reads and surfaces read failures", async () => {
    mock.on(GetCommand, { Key: houseBlockKey("h1") }).resolves({ Item: { blocked: true } });
    expect(await isHouseBlocked("test-table", { id: "h1", canonicalAddressKey: "a1" })).toBe(true);
    expect(mock.commandCalls(GetCommand).every((call) => call.args[0].input.ConsistentRead)).toBe(true);
    mock.on(GetCommand).rejects(new Error("Database down"));
    await expect(isHouseBlocked("test-table", { id: "h1", canonicalAddressKey: "a1" })).rejects.toThrow("Database down");
  });
});
