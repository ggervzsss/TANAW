from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.password_policy import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    validate_password_policy,
)
from app.features.accounts.schemas import AuthUser


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    loginScope: Literal["web", "enterprise"] = "web"


class LoginResponse(BaseModel):
    token: str
    user: AuthUser


class AccountActivationValidateRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)


class AccountActivationValidateResponse(BaseModel):
    displayName: str
    role: str
    expiresAt: datetime


class AccountActivationCompleteRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    newPassword: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)

    @field_validator("newPassword", mode="before")
    @classmethod
    def validate_new_password(cls, value: object) -> object:
        return validate_password_policy(value) if isinstance(value, str) else value


class AccountActivationCompleteResponse(BaseModel):
    status: Literal["ok"]
    role: str


class AccountEmailChangeVerifyRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)


class AccountEmailChangeVerifyResponse(BaseModel):
    displayName: str
    requestedEmail: EmailStr
    status: Literal["verified"]


class AccountEmailChangeStatusResponse(BaseModel):
    requestId: str
    requestedEmail: EmailStr
    status: Literal["pending_verification", "verified", "expired"]
    isVerified: bool
    expiresAt: datetime


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequestResponse(BaseModel):
    challengeId: str
    expiresInMinutes: int
    resendAvailableInSeconds: int
    message: str


class ForgotPasswordVerifyRequest(BaseModel):
    challengeId: str = Field(min_length=1)
    code: str = Field(min_length=6, max_length=6)


class ForgotPasswordVerifyResponse(BaseModel):
    resetToken: str


class ForgotPasswordResetRequest(BaseModel):
    challengeId: str = Field(min_length=1)
    resetToken: str = Field(min_length=1)
    newPassword: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)

    @field_validator("newPassword", mode="before")
    @classmethod
    def validate_new_password(cls, value: object) -> object:
        return validate_password_policy(value) if isinstance(value, str) else value


class SupportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=10, max_length=1000)


class StatusResponse(BaseModel):
    status: str


class AccountPreferences(BaseModel):
    theme: Literal["light", "dark", "system"] = "system"


class SystemSettingsPayload(BaseModel):
    values: dict[str, str | bool | int]
    updatedBy: str | None = None
    updatedAt: datetime | None = None

    @field_validator("values")
    @classmethod
    def validate_target_settings(
        cls, values: dict[str, str | bool | int]
    ) -> dict[str, str | bool | int]:
        integer_options = {
            "security.loginAttemptLimit": {3, 5, 10},
            "security.loginLockMinutes": {5, 15, 30, 60},
            "logs.retentionDays": {90, 180, 365},
        }
        boolean_keys = {
            "notifications.cameraSessionErrorAlerts",
            "notifications.gatewayServiceErrorAlerts",
            "notifications.syncDelayAlerts",
            "notifications.failedLoginLockoutAlerts",
        }
        expected = set(integer_options) | boolean_keys
        if set(values) != expected:
            raise ValueError("System settings must contain exactly the target setting keys.")
        for key, options in integer_options.items():
            value = values[key]
            if isinstance(value, bool) or not isinstance(value, int) or value not in options:
                raise ValueError(f"Unsupported value for {key}.")
        for key in boolean_keys:
            if not isinstance(values[key], bool):
                raise ValueError(f"{key} must be a boolean.")
        return values
