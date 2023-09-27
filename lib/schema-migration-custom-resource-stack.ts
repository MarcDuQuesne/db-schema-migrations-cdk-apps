import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import * as python from "@aws-cdk/aws-lambda-python-alpha";
import * as iam from "aws-cdk-lib/aws-iam";

interface CustomResourceConstructProps {
  lambdaFunction: lambda.Function;
  resourceProperties?: { [key: string]: string };
}

export class CustomResourceConstruct extends Construct {
  resourceProvider: cdk.custom_resources.Provider;
  customResource: cdk.CustomResource;

  constructor(scope: Construct, id: string, props: CustomResourceConstructProps) {
    super(scope, id);
    this.resourceProvider = new cdk.custom_resources.Provider(this, `${id}Provider`, {
      onEventHandler: props.lambdaFunction,
    });

    this.customResource = new cdk.CustomResource(this, `Custom::${id}`, {
      serviceToken: this.resourceProvider.serviceToken,
      resourceType: `Custom::${id}`,
      properties: props.resourceProperties ?? {},
    });
  }
}


interface AlembicMigrationsConstructProps {
  vpc: ec2.IVpc;
  dbName: string;
  dbEndpoint: string,
  dbCredentialsArn: string,
  alembicMigrationsEntry: string;
  driver?: string;
}

export class AlembicMigrationsConstruct extends Construct {
  lambdaSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: AlembicMigrationsConstructProps) {
    super(scope, id);

    const alembicMigrationsLayer = new python.PythonLayerVersion(this, "migrations", {
      entry: props.alembicMigrationsEntry,
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_10],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, "LambdaSecurityGroup", {
      // securityGroupName: "lambda-SG",
      vpc: props.vpc,
    });

    const runMigrationsLambda = new python.PythonFunction(this, "RunMigrationsLambda", {
      entry: path.join(__dirname, "../src/db"),
      runtime: lambda.Runtime.PYTHON_3_10,
      index: "lambda_run_migrations.py",
      memorySize: 1024,
      // functionName: "run-migrations",
      timeout: cdk.Duration.minutes(5),
      environment: {
        DB_NAME: props.dbName,
        DB_ENDPOINT: props.dbEndpoint,
        DB_CREDENTIALS_ARN: props.dbCredentialsArn,
        DB_DRIVER: props.driver ?? "mysql+pymysql",
      },
      securityGroups: [this.lambdaSecurityGroup],
      vpc: props.vpc,
    });

    runMigrationsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.dbCredentialsArn],
        effect: iam.Effect.ALLOW,
      })
    );

    // Migration custom resource
    const alembicMigrationsCustomResource = new CustomResourceConstruct(this, "AlembicMigrations", {
      lambdaFunction: runMigrationsLambda,
      resourceProperties: {
        layerVersionArn: alembicMigrationsLayer.layerVersionArn,
      },
    });
  }
}

interface SchemaMigrationExampleStackProps extends cdk.StackProps {}

export class SchemaMigrationExampleStack extends cdk.Stack {
  readonly dbSecurityGroup: ec2.ISecurityGroup;
  readonly dbLambdaSecurityGroup: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: SchemaMigrationExampleStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "VPC", { vpcName: "vpc" });   // 
    const cfnSubnetGroupID = cdk.Fn.importValue("vpc-db-subnet-group-id");
    const subnetGroup = rds.SubnetGroup.fromSubnetGroupName(this, "DBSubnetGroup", cfnSubnetGroupID);

    this.dbSecurityGroup = new ec2.SecurityGroup(this, "dbSG", {
      // securityGroupName: "schemadb-SG",
      vpc: vpc,
      allowAllOutbound: true,
    });

    const databaseCredentials = rds.Credentials.fromGeneratedSecret("dhadmin");
    const databaseName = "db";
    const dbInstance = new rds.DatabaseInstance(this, "DBInstance", {
      databaseName: databaseName,
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0_28 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      credentials: databaseCredentials, // Optional - will default to 'admin' username and generated password
      vpc: vpc,
      subnetGroup: subnetGroup,
      securityGroups: [this.dbSecurityGroup],
      publiclyAccessible: false,
    });

    const alembicMigrations = new AlembicMigrationsConstruct(this, "AlembicMigrations", {
      vpc: vpc,
      dbName: databaseName,
      dbEndpoint: dbInstance.dbInstanceEndpointAddress,
      dbCredentialsArn: dbInstance.secret!.secretFullArn!,
      driver: "mysql+pymysql",
      alembicMigrationsEntry: path.join(__dirname, "../src/db/alembic_scripts"),
    });

    this.dbSecurityGroup.addIngressRule(alembicMigrations.lambdaSecurityGroup, ec2.Port.tcp(3306), "dbLambdas");
  }
}
