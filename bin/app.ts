#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Account, Region } from '@example/example-cdk-lib';
import { SoftwareInventoryStack, PerAccountSoftwareInventoryStack } from '../lib/app-stack';

const app = new cdk.App();

const softwareInventoryStack = new SoftwareInventoryStack(app, 'SoftwareInventoryStack', {
  stackName: "SoftwareInventoryStack",
  tags: {
      Owner: "devops@example.com",
      Name: "SoftwareInventory",
      ProductName: "tooling",
      CostCentre: "XXX",
  },
  env: {
      account: Account.EXAMPLE_SHARED_SERVICES_PROD.id,
      region: Region.EU_WEST_1
  }
});

const accounts = [
  Account.EXAMPLE_SHARED_SERVICES_NONPROD,
  Account.EXAMPLE_SHARED_SERVICES_PROD,
  Account.EXAMPLE_APIS_SANDBOX,
  Account.EXAMPLE_APIS_NONPROD,
  Account.EXAMPLE_APIS_PROD,
  Account.EXAMPLE_BUSIDATA_SANDBOX,
  Account.EXAMPLE_BUSIDATA_NONPROD,
  Account.EXAMPLE_BUSIDATA_PROD,
  Account.EXAMPLE_CMS_SANDBOX,
  Account.EXAMPLE_CMS_NONPROD,
  Account.EXAMPLE_CMS_PROD,
  Account.EXAMPLE_DATAGATEWAY_SANDBOX,
  Account.EXAMPLE_DATAGATEWAY_NONPROD,
  Account.EXAMPLE_DATAGATEWAY_PROD,
  Account.EXAMPLE_DATAGATEWAY_MANAGEDDB,
  Account.EXAMPLE_ENTERPRISESERVICES_SANDBOX,
  Account.EXAMPLE_ENTERPRISESERVICES_NONPROD,
  Account.EXAMPLE_ENTERPRISESERVICES_PROD,
  Account.EXAMPLE_INTELLIGENTDATA_SANDBOX,
  Account.EXAMPLE_INTELLIGENTDATA_NONPROD,
  Account.EXAMPLE_INTELLIGENTDATA_PROD,
  Account.EXAMPLE_CX_NONPROD,
  Account.EXAMPLE_CX_PROD,
  Account.EXAMPLE_DAI_YMS,
  Account.EXAMPLE_DX,
  Account.EXAMPLE_INTEGRATION_DEV,
  Account.EXAMPLE_SECURITY_PROD
]

for (let i=0; i<accounts.length; i++) {
  const perAccountSoftwareInventoryStack = new PerAccountSoftwareInventoryStack(app, 'PerAccountSoftwareInventoryStack-' + accounts[i].name, {
      stackName: "PerAccountSoftwareInventoryStack",
      tags: {
          Owner: "devops@example.com",
          Name: "SoftwareInventory",
          ProductName: "tooling",
          CostCentre: "XXX",
      },
      env: {
          account: accounts[i].id,
          region: Region.EU_WEST_1
      }
  })
  perAccountSoftwareInventoryStack.addDependency(softwareInventoryStack)
}