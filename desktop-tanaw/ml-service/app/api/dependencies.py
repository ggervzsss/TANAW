from fastapi import FastAPI, Request, WebSocket

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.service_settings import ServiceSettings


def registry(source: FastAPI | Request | WebSocket) -> CameraPipelineRegistry:
    application = source if isinstance(source, FastAPI) else source.app
    value = application.state.registry
    if not isinstance(value, CameraPipelineRegistry):
        raise RuntimeError("The camera pipeline registry is not configured.")
    return value


def settings(source: Request | WebSocket) -> ServiceSettings:
    value = source.app.state.settings
    if not isinstance(value, ServiceSettings):
        raise RuntimeError("The ML service settings are not configured.")
    return value
