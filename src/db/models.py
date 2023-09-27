"""
Models for the database.
"""
from sqlalchemy import Column, Integer, String
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "user"

    id = Column("id", Integer, primary_key=True)
    name = Column("name", String(256), nullable=False)

class Job(Base):
    __tablename__ = "job"

    id = Column("id", Integer, primary_key=True)
    name = Column("name", String(256), nullable=False)
    user_id = Column("user_id", Integer, nullable=False)