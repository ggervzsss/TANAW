"""Register the complete model graph before isolated SQLAlchemy tests run."""

from app.db import base as model_registry

assert model_registry.Base.metadata.tables["simulation_runs"] is not None
