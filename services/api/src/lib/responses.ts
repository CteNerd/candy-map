import type { APIGatewayProxyResultV2 } from "aws-lambda";

function corsHeaders(): Record<string, string> {
  const origin = process.env.ALLOWED_ORIGIN ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,content-type",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  };
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

export function errorResponse(statusCode: number, message: string, details?: string[]): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error: message, details });
}
