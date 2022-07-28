import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { Duration, aws_glue as glue } from 'aws-cdk-lib';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { ExampleStack, ExampleStackProps } from '@example/example-cdk-lib';
import { Role, ServicePrincipal, ArnPrincipal, ManagedPolicy, Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';


// ###################################################
// Global Vars
// ###################################################
const masterFunctionName = 'SoftwareInventoryMaster'
const masterRoleName = masterFunctionName + 'FunctionRole';
const perAccountMasterRoleName = masterFunctionName + 'PerAccountRole';
const workerDefaultBatchSize = '150'

const workerFunctionTimeout = 900
const workerFunctionName = 'SoftwareInventoryWorker'
const workerRoleName = workerFunctionName + 'FunctionRole';
const perAccountWorkerRoleName = workerFunctionName + 'PerAccountRole';

// ###################################################
// Stack
// ###################################################
export class SoftwareInventoryStack extends ExampleStack {
  constructor(scope: Construct, id: string, props: ExampleStackProps) {
    super(scope, id, props);

    // ###################################################
    // Prerequisites
    // ###################################################
    const reportsBucket = new Bucket(this, "example-software-inventory", {
      bucketName: "example-software-inventory",
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(14),
        }
      ]
    })

    const athenaOutputBucket = new Bucket(this, "example-software-inventory-athena-output", {
      bucketName: "example-software-inventory-athena-output",
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(7),
        }
      ]
    })

    const dailyRule = new Rule(this, 'SoftwareInventory', {
      ruleName: "SoftwareInventory",
      schedule: Schedule.rate(Duration.days(1)),
    })

    const processingQueue = new Queue(this, 'SoftwareInventorySQSQueue', {
      queueName: 'SoftwareInventoryProcessingQueue',
      visibilityTimeout: Duration.seconds(workerFunctionTimeout)
    })

    const sqsEventSourceForLambda = new SqsEventSource(processingQueue)

    // ###################################################
    // Worker function
    // ###################################################
    const WorkerRole = new Role(this, 'WorkerRole', {
      roleName: workerRoleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for processing software for instances in different accounts',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    const assumeWorkerRoleStatement = new PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['arn:aws:iam::*:role/' + perAccountWorkerRoleName]
    })
    const putLogRetentionWorkerRoleStatement = new PolicyStatement({
      actions: ['logs:PutRetentionPolicy'],
      resources: ['arn:aws:logs:' + ExampleStack.of(this).region + ':' + ExampleStack.of(this).account + ':log-group:/aws/lambda/' + workerFunctionName]
    })
    WorkerRole.attachInlinePolicy(
      new Policy(this, "inlineWorkerRole", {
        statements: [
          assumeWorkerRoleStatement,
          putLogRetentionWorkerRoleStatement
        ]
      })
    )

    const WorkerFunction = new Function(this, "WorkerFunction", {
      functionName: workerFunctionName,
      runtime: Runtime.PYTHON_3_8,
      handler: 'app.lambda_handler',
      code: Code.fromAsset('src/worker'),
      logRetention: RetentionDays.TWO_WEEKS,
      timeout: Duration.seconds(workerFunctionTimeout),
      memorySize: 512,
      role: WorkerRole,
      environment: {
        'PROCESING_QUEUE_URL': processingQueue.queueUrl,
        'REPORT_BUCKET': reportsBucket.bucketName,
        'ASSUME_ROLE': perAccountWorkerRoleName
      }
    })

    reportsBucket.grantPut(WorkerFunction)
    WorkerFunction.addEventSource(sqsEventSourceForLambda)

    // ###################################################
    // Master function
    // ###################################################
    const MasterRole = new Role(this, 'MasterRole', {
      roleName: masterRoleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for listing instances in SSM in all accounts',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    const assumeMasterRoleStatement = new PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: ['arn:aws:iam::*:role/' + perAccountMasterRoleName]
    })
    const putLogRetentionMasterRoleStatement = new PolicyStatement({
      actions: ['logs:PutRetentionPolicy'],
      resources: ['arn:aws:logs:' + ExampleStack.of(this).region + ':' + ExampleStack.of(this).account + ':log-group:/aws/lambda/' + masterFunctionName]
    })
    MasterRole.attachInlinePolicy(
      new Policy(this, "AssumeMasterRole", {
        statements: [
          assumeMasterRoleStatement,
          putLogRetentionMasterRoleStatement
        ]
      })
    )

    const MasterFunction = new Function(this, "MasterFunction", {
      functionName: masterFunctionName,
      runtime: Runtime.PYTHON_3_8,
      handler: 'app.lambda_handler',
      code: Code.fromAsset('src/master'),
      logRetention: RetentionDays.TWO_WEEKS,
      timeout: Duration.minutes(15),
      memorySize: 512,
      role: MasterRole,
      environment: {
        'PROCESING_QUEUE_URL': processingQueue.queueUrl,
        'ASSUME_ROLE': perAccountMasterRoleName,
        'BATCH_SIZE': workerDefaultBatchSize
      }
    })
    
    dailyRule.addTarget(new LambdaFunction(MasterFunction));
    processingQueue.grantSendMessages(MasterFunction)

    // ###################################################
    // Crawler
    // ###################################################
    const crawlerRole = new Role(this, 'CrawlerRole', {
      roleName: 'software-inventory-role',
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
      description: 'Role for building Software Inventory',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ]
    });
    const RWForS3Statement = new PolicyStatement({
      actions: [
        "s3:GetObject",
        "s3:PutObject"
      ],
      resources: [ reportsBucket.bucketArn + '/*' ]
    })
    crawlerRole.attachInlinePolicy(
      new Policy(this, 'CustomCrawlerPolicy', {
        policyName: 'CustomCrawlerPolicy',
        statements: [ RWForS3Statement ]
      })
    )

    const crawler = new glue.CfnCrawler(this, 'SoftwareInventoryCrawler', {
      name: 'example-software-inventory',
      role: crawlerRole.roleArn,
      databaseName: 'example-software-inventory',

      targets: {
        s3Targets: [{path: 's3://' + reportsBucket.bucketName + '/',}]
      },

      schedule: {
        scheduleExpression: 'cron(30 01 * * ? *)',
      },
    });
  }
}

// ###################################################
// Per Account Stacks
// ###################################################
export class PerAccountSoftwareInventoryStack extends ExampleStack {
  constructor(scope: Construct, id: string, props: ExampleStackProps) {
    super(scope, id, props);

    // ###################################################
    // Per Account Roles for Software Inventory
    // ###################################################
    const perAccountMasterRole = new Role(this, 'RoleMaster', {
      roleName: perAccountMasterRoleName,
      assumedBy: new ArnPrincipal('arn:aws:iam::111111111111:role/' + masterRoleName),
      description: 'Role for processing software for instances in this particular account'
    });
    const ssmMasterInventory = new PolicyStatement({
      actions: ['ssm:DescribeInstanceInformation'],
      resources: ['*']
    })
    perAccountMasterRole.attachInlinePolicy(
      new Policy(this, "ssmMasterInventory", {
        statements: [ssmMasterInventory]
      })
    )

    const perAccountWorkerRole = new Role(this, 'RoleWorker', {
      roleName: perAccountWorkerRoleName,
      assumedBy: new ArnPrincipal('arn:aws:iam::111111111111:role/' + workerRoleName),
      description: 'Role for processing software for instances in this particular account'
    });
    const ssmWorkerInventory = new PolicyStatement({
      actions: ['ssm:ListInventoryEntries'],
      resources: ['*']
    })
    perAccountWorkerRole.attachInlinePolicy(
      new Policy(this, "ssmWorkerInventory", {
        statements: [ssmWorkerInventory]
      })
    )
  }
}