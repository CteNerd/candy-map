import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { GetCommand, QueryCommand, TransactWriteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { getEventEdition } from "@candy-map/shared";
import type { House, HouseClaim } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId, getVerifiedClaim } from "../lib/auth.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, houseKey } from "../lib/table.js";
import { getHouseAccess, houseMemberKey, type HouseMember } from "../lib/houseAccess.js";
import { isHouseBlocked, publicationPrivacyConditions } from "../lib/privacy.js";
import { tryConsumeRateLimit } from "../lib/rateLimit.js";

const ses = new SESv2Client({});
const inviteKey = (hash: string) => ({ pk: `INVITE#${hash}`, sk: "INVITE" });
const accessRequestKey = (houseId: string, userId: string) => ({ pk: `HOUSE#${houseId}`, sk: `ACCESS_REQUEST#${userId}` });
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

interface Invitation {
  hash: string; houseId: string; inviterId: string; role: "manager" | "editor"; eventId?: string;
  email?: string; state: "pending" | "accepted" | "revoked"; ttl: number; createdAt: string;
}
function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | undefined {
  try {
    const body: unknown = JSON.parse(event.body ?? "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const userId = getAuthenticatedUserId(event);
  if (!userId) return errorResponse(401, "Sign-in required.");
  const tableName = getTableName();
  const body = parseBody(event);
  if (!body) return errorResponse(400, "Request body must be a JSON object.");
  const route = event.routeKey;

  if (route === "POST /household/invitations/accept") {
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) return errorResponse(400, "A valid invitation token is required.");
    const Key = inviteKey(hashToken(body.token));
    const result = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }));
    const invitation = result.Item as Invitation | undefined;
    if (!invitation || invitation.state !== "pending" || invitation.ttl <= Date.now() / 1000) return errorResponse(410, "This invitation is expired, revoked or already used.");
    const email = getVerifiedClaim(event, "email");
    const verified = getVerifiedClaim(event, "email_verified");
    if (invitation.email && (typeof email !== "string" || email.toLowerCase() !== invitation.email || (verified !== true && verified !== "true"))) {
      return errorResponse(403, "Sign in with the verified email this invitation was sent to.");
    }
    const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(invitation.houseId), ConsistentRead: true }));
    const house = houseResult.Item as House | undefined;
    if (!house || await isHouseBlocked(tableName, house)) return errorResponse(409, "This house is unavailable for shared access.");
    const access = await getHouseAccess(tableName, house.id, invitation.inviterId, invitation.eventId);
    if (access?.role !== "manager") return errorResponse(410, "The inviter no longer has permission to share this house.");
    if (invitation.inviterId === userId) return errorResponse(409, "You already manage this house.");
    const member: HouseMember = {
      houseId: house.id, userId, role: invitation.role, state: "active",
      ...(invitation.eventId ? { eventId: invitation.eventId } : {}), createdAt: new Date().toISOString(),
    };
    try {
      await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
        access.condition, ...publicationPrivacyConditions(tableName, house),
        { Put: { TableName: tableName, Item: { ...Key, ...invitation, state: "accepted" },
          ConditionExpression: "#state = :pending AND ttl > :now",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":pending": "pending", ":now": Math.floor(Date.now() / 1000) } } },
        { Put: { TableName: tableName, Item: { pk: `HOUSE#${house.id}`, sk: `INVITATION_REF#${invitation.hash}`,
          hash: invitation.hash, role: invitation.role, eventId: invitation.eventId, state: "accepted", ttl: invitation.ttl } } },
        { Put: { TableName: tableName, Item: { ...houseMemberKey(house.id, userId, member.eventId), ...member,
          gsi1pk: `USER#${userId}`, gsi1sk: `MEMBER#${house.id}#${member.eventId ?? "all"}` },
          ConditionExpression: "attribute_not_exists(pk) OR #state = :removed",
          ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":removed": "removed" } } },
      ] }));
    } catch (error) {
      if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "Invitation or house access changed. You may already have access; check My houses.");
      throw error;
    }
    return jsonResponse(200, { houseLabel: house.addressDisplayPrivate, role: member.role, eventId: member.eventId });
  }

  const houseId = event.pathParameters?.id;
  if (!houseId) return errorResponse(400, "House is required.");
  const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId), ConsistentRead: true }));
  const house = houseResult.Item as House | undefined;
  if (!house) return errorResponse(404, "House not found.");
  if (await isHouseBlocked(tableName, house)) return errorResponse(409, "This house is unavailable for shared access.");
  const eventId = typeof body.eventId === "string" ? body.eventId : event.queryStringParameters?.eventId;
  if (eventId && !getEventEdition(eventId)) return errorResponse(400, "Unsupported event edition.");
  const access = await getHouseAccess(tableName, houseId, userId, eventId);

  if (route === "POST /houses/{id}/access-requests") {
    if (access) return errorResponse(409, "You already have access to this house.");
    if (!await tryConsumeRateLimit(tableName, "house-access", userId, "all", 60)) return errorResponse(429, "Please wait before requesting access again.");
    await ddbDocClient.send(new PutCommand({
      TableName: tableName, Item: { ...accessRequestKey(houseId, userId), userId, state: "pending", createdAt: new Date().toISOString() },
    }));
    return jsonResponse(201, { state: "pending" });
  }
  if (access?.role !== "manager") return errorResponse(403, "House manager access required.");
  if (route === "GET /houses/{id}/household") {
    const rows = await ddbDocClient.send(new QueryCommand({
      TableName: tableName, KeyConditionExpression: "pk = :house",
      ExpressionAttributeValues: { ":house": `HOUSE#${houseId}` }, ConsistentRead: true,
    }));
    const items = (rows.Items ?? []).filter((item) => !access.eventId || !item.eventId || item.eventId === access.eventId);
    // Local display labels do not expose other accounts' IDs or infer family relationships.
    const memberRows = items.filter((item) => String(item.sk).startsWith("MEMBER#") && item.state === "active");
    const claimRows = items.filter((item) => String(item.sk).startsWith("CLAIM#") && item.status === "approved") as HouseClaim[];
    return jsonResponse(200, {
      houseLabel: house.addressDisplayPrivate,
      members: [
        ...claimRows.map((claim, index) => ({ key: createHash("sha256").update(claim.userId).digest("hex"),
          label: claim.userId === userId ? "You (approved claimant)" : `Approved house manager ${index + 1}`,
          role: "manager", removable: false })),
        ...memberRows.map((member, index) => ({ key: createHash("sha256").update(`${member.userId}:${member.eventId ?? "all"}`).digest("hex"),
          label: member.userId === userId ? "You (invited)" : `Invited ${member.role} ${index + 1}`,
          role: member.role, eventId: member.eventId, removable: (!access.eventId || member.eventId === access.eventId) && member.userId !== userId })),
      ],
      requests: items.filter((item) => String(item.sk).startsWith("ACCESS_REQUEST#") && item.state === "pending")
        .map((item, index) => ({ key: createHash("sha256").update(item.userId).digest("hex"), label: `Access request ${index + 1}` })),
      invitations: items.filter((item) => String(item.sk).startsWith("INVITATION_REF#") && item.state === "pending" && item.ttl > Date.now() / 1000)
        .map((item, index) => ({ key: item.hash, label: `Invitation ${index + 1}`, role: item.role, eventId: item.eventId })),
    });
  }

  if (route === "POST /houses/{id}/household/actions") {
    const key = body.key;
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) return errorResponse(400, "Select a household entry.");
    if (!["approve-request", "reject-request", "remove-member", "revoke-invite"].includes(String(body.action))) return errorResponse(400, "Invalid household action.");
    const rows = await ddbDocClient.send(new QueryCommand({
      TableName: tableName, KeyConditionExpression: "pk = :house",
      ExpressionAttributeValues: { ":house": `HOUSE#${houseId}` }, ConsistentRead: true,
    }));
    const items = rows.Items ?? [];
    const target = items.find((item) => body.action === "revoke-invite"
      ? item.hash === key && String(item.sk).startsWith("INVITATION_REF#")
      : typeof item.userId === "string" && createHash("sha256").update(body.action === "remove-member" ? `${item.userId}:${item.eventId ?? "all"}` : item.userId).digest("hex") === key
        && String(item.sk).startsWith(body.action === "remove-member" ? "MEMBER#" : "ACCESS_REQUEST#"));
    if (!target) return errorResponse(404, "Household entry not found.");
    if (access.eventId && target.eventId !== access.eventId && !String(target.sk).startsWith("ACCESS_REQUEST#")) return errorResponse(403, "Your access does not cover this entry's holiday scope.");
    if (body.action === "remove-member" && target.userId === userId) return errorResponse(409, "Transfer management to another person before leaving. You cannot remove yourself here.");
    if (target.state !== (body.action === "remove-member" ? "active" : "pending")) return errorResponse(409, "This entry has already been handled.");
    const writes = [];
    if (body.action === "approve-request") {
      const member: HouseMember = { houseId, userId: target.userId, role: "editor", state: "active",
        ...(eventId ? { eventId } : {}), createdAt: new Date().toISOString() };
      writes.push({ Put: { TableName: tableName, Item: { ...houseMemberKey(houseId, target.userId, member.eventId), ...member, gsi1pk: `USER#${target.userId}`, gsi1sk: `MEMBER#${houseId}#${member.eventId ?? "all"}` },
        ConditionExpression: "attribute_not_exists(pk) OR #state = :removed", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":removed": "removed" } } });
    }
    if (body.action === "revoke-invite") {
      const invitationResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: inviteKey(key), ConsistentRead: true }));
      if (invitationResult.Item?.houseId !== houseId) return errorResponse(404, "Invitation not found.");
      writes.push({ Put: { TableName: tableName, Item: { ...invitationResult.Item, state: "revoked" },
        ConditionExpression: "#state = :pending", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":pending": "pending" } } });
    }
    writes.push({ Put: { TableName: tableName, Item: { ...target, state: body.action === "approve-request" ? "accepted" : body.action === "remove-member" ? "removed" : "revoked" },
      ConditionExpression: "#state = :previous", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":previous": target.state } } });
    try {
      await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [access.condition, ...publicationPrivacyConditions(tableName, house), ...writes] }));
    } catch (error) {
      if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "Household entry or permissions changed. Reload.");
      throw error;
    }
    return jsonResponse(200, { state: "saved" });
  }

  if (route !== "POST /houses/{id}/invitations") return errorResponse(404, "Unknown household operation.");
  if (body.role !== "manager" && body.role !== "editor") return errorResponse(400, "Choose manager or editor.");
  if (body.email !== undefined && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) return errorResponse(400, "Enter a valid recipient email.");
  if (!await tryConsumeRateLimit(tableName, "house-invite", userId, "all", 60)) return errorResponse(429, "Please wait a minute before creating another invitation.");
  const sender = process.env.INVITATION_SENDER;
  if (body.email && !sender) return errorResponse(503, "Invitation email is not configured. Create a share-link invitation without an email.");
  const origin = process.env.ALLOWED_ORIGIN;
  if (!origin || !origin.startsWith("https://")) return errorResponse(503, "Invitation website is not configured.");
  const token = randomBytes(32).toString("hex");
  const hash = hashToken(token);
  const invitation: Invitation = {
    hash, houseId, inviterId: userId, role: body.role, state: "pending",
    ...(eventId ? { eventId } : {}), ...(body.email ? { email: String(body.email).trim().toLowerCase() } : {}),
    ttl: Math.floor(Date.now() / 1000) + 48 * 3600, createdAt: new Date().toISOString(),
  };
  const reference = { pk: `HOUSE#${houseId}`, sk: `INVITATION_REF#${hash}` };
  try {
    await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
      access.condition, ...publicationPrivacyConditions(tableName, house),
      { Put: { TableName: tableName, Item: { ...inviteKey(hash), ...invitation } } },
      { Put: { TableName: tableName, Item: { ...reference, hash, role: invitation.role, eventId: invitation.eventId, state: "pending", ttl: invitation.ttl } } },
    ] }));
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "House permissions or privacy changed. Reload.");
    throw error;
  }
  const link = `${origin}/invite#${token}`;
  if (invitation.email && sender) {
    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: sender, Destination: { ToAddresses: [invitation.email] },
        Content: { Simple: {
          Subject: { Data: "Invitation to help with a house on Neighborhood Celebrations" },
          Body: { Text: { Data: `You have been invited as a ${invitation.role}${eventId ? ` for ${getEventEdition(eventId)?.label}` : ""}.\n\nSign in and review the invitation: ${link}\n\nThe link expires in 48 hours. Acceptance does not claim residency or publish the house. If this was unexpected, ignore this message.` } },
        } },
      }));
    } catch {
      // A send timeout can occur after delivery and concurrent acceptance.
      try {
        await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: tableName, Item: { ...inviteKey(hash), ...invitation, state: "revoked" },
            ConditionExpression: "#state = :pending", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":pending": "pending" } } },
          { Put: { TableName: tableName, Item: { ...reference, hash, role: invitation.role, eventId: invitation.eventId, state: "revoked", ttl: invitation.ttl },
            ConditionExpression: "#state = :pending", ExpressionAttributeNames: { "#state": "state" }, ExpressionAttributeValues: { ":pending": "pending" } } },
        ] }));
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TransactionCanceledException") throw error;
        console.error("Invitation email outcome uncertain; invitation changed before revocation.");
        return errorResponse(502, "Email delivery could not be confirmed and the invitation changed before revocation. Check household members and invitations before retrying.");
      }
      console.error("Invitation email delivery failed; invitation revoked.");
      return errorResponse(502, "Email delivery failed. The invitation was revoked; try again or create a share-only link.");
    }
  }
  return jsonResponse(201, { link, expiresAt: new Date(invitation.ttl * 1000).toISOString(), emailAccepted: Boolean(invitation.email), role: invitation.role });
}
