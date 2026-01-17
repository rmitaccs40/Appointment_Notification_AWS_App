import json
import boto3
import redis
import os

dynamodb = boto3.client('dynamodb', region_name='us-east-1')

redis_endpoint = os.environ.get('REDIS_ENDPOINT', '')
redis_client = None

if redis_endpoint:
    try:
        redis_client = redis.Redis(
            host=redis_endpoint, 
            port=6379, 
            decode_responses=True,
        )
    except Exception as e:
        print(f"Redis connection failed: {e}")
        redis_client = None

def lambda_handler(event, context):
    cache_key = 'appointments:available'
    
    # Try cache first
    if redis_client:
        try:
            cached_data = redis_client.get(cache_key)
            if cached_data:
                slots = json.loads(cached_data)
                return {
                    'statusCode': 200,
                    'headers': {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'X-Cache': 'HIT'
                    },
                    'body': json.dumps({'slots': slots, 'source': 'cache'})
                }
        except Exception as e:
            print(f"Redis read error: {e}")
    
    # Query DynamoDB
    response = dynamodb.scan(
        TableName='Appointments',
        FilterExpression='#status = :available',
        ExpressionAttributeNames={'#status': 'status'},
        ExpressionAttributeValues={':available': {'S': 'AVAILABLE'}}
    )
    
    slots = []
    for item in response['Items']:
        slots.append({
            'slotId': item['appointmentId']['S'],
            'date': item['appointmentDate']['S'],
            'time': item['appointmentTime']['S']
        })
    
    # Cache for 60 seconds
    if redis_client:
        try:
            redis_client.setex(cache_key, 60, json.dumps(slots))
        except Exception as e:
            print(f"Redis write error: {e}")
    
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'MISS'
        },
        'body': json.dumps({'slots': slots, 'source': 'dynamodb'})
    }
