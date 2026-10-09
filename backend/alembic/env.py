from logging.config import fileConfig

from alembic import context
from sqlalchemy import inspect
from sqlalchemy.engine import Connection

from app import models
from app.database import Base, engine, settings, sqlalchemy_database_url

config = context.config
config.set_main_option(
    "sqlalchemy.url",
    sqlalchemy_database_url(settings.database_url).replace("%", "%%"),
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("alembic_version") and inspector.get_table_names():
        raise RuntimeError(
            "Refusing to initialize an unversioned database containing tables. "
            "Review its schema and data before choosing a migration strategy."
        )

    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        run_migrations(supplied_connection)
        return

    with engine.connect() as connection:
        with connection.begin():
            run_migrations(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
