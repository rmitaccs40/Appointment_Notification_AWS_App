import boto3
from datetime import datetime, timedelta

dynamodb = boto3.client('dynamodb', region_name='us-east-1')

def populate_available_slots():
    time_slots = [
        "09:00 AM", "10:00 AM", "11:00 AM", 
        "12:00 PM", "01:00 PM", "02:00 PM", 
        "03:00 PM", "04:00 PM", "05:00 PM"
    ]
    
    slots_created = 0
    
    for day_offset in range(1, 14):
        date = datetime.now() + timedelta(days=day_offset)
        
        if date.weekday() >= 5:
            continue
        
        date_str = date.strftime("%Y-%m-%d")
        
        for time_slot in time_slots:
            slot_id = f"slot-{date_str}-{time_slot.replace(':', '').replace(' ', '')}"
            
            try:
                dynamodb.put_item(
                    TableName='Appointments',
                    Item={
                        'appointmentId': {'S': slot_id},
                        'appointmentDate': {'S': date_str},
                        'appointmentTime': {'S': time_slot},
                        'status': {'S': 'AVAILABLE'}
                    },
                    ConditionExpression='attribute_not_exists(appointmentId)'
                )
                slots_created += 1
                print(f"Created: {date_str} at {time_slot}")
            except:
                pass
    
    print(f"\nTotal slots created: {slots_created}")

if __name__ == "__main__":
    populate_available_slots()
