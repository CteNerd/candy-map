/**
 * POST /houses/{id}/reports
 * Authenticated, rate-limited. Records a community report of a house's candy status as
 * `pending` moderation — "Do not publish a house simply because a visitor reported it. Store
 * community reports as pending moderation for the POC." Reports never affect the public
 * `CandyParticipation` directly; an organizer reviews them separately (see TASKS.md "Known gaps"
 * — there's no listing endpoint for pending reports yet either, same shape as the claims gap).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { CandyReport, CandyStatus } from "@candy-map/shared";
import { ddbDocClient } from "../lib/ddb.js";
import { getAuthenticatedUserId } from "../lib/auth.js";
import { generateId } from "../lib/ids.js";
import { tryConsumeRateLimit } from "../lib/rateLimit.js";
import { errorResponse, jsonResponse } from "../lib/responses.js";
import { getTableName, houseKey, houseReportKey } from "../lib/table.js";

const VALID_STATUSES: CandyStatus[] = ["available", "low", "finished"];
const REPORT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // one report per house per reporter per 10 minutes

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const reporterId = getAuthenticatedUserId(event);
  if (!reporterId) {
    return errorResponse(401, "Sign-in required.");
  }

  const houseId = event.pathParameters?.id;
  if (!houseId) {
    return errorResponse(400, "Path parameter 'id' is required.");
  }

  let status: CandyStatus | undefined;
  try {
    status = event.body ? (JSON.parse(event.body) as { status?: CandyStatus }).status : undefined;
  } catch {
    return errorResponse(400, "Request body must be valid JSON.");
  }
  if (!status || !VALID_STATUSES.includes(status)) {
    return errorResponse(400, `'status' must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const tableName = getTableName();
  const houseResult = await ddbDocClient.send(new GetCommand({ TableName: tableName, Key: houseKey(houseId) }));
  if (!houseResult.Item) {
    return errorResponse(404, "House not found.");
  }

  const allowed = await tryConsumeRateLimit(tableName, "report", reporterId, houseId, REPORT_RATE_LIMIT_WINDOW_SECONDS);
  if (!allowed) {
    return errorResponse(429, "You've already reported this house recently — please wait before reporting again.");
  }

  const report: CandyReport = {
    id: generateId(),
    houseId,
    reporterId,
    status,
    createdAt: new Date().toISOString(),
    moderationState: "pending",
  };

  await ddbDocClient.send(
    new PutCommand({ TableName: tableName, Item: { ...houseReportKey(houseId, report.id), ...report } }),
  );

  return jsonResponse(201, { id: report.id, moderationState: "pending" });
}
