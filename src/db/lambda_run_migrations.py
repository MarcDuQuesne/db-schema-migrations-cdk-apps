"""
This lambda can be used to run data migrations. Can be triggered by cloudformation as custom resource.
"""

import json
import logging
import os
from typing import Dict

import boto3
import cfnresponse

logging.getLogger().setLevel(logging.INFO)

def create_sql_alchemy_url(db_credentials_arn: str, db_endpoint: str, db_name: str, driver: str = 'mysql+pymysql', port: str = '3306') -> str:
    secret_manager = boto3.client("secretsmanager", region_name="eu-west-1")
    db_secret = secret_manager.get_secret_value(SecretId=db_credentials_arn)
    secret_string = json.loads(db_secret.get("SecretString", ""))
    db_username = secret_string.get("username", "")
    db_password = secret_string.get("password", "")

    if not secret_string:
        raise Exception("Secret string is empty! Check secret manager.")

    # build a SQLAlchemy URL from the secret
    return f"{driver}://{db_username}:{db_password}@{db_endpoint}:{port}/{db_name}"

def handler(event: Dict, context: Dict) -> Dict:
    """
    This lambda can be used to run data migrations. Can be triggered by cloudformation as custom resource.
    """

    try:
        assert 'DB_NAME' in os.environ, "DB_NAME must be set in environment variables"
        assert 'DB_ENDPOINT' in os.environ, "DB_NAME must be set in environment variables"
        assert 'DB_CREDENTIALS_ARN' in os.environ, "DB_CREDENTIALS_ARN must be set in environment variables"
        assert "RequestType" in event, "RequestType must be set in event"
        request_type = event.get("RequestType")
    except KeyError as exc:
        raise ValueError("env not correctly set up.") from exc

    sqlalchemy_url = create_sql_alchemy_url(db_credentials_arn=os.environ["DB_CREDENTIALS_ARN"],
                                            db_endpoint=os.environ["DB_ENDPOINT"],
                                            db_name=os.environ["DB_NAME"],
                                            port=os.environ.get("DB_PORT", "3306"),
                                            driver=os.environ.get("DB_DRIVER", "mysql+pymysql"))

    response_payload = {"event": event, "context": context, "responseStatus": cfnresponse.SUCCESS, "physicalResourceId": "AlembicMigrationsResource" }

    # We first handle the delete request, as there is nothing to do here
    if request_type == 'Delete':
        # Nothing to do here
        status = 200
        output = 'Delete succeeded'
        response_payload.update({"responseData": {"Response": "Delete succeeded."}})
        return {"statusCode": status, "body": output}

    # We now handle the create and update requests. In both cases we need to run a migration; we only need to
    # rollback if we are updating and the new version is lower than the old version
    if request_type == 'Create':
        rollback = False
    elif request_type == 'Update':
        rollback = int(
            event["ResourceProperties"]["layerVersionArn"].split(":")[-1]) < int(event["OldResourceProperties"]["layerVersionArn"].split(":")[-1])

    # Import must be done after setting environment variable
    os.environ["SQLALCHEMY_URL"] = sqlalchemy_url

    try:

        import alembic.config  # pylint: disable=import-outside-toplevel
        import models

        if rollback:
            logging.info('Performing a downgrade.')
            alembic.config.main(argv=[
                "downgrade",
                "-1"
            ])
        else:
            logging.info('Performing an upgrade.')
            alembic.config.main(argv=[
                "upgrade",
                "head"])

        # models.Base.metadata.create_all(models.engine)

        status = 200
        response_payload.update({"responseData": {"Response": f"{request_type} succeeded."}})
        output = f"Migration (rollback: {rollback}) succeeded"

    except BaseException as err:  # pylint: disable=broad-except
        output = str(err)
        status = 500
        logging.error(output)
        response_payload.update({"responseStatus": cfnresponse.FAILED, "responseData": {}})

    if "manual_event" in event:  # Add manual_event for testing.
        return {"statusCode": status, "body": output}

    cfnresponse.send(**response_payload)   # this is only possible if the event contains additional variables, added by cloudformation
    if status == 500:
        raise RuntimeError(output)