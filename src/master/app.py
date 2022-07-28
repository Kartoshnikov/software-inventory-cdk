#!/usr/bin/env python3

import os
import json
import boto3
from time import sleep
from math import ceil


sts = boto3.client('sts')
sqs = boto3.client('sqs')

processing_queue_url = os.getenv('PROCESING_QUEUE_URL')
batch_size = int(os.getenv('BATCH_SIZE'))
roleToAssume = os.getenv('ASSUME_ROLE')


def lambda_handler(event, context):
    accountsNonProd = ['111111111111','222222222222','333333333333','444444444444','555555555555']
    accountsProd = ['666666666666','777777777777','888888888888','999999999999']
    accounts = accountsNonProd + accountsProd

    inventoryItemList = []
    for account in accounts:
        try:
            print(f'Downloading... for account {account}')
            sessionAws = sts.assume_role(
                RoleArn=f'arn:aws:iam::{account}:role/{roleToAssume}',
                RoleSessionName='cross_acct_lambda'
            )['Credentials']
            
            ssmClient = boto3.client('ssm',
                aws_access_key_id=sessionAws['AccessKeyId'],
                aws_secret_access_key=sessionAws['SecretAccessKey'],
                aws_session_token=sessionAws['SessionToken']
            )

            total = 0
            instanceInformationPaginator = ssmClient.get_paginator('describe_instance_information')
            for page in instanceInformationPaginator.paginate(
                InstanceInformationFilterList=[{
                    'key': 'PlatformTypes',
                    'valueSet': [ 'Linux' ]
                }],
                PaginationConfig={'PageSize': 50}
            ):
                total = total+1
                print(len(page['InstanceInformationList']))
                for instance in page['InstanceInformationList']:
                    instanceObject = {
                        'instanceId': instance['InstanceId'],
                        'account': account,
                        'instanceIp': instance['IPAddress'],
                        'instanceName': instance['ComputerName'],
                        'osName': instance['PlatformName'],
                        'osVersion': instance['PlatformVersion'],
                        'productName': '',
                        'costCentre': '',
                        'environment': ''
                    }
                    inventoryItemList.append({'instanceObj': instanceObject, 'account_id': account})

            print(f'Account: {account} - processed {total} instances')
        except Exception as e:
            print(e)
            print(f'unable to process account {account}')

    print(f'Inventory list length: {len(inventoryItemList)}')
    if len(inventoryItemList) > 0:
        for i, batch in enumerate([inventoryItemList[x:x+batch_size] for x in range(0,len(inventoryItemList),batch_size)]):
            sqs.send_message(
                QueueUrl=processing_queue_url,
                DelaySeconds=int((900/(ceil(len(inventoryItemList)/batch_size)-1))*i), ### Not more than 900
                MessageBody=json.dumps({
                    'batch': batch,
                    'index': i
                })
            )   
            print(f'A batch with the lenth of {len(batch)} is sent for processing')
    else:
        print('The inventory list is empty')
