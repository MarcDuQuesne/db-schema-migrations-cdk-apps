#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SchemaMigrationExampleStack } from "../lib/schema-migration-custom-resource-stack";

const app = new cdk.App();
new SchemaMigrationExampleStack(app, "AlembicSchemaMigrationExampleStack", {
  env: {
    account: cdk.Aws.ACCOUNT_ID,
    region: "us-east-1",
  },
});
