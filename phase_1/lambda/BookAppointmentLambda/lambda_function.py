import json
import os
import boto3
import base64
from botocore.exceptions import ClientError
import redis

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_NAME = os.getenv("TABLE_NAME", "Appointments")

# Cache settings
REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
CACHE_KEY = "available_slots"

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}

def resp(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }

def get_method(event):
    # REST API (v1)
    if event.get("httpMethod"):
        return event["httpMethod"]
    # HTTP API (v2)
    return event.get("requestContext", {}).get("http", {}).get("method")

def get_body_json(event):
    raw = event.get("body")
    if raw is None:
        return {}
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    if isinstance(raw, str):
        return json.loads(raw) if raw else {}
    return raw  # already dict

def invalidate_cache():
    """
    Best-effort cache invalidation.
    If Redis is not configured or unreachable, ignore and continue.
    """
    if not REDIS_HOST:
        return
    try:
        r = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            ssl=True,  # ElastiCache Serverless uses TLS in transit
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
            decode_responses=True,
        )
        r.delete(CACHE_KEY)
        print(f"Cache invalidated: {CACHE_KEY}")
    except Exception as e:
        print("Cache invalidation skipped:", repr(e))

def lambda_handler(event, context):
    method = get_method(event)

    # Preflight
    if method == "OPTIONS":
        return resp(200, {"ok": True})

    if method != "POST":
        return resp(405, {"error": "Method not allowed", "got": method})

    try:
        body = get_body_json(event)

        appointment_id = body.get("appointmentId")
        patient_email = body.get("patientEmail")
        patient_name = body.get("patientName", "")

        if not appointment_id or not patient_email:
            return resp(400, {"error": "Missing required fields: appointmentId, patientEmail"})

        table.update_item(
            Key={"appointmentId": appointment_id},
            UpdateExpression="SET #s = :new, patientEmail = :e, patientName = :n",
            ConditionExpression="#s = :available",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":new": "PENDING",
                ":available": "AVAILABLE",
                ":e": patient_email,
                ":n": patient_name,
            },
        )

        # Invalidate cached slot list so next GET refreshes from DynamoDB
        invalidate_cache()

        return resp(200, {"message": "Booked successfully", "appointmentId": appointment_id, "status": "PENDING"})

    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code == "ConditionalCheckFailedException":
            return resp(409, {"error": "Slot is no longer available"})
        return resp(500, {"error": "DynamoDB error", "detail": str(e)})

    except Exception as e:
        return resp(500, {"error": "Server error", "detail": str(e)})