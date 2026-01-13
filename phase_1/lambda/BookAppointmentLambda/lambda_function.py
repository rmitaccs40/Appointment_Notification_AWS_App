import json
import os
import boto3
from botocore.exceptions import ClientError

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_NAME = os.getenv("TABLE_NAME", "Appointments")

dynamodb = boto3.client("dynamodb", region_name=REGION)

def resp(status_code: int, body: dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        "body": json.dumps(body)
    }

def handler(event, context):
    try:
        raw_body = event.get("body") or "{}"
        if isinstance(raw_body, str):
            body = json.loads(raw_body)
        else:
            body = raw_body

        appointment_id = body.get("appointmentId")
        patient_email = body.get("patientEmail")

        if not appointment_id or not patient_email:
            return resp(400, {"error": "appointmentId and patientEmail are required"})

        # Optional fields (safe to store if you want)
        patient_name = body.get("patientName", "")
        notes = body.get("notes", "")

        # Conditional update: only if status is AVAILABLE
        try:
            update_expr = "SET #s = :pending, patientEmail = :email"
            expr_attr_names = {"#s": "status"}
            expr_attr_values = {
                ":pending": {"S": "PENDING"},
                ":available": {"S": "AVAILABLE"},
                ":email": {"S": patient_email}
            }

            # Add optional fields if present
            if patient_name:
                update_expr += ", patientName = :name"
                expr_attr_values[":name"] = {"S": patient_name}
            if notes:
                update_expr += ", notes = :notes"
                expr_attr_values[":notes"] = {"S": notes}

            dynamodb.update_item(
                TableName=TABLE_NAME,
                Key={"appointmentId": {"S": appointment_id}},
                UpdateExpression=update_expr,
                ConditionExpression="#s = :available",
                ExpressionAttributeNames=expr_attr_names,
                ExpressionAttributeValues=expr_attr_values
            )

        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code == "ConditionalCheckFailedException":
                return resp(409, {"error": "Slot is not AVAILABLE (already booked or pending)."})
            return resp(500, {"error": f"DynamoDB error: {str(e)}"})

        return resp(200, {"status": "PENDING", "message": "Booking submitted."})

    except Exception as e:
        return resp(500, {"error": str(e)})
