import os
import boto3
import uuid
from datetime import datetime, timedelta

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_NAME = os.getenv("TABLE_NAME", "Appointments")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

START_DATE = datetime(2026, 1, 10)
END_DATE   = datetime(2026, 1, 31)  # inclusive

SLOTS_PER_DAY = [
    "09:00", "10:00", "11:00",
    "13:00", "14:00", "15:00",
    "16:00", "17:00", "18:00"
]

def daterange(start: datetime, end: datetime):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)

count = 0
with table.batch_writer() as batch:
    for date in daterange(START_DATE, END_DATE):
        date_str = date.strftime("%Y-%m-%d")
        for t in SLOTS_PER_DAY:
            batch.put_item(Item={
                "appointmentId": str(uuid.uuid4()),
                "appointmentDate": date_str,
                "appointmentTime": t,
                "status": "AVAILABLE"
            })
            count += 1

print(f"Inserted {count} appointment slots.")