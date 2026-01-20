import json
import os
import time
import boto3
from boto3.dynamodb.conditions import Attr

# --- Redis / Valkey ---
import redis

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_NAME = os.getenv("TABLE_NAME", "Appointments")

REDIS_HOST = os.getenv("REDIS_HOST")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "30"))

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

def resp(status_code, body, cache_status="N/A"):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Expose-Headers": "X-Cache",
            "X-Cache": cache_status,
        },
        "body": json.dumps(body),
    }

def get_redis_client():
    if not REDIS_HOST:
        return None, "NO_REDIS_HOST"
    try:
        r = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            ssl=True,  # IMPORTANT for ElastiCache Serverless (TLS)
            socket_connect_timeout=1,
            socket_timeout=1,
            decode_responses=True,
        )
        # force a quick connectivity check
        r.ping()
        return r, None
    except Exception as e:
        return None, f"REDIS_CONNECT_FAIL:{type(e).__name__}"

def lambda_handler(event, context):
    print("EVENT:", json.dumps(event)[:500])

    # Handle preflight
    if event.get("httpMethod") == "OPTIONS":
        return resp(200, {"ok": True}, cache_status="OPTIONS")

    cache_key = "available_slots"

    # 1) Try Redis
    r, redis_err = get_redis_client()
    if r:
        try:
            cached = r.get(cache_key)
            if cached:
                print("REDIS HIT")
                return resp(200, json.loads(cached), cache_status="REDIS_HIT")

            print("REDIS MISS -> DynamoDB")
        except Exception as e:
            print("REDIS read error:", repr(e))
            r = None
            redis_err = f"REDIS_READ_FAIL:{type(e).__name__}"

    # 2) DynamoDB (source of truth)
    try:
        result = table.scan(FilterExpression=Attr("status").eq("AVAILABLE"))
        items = result.get("Items", [])

        while "LastEvaluatedKey" in result:
            result = table.scan(
                ExclusiveStartKey=result["LastEvaluatedKey"],
                FilterExpression=Attr("status").eq("AVAILABLE"),
            )
            items.extend(result.get("Items", []))

        items.sort(key=lambda x: (x.get("appointmentDate", ""), x.get("appointmentTime", "")))

        # 3) Store in Redis if available
        if r:
            try:
                r.setex(cache_key, CACHE_TTL_SECONDS, json.dumps(items))
                print("Stored in REDIS with TTL:", CACHE_TTL_SECONDS)
                return resp(200, items, cache_status="REDIS_MISS")
            except Exception as e:
                print("REDIS write error:", repr(e))
                return resp(200, items, cache_status=f"REDIS_BYPASS:{type(e).__name__}")

        # Redis not available
        if redis_err:
            print("REDIS BYPASS reason:", redis_err)
            return resp(200, items, cache_status=f"REDIS_BYPASS:{redis_err}")

        return resp(200, items, cache_status="REDIS_BYPASS")

    except Exception as e:
        print("DynamoDB error:", repr(e))
        return resp(500, {"error": str(e)}, cache_status="ERROR")