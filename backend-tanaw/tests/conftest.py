"""Register the complete target model graph before isolated SQLAlchemy tests run."""

from app.db import base as target_model_registry

assert target_model_registry.Base.metadata.tables["simulation_runs"] is not None
