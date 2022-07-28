import os
import time
import boto3
from json import dumps, loads
from botocore.config import Config

inventoryItemList = []
sqs = boto3.client('sqs')
result_file_name = 'inventory_data.json'
out_bucket_name = os.getenv('REPORT_BUCKET')
processing_queue_url = os.getenv('PROCESING_QUEUE_URL')
roleToAssume = os.getenv('ASSUME_ROLE')
config = Config(retries={
    'max_attempts': 10,
    'mode': 'standard'
})

sts = boto3.client('sts', config=config)

def extractSoftwareFromInstanceObject(ssmClient, instanceObj):
    try:
        softData = []
        
        results = ssmClient.list_inventory_entries(
            InstanceId=instanceObj['instanceId'],
            TypeName='AWS:Application'
        )

        if 'Entries' in results:
            softData.extend([ dumps({'date': time.strftime('%Y-%m-%d'), **instanceObj, **createSoftwareObject(data)}) + '\n' for data in results['Entries'] ])
            while 'NextToken' in results:
                results = ssmClient.list_inventory_entries(
                    InstanceId=instanceObj['instanceId'],
                    TypeName='AWS:Application', NextToken=results['NextToken']
                )
                if 'Entries' in results:
                    softData.extend([ dumps({'date': time.strftime('%Y-%m-%d'), **instanceObj, **createSoftwareObject(data)}) + '\n' for data in results['Entries'] ])
            return softData
    except Exception as e:
        print(e)

def createSoftwareObject(data):
    return {
        'packageId': data.get('PackageId', ""),
        'publisher': data.get('Publisher', ""),
        'architecture': data.get('Architecture', ""),
        'version': data.get('Version', ""),
        'summary': data.get('Summary', ""),
        'applcationType': data.get('ApplicationType', ""),
        'name': data.get('Name', "")
    }

def lambda_handler(event, context):
    data = loads(event['Records'][0]['body'])
    account = ''
    for instance in data['batch']:
        if not instance['account_id'] == account:
            account = instance['account_id']
            sessionAws = sts.assume_role(
                RoleArn=f"arn:aws:iam::{instance['account_id']}:role/{roleToAssume}",
                RoleSessionName="cross_acct_lambda"
            )['Credentials'] 
            
            ssmClient = boto3.client('ssm', config=config,
                aws_access_key_id=sessionAws['AccessKeyId'],
                aws_secret_access_key=sessionAws['SecretAccessKey'],
                aws_session_token=sessionAws['SessionToken']
            )

        softData = extractSoftwareFromInstanceObject(ssmClient=ssmClient, instanceObj=instance['instanceObj'])
        inventoryItemList.extend(softData)

    with open(f'/tmp/{result_file_name}', 'w') as out:
        out.writelines(inventoryItemList)
    
    boto3.client('s3', config=config).upload_file(
        f'/tmp/{result_file_name}',
        out_bucket_name,
        f'{time.strftime("%Y")}/{time.strftime("%m")}/{time.strftime("%d")}/{data["index"]}-{result_file_name}'
    )

    sqs.delete_message(
        QueueUrl=processing_queue_url,
        ReceiptHandle=event['Records'][0]['receiptHandle']
    )

