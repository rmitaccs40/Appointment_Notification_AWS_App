import boto3
import uuid
from datetime import datetime, timedelta

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
table = dynamodb.Table("Appointments")

START_DATE = datetime(2026, 1, 20)
DAYS = 5
SLOTS_PER_DAY = [
    "09:00", "10:00", "11:00",
    "13:00", "14:00", "15:00",
    "16:00", "17:00", "18:00"
]

count = 0

for day in range(DAYS):
    date = START_DATE + timedelta(days=day)
    date_str = date.strftime("%Y-%m-%d")

    for time in SLOTS_PER_DAY:
        table.put_item(
            Item={
                "appointmentId": str(uuid.uuid4()),
                "appointmentDate": date_str,
                "appointmentTime": time,
                "status": "AVAILABLE"
            }
        )
        count += 1

print(f"Inserted {count} appointment slots.")
