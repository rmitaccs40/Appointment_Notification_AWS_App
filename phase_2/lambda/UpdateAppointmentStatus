import json
import boto3
import os

dynamodb = boto3.client('dynamodb', region_name='us-east-1')
stepfunctions = boto3.client('stepfunctions', region_name='us-east-1')

def lambda_handler(event, context):
    if isinstance(event.get('body'), str):
        body = json.loads(event['body'])
    else:
        body = event.get('body', event)
    
    appointment_id = body['appointmentId']
    new_status = body['status']
    
    try:
        # Update DynamoDB
        response = dynamodb.update_item(
            TableName='Appointments',
            Key={'appointmentId': {'S': appointment_id}},
            UpdateExpression='SET #status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': {'S': new_status}},
            ConditionExpression='attribute_exists(appointmentId)'
        )
        
        # Trigger Step Functions if accepted or declined (Phase 3)
        if new_status in ['ACCEPTED', 'DECLINED']:
            state_machine_arn = os.environ.get('STATE_MACHINE_ARN')
            if state_machine_arn:
                stepfunctions.start_execution(
                    stateMachineArn=state_machine_arn,
                    input=json.dumps({
                        'appointmentId': appointment_id,
                        'status': new_status
                    })
                )
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'message': 'Status updated',
                'appointmentId': appointment_id,
                'newStatus': new_status
            })
        }
        
    except Exception as e:
        if 'ConditionalCheckFailedException' in str(e):
            return {
                'statusCode': 404,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'message': 'Appointment not found'})
            }
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'message': 'Error updating status'})
        }
