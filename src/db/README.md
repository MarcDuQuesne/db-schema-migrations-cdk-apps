# Database

This directory is reserved to contain all database logic.
We currently use a RDS database on AWS.
We use sqlalchemy to define the database structure and we use alembic to version control our database.

The following sections detail how to manually use alembic within this project. You can skip to the final section for
instructions on how to use the run_migration script to automate this process.

## Getting Started

Since sqlalchemy and alembic are both python packages you need to create a python environment first. You also need to set the `SQLALCHEMY_URL` environment variable in your session so alembic and sqlalchemy know how to connect to your database. After that is done we can create migration scripts in `./alembic/versions` using the alembic cli.

```sh
# Set up a python environment
virtualenv -p python3.10 venv
source venv/bin/activate
pip install -r requirements.txt

# Set up the environment variables
cp .env.example .env
# After filling in the correct values for your env vars
set -a
source .env
set +a

# Now you're good to go to run database migrations with alembic
alembic revision -m "create user table"
# Change the migration script using op https://alembic.sqlalchemy.org/en/latest/ops.html
alembic upgrade head
alembic current
```

In a migration script the upgrade and downgrade function could look something like this, using the `alembic.op` module:

```python
def upgrade():
    op.create_table(
        'user',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('name', sa.String(50), nullable=False),
        sa.Column('description', sa.Unicode(200)),
    )

def downgrade():
    op.drop_table('user')

```

## Creating migrations scripts

Alembic comes with an amazing feature where it can look at a database definition writtin in a models.py using sqlalchemy and the schema already available in the database. It can the find the differences between these two schemas and create a migration script automatically. This is not 100% fool-proof, but it will help the developer a lot!

So once you have changed `models.py` to accomodate with your new database schema, run the command below to generate a script and update the database.

```sh
# generate a migration script
alembic revision --autogenerate -m "added sample and material table"
```
