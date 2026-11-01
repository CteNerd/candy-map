import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ddbDocClient } from "../src/lib/ddb.js";
import { handler } from "../src/handlers/household.js";
import { houseKey, houseClaimKey } from "../src/lib/table.js";
import { houseMemberKey } from "../src/lib/houseAccess.js";
import { houseBlockKey } from "../src/lib/privacy.js";
const mock = mockClient(ddbDocClient), emailMock = mockClient(SESv2Client);
const token = "a".repeat(64), hash = createHash("sha256").update(token).digest("hex");
const invitation = { hash, houseId: "h1", inviterId: "manager", role: "editor", eventId: "christmas-lights-2026", state: "pending", ttl: Math.floor(Date.now() / 1000) + 3600 };
function event(routeKey = "POST /houses/{id}/invitations", body: unknown = { role: "editor", eventId: "christmas-lights-2026" }, user = "manager", email = "helper@example.com"): APIGatewayProxyEventV2 {
  return { routeKey, pathParameters: { id: "h1" }, body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: user, email, email_verified: "true" } } } },
  } as unknown as APIGatewayProxyEventV2;
}
async function response(input: APIGatewayProxyEventV2) { return await handler(input) as APIGatewayProxyStructuredResultV2; }
beforeEach(() => {
  process.env.TABLE_NAME = "test-table"; process.env.ALLOWED_ORIGIN = "https://example.com"; process.env.INVITATION_SENDER = "sender@example.com";
  mock.reset(); emailMock.reset();
  mock.on(GetCommand).resolves({}); mock.on(PutCommand).resolves({}); mock.on(TransactWriteCommand).resolves({});
  mock.on(GetCommand, { Key: houseKey("h1") }).resolves({ Item: { id: "h1", canonicalAddressKey: "a1", addressDisplayPrivate: "100 Example Street", visibility: "public" } });
  mock.on(GetCommand, { Key: houseClaimKey("h1", "manager") }).resolves({ Item: { userId: "manager", status: "approved" } });
  emailMock.on(SendEmailCommand).resolves({ MessageId: "sent" });
});
describe("house-specific invitations and requests", () => {
  it("creates a 48-hour single-use fragment link and stores only its hash", async () => {
    const result = await response(event());
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body!);
    expect(body.link).toMatch(/^https:\/\/example.com\/invite#[a-f0-9]{64}$/);
    const items = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    const stored = items.find((item) => item.Put?.Item?.sk === "INVITE")?.Put?.Item;
    expect(stored?.eventId).toBe("christmas-lights-2026");
    expect(stored?.ttl).toBeLessThanOrEqual(Date.now() / 1000 + 48 * 3600);
    expect(JSON.stringify(items)).not.toContain(body.link.split("#")[1]);
    expect(emailMock.commandCalls(SendEmailCommand)).toHaveLength(0);
  });
  it("sends targeted email invitations using the configured sender", async () => {
    expect((await response(event(undefined, { role: "editor", email: "helper@example.com" }))).statusCode).toBe(201);
    expect(emailMock.commandCalls(SendEmailCommand)[0]!.args[0].input.Destination).toEqual({ ToAddresses: ["helper@example.com"] });
  });
  it("revokes invitations and reports email delivery failure explicitly", async () => {
    emailMock.on(SendEmailCommand).rejects(new Error("SES down"));
    expect((await response(event(undefined, { role: "editor", email: "helper@example.com" }))).statusCode).toBe(502);
    const calls = mock.commandCalls(TransactWriteCommand);
    expect(calls[1]!.args[0].input.TransactItems?.every((item) => item.Put?.Item?.state === "revoked")).toBe(true);
    expect(calls[1]!.args[0].input.TransactItems?.every((item) => item.Put?.ConditionExpression === "#state = :pending")).toBe(true);
  });
  it("preserves concurrent acceptance when email outcome is uncertain", async () => {
    emailMock.on(SendEmailCommand).rejects(new Error("SES timeout"));
    mock.on(TransactWriteCommand).resolvesOnce({}).rejectsOnce(Object.assign(new Error("Invitation changed"), { name: "TransactionCanceledException" }));
    const result = await response(event(undefined, { role: "editor", email: "helper@example.com" }));
    expect(result.statusCode).toBe(502);
    expect(result.body).toContain("Check household members and invitations");
    expect(result.body).not.toContain("The invitation was revoked");
  });
  it("rejects missing sender setup before creating email invitations", async () => {
    delete process.env.INVITATION_SENDER;
    expect((await response(event(undefined, { role: "editor", email: "helper@example.com" }))).statusCode).toBe(503);
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it("does not allow unrelated users, editors, or edition-restricted managers to grant broader access", async () => {
    expect((await response(event(undefined, undefined, "stranger"))).statusCode).toBe(403);
    mock.on(GetCommand, { Key: houseMemberKey("h1", "helper", "christmas-lights-2026") }).resolves({ Item: { userId: "helper", state: "active", role: "manager", eventId: "christmas-lights-2026" } });
    expect((await response(event(undefined, { role: "editor" }, "helper"))).statusCode).toBe(403);
    expect((await response(event(undefined, { role: "editor", eventId: "christmas-lights-2026" }, "helper"))).statusCode).toBe(201);
  });
  it("accepts an invitation atomically without creating another house or claim", async () => {
    mock.on(GetCommand, { Key: { pk: `INVITE#${hash}`, sk: "INVITE" } }).resolves({ Item: invitation });
    const result = await response(event("POST /household/invitations/accept", { token }, "helper"));
    expect(result.statusCode).toBe(200);
    const items = mock.commandCalls(TransactWriteCommand)[0]!.args[0].input.TransactItems!;
    const member = items.find((item) => item.Put?.Item?.sk === "MEMBER#helper#christmas-lights-2026")?.Put?.Item;
    expect(member).toMatchObject({ houseId: "h1", userId: "helper", role: "editor", eventId: "christmas-lights-2026" });
    expect(items.some((item) => item.Put?.Item?.sk === "METADATA" || String(item.Put?.Item?.sk).startsWith("CLAIM#"))).toBe(false);
  });
  it("rejects expired, used and revoked invitations", async () => {
    for (const override of [{ ttl: 0 }, { state: "accepted" }, { state: "revoked" }]) {
      mock.on(GetCommand, { Key: { pk: `INVITE#${hash}`, sk: "INVITE" } }).resolves({ Item: { ...invitation, ...override } });
      expect((await response(event("POST /household/invitations/accept", { token }, "helper"))).statusCode).toBe(410);
    }
  });
  it("rejects another email account and an inviter whose access was revoked", async () => {
    mock.on(GetCommand, { Key: { pk: `INVITE#${hash}`, sk: "INVITE" } }).resolves({ Item: { ...invitation, email: "specific@example.com" } });
    expect((await response(event("POST /household/invitations/accept", { token }, "helper"))).statusCode).toBe(403);
    mock.on(GetCommand, { Key: { pk: `INVITE#${hash}`, sk: "INVITE" } }).resolves({ Item: invitation });
    mock.on(GetCommand, { Key: houseClaimKey("h1", "manager") }).resolves({});
    expect((await response(event("POST /household/invitations/accept", { token }, "helper"))).statusCode).toBe(410);
  });
  it("blocks creation, acceptance and request access under a privacy hold", async () => {
    mock.on(GetCommand, { Key: houseBlockKey("h1") }).resolves({ Item: { blocked: true } });
    expect((await response(event())).statusCode).toBe(409);
    expect((await response(event("POST /houses/{id}/access-requests", {}, "helper"))).statusCode).toBe(409);
  });
  it("records a request without creating membership or disclosing existing managers", async () => {
    const result = await response(event("POST /houses/{id}/access-requests", {}, "helper"));
    expect(JSON.parse(result.body!)).toEqual({ state: "pending" });
    expect(mock.commandCalls(PutCommand).at(-1)?.args[0].input.Item?.sk).toBe("ACCESS_REQUEST#helper");
    expect(mock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
  it("does not display account IDs in the private household projection", async () => {
    mock.on(QueryCommand).resolves({ Items: [{ sk: "CLAIM#private-user", userId: "private-user", status: "approved" }] });
    const result = await response(event("GET /houses/{id}/household", {}));
    expect(result.body).not.toContain("private-user");
    expect(JSON.parse(result.body!).members[0].label).toContain("Approved house manager");
  });
});
