import { createHash, randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand, type QueryCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { canonicalAddressKey } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, houseKeyReservationKey } from "../lib/table.js";
import { addressBlockKey, houseBlockKey, privacyRequestKey } from "../lib/privacy.js";
import { tryConsumeRateLimit } from "../lib/rateLimit.js";
import { getAuthenticatedUserId, getVerifiedClaim } from "../lib/auth.js";

function isReviewer(event: APIGatewayProxyEventV2): boolean {
  const groups = getVerifiedClaim(event, "cognito:groups");
  if (Array.isArray(groups)) return groups.includes("privacy-reviewers");
  return typeof groups === "string" && groups.split(/[\s,[\]"]+/).includes("privacy-reviewers");
}

interface RequestRecord {
  id: string; address: string; addressKey: string; houseId?: string;
  mode: "block" | "remove"; message: string; state: string; createdAt: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tableName = getTableName();
  const method = event.requestContext.http.method;
  if (method === "GET") {
    if (!isReviewer(event)) return errorResponse(403, "Privacy reviewer access required.");
    const items: NonNullable<QueryCommandOutput["Items"]> = [];
    let cursor: QueryCommandOutput["LastEvaluatedKey"];
    do {
      const results: QueryCommandOutput = await ddbDocClient.send(new QueryCommand({
        TableName: tableName, IndexName: "gsi1", KeyConditionExpression: "gsi1pk = :queue",
        ExpressionAttributeValues: { ":queue": "PRIVACY_QUEUE" }, Limit: 100, ExclusiveStartKey: cursor,
      }));
      items.push(...(results.Items ?? []));
      cursor = results.LastEvaluatedKey;
    } while (cursor);
    return jsonResponse(200, items.filter((item) => !item.ttl || item.ttl > Date.now() / 1000).map((item) => ({
      id: item.id, address: item.address, mode: item.mode, message: item.message,
      state: item.state, createdAt: item.createdAt,
    })));
  }
  let body: unknown;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return errorResponse(400, "Request body must be valid JSON."); }
  if (!body || typeof body !== "object") return errorResponse(400, "Request body must be an object.");
  if (event.pathParameters?.id) {
    if (!isReviewer(event)) return errorResponse(403, "Privacy reviewer access required.");
    if (!("decision" in body) || !["approve", "reject", "restore"].includes(String(body.decision))
      || !("note" in body) || typeof body.note !== "string" || !body.note.trim() || body.note.length > 1000) {
      return errorResponse(400, "A decision and private review note (1-1000 characters) are required.");
    }
    if (body.decision === "restore" && (!("authorityConfirmed" in body) || body.authorityConfirmed !== true)) {
      return errorResponse(400, "Restoration requires confirmation that property authority and any appeal have been reviewed.");
    }
    const Key = privacyRequestKey(event.pathParameters.id);
    const result = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }));
    const request = result.Item as RequestRecord | undefined;
    if (result.Item?.ttl && result.Item.ttl <= Date.now() / 1000) return errorResponse(410, "This request detail has expired. Submit a new reviewed request to change a retained hold.");
    if (!request) return errorResponse(404, "Request not found.");
    if (request.state !== "pending" && body.decision !== "restore") return errorResponse(409, "This request has already been reviewed.");
    const state = body.decision === "restore" ? "restored" : body.decision === "approve" ? "approved" : "appeal_required";
    const updates = [addressBlockKey(request.addressKey), ...(request.houseId ? [houseBlockKey(request.houseId)] : [])];
    try {
      await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
        { Put: { TableName: tableName, Item: { ...Key, ...request, state, note: body.note,
          gsi1pk: "PRIVACY_QUEUE", gsi1sk: request.createdAt,
          reviewedBy: getAuthenticatedUserId(event), reviewedAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 86400 },
          ConditionExpression: "#state = :previous", ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":previous": request.state } } },
        ...updates.map((key) => ({ Put: { TableName: tableName, Item: { ...key, blocked: state !== "restored", state, requestId: request.id },
          ConditionExpression: "requestId = :request", ExpressionAttributeValues: { ":request": request.id } } })),
      ] }));
    } catch (error) {
      if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "Request changed during review. Reload the queue.");
      throw error;
    }
    return jsonResponse(200, { id: request.id, state });
  }
  const values = body as Record<string, unknown>;
  for (const field of ["street", "postalCode", "country"]) {
    if (typeof values[field] !== "string" || !values[field].trim() || values[field].length > 200) {
      return errorResponse(400, "Street, postal code and country are required (maximum 200 characters).");
    }
    if (!/^[a-zA-Z]{2}$/.test(String(values.country))) return errorResponse(400, "Use a two-letter country code.");
  }
  if (values.unit !== undefined && (typeof values.unit !== "string" || values.unit.length > 100)) return errorResponse(400, "Invalid unit.");
  if (values.mode !== "block" && values.mode !== "remove") return errorResponse(400, "Choose block or remove.");
  if (values.message !== undefined && (typeof values.message !== "string" || values.message.length > 1000)) return errorResponse(400, "Message must be at most 1000 characters.");
  const address = { street: String(values.street), postalCode: String(values.postalCode), country: String(values.country), unit: values.unit as string | undefined };
  const addressKey = canonicalAddressKey(address);
  const actor = createHash("sha256").update(event.requestContext.http.sourceIp).digest("hex");
  if (!await tryConsumeRateLimit(tableName, "privacy-request", actor, "all", 60)) return errorResponse(429, "Please wait a minute before submitting another request.");
  const reservationKey = houseKeyReservationKey(addressKey);
  const reservation = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: reservationKey, ConsistentRead: true }));
  const houseId = typeof reservation.Item?.houseId === "string" ? reservation.Item.houseId : undefined;
  const id = randomUUID();
  const request: RequestRecord = {
    id, address: [address.street, address.unit, address.postalCode, address.country].filter(Boolean).join(", "),
    addressKey, ...(houseId ? { houseId } : {}), mode: values.mode, message: String(values.message ?? ""),
    state: "pending", createdAt: new Date().toISOString(),
  };
  try {
    await ddbDocClient.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: tableName, Item: { ...privacyRequestKey(id), ...request, gsi1pk: "PRIVACY_QUEUE", gsi1sk: request.createdAt } } },
      { Put: { TableName: tableName, Item: { ...addressBlockKey(addressKey), blocked: true, state: "pending", requestId: id } } },
      ...(houseId ? [{ Put: { TableName: tableName, Item: { ...houseBlockKey(houseId), blocked: true, state: "pending", requestId: id } } }] : []),
      { ConditionCheck: { TableName: tableName, Key: reservationKey,
        ConditionExpression: houseId ? "houseId = :house" : "attribute_not_exists(pk)",
        ...(houseId ? { ExpressionAttributeValues: { ":house": houseId } } : {}) } },
    ] }));
  } catch (error) {
    if (error instanceof Error && error.name === "TransactionCanceledException") return errorResponse(409, "Address records changed. Please submit again.");
    throw error;
  }
  return jsonResponse(201, { id, state: "pending" });
}
