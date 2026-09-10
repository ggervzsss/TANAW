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
    rememberMe: bool = False


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
    textSize: Literal["small", "default", "large", "extra-large"] = "default"
    interfaceScale: Literal["compact", "default", "comfortable"] = "default"


class SystemSettingsPayload(BaseModel):
    values: dict[str, str | bool | int]
    updatedBy: str | None = None
    updatedAt: datetime | None = None
