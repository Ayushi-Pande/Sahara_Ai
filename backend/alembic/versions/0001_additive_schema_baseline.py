"""Create the SQLAlchemy schema in a fresh, empty database.

Revision ID: 0001_additive_schema_baseline
Revises:
Create Date: 2026-10-09
"""

from alembic import op

from app import models
from app.database import Base

revision = "0001_additive_schema_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    pass
