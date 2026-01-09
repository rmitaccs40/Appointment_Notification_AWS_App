import json
import os
import boto3
from boto3.dynamodb.conditions import Attr

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_NAME = os.getenv("TABLE_NAME", "Appointments")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

def resp(status_code: int, body: dict | list):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",  # tighten later to S3 domain if needed
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(body)
    }

def handler(event, context):
    try:
        # Scan only AVAILABLE slots
        result = table.scan(
            FilterExpression=Attr("status").eq("AVAILABLE")
        )
        items = result.get("Items", [])

        # If scan is paginated, keep scanning
        while "LastEvaluatedKey" in result:
            result = table.scan(
                ExclusiveStartKey=result["LastEvaluatedKey"],
                FilterExpression=Attr("status").eq("AVAILABLE")
            )
            items.extend(result.get("Items", []))

        # Sort by date/time for nicer UI
        items.sort(key=lambda x: (x.get("appointmentDate",""), x.get("appointmentTime","")))

        return resp(200, items)

    except Exception as e:
        return resp(500, {"error": str(e)})
