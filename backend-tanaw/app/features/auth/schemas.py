from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.password_policy import PASSWORD_MIN_LENGTH, validate_password_policy
from app.features.accounts.schemas import AuthUser


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str
    loginScope: Literal["web", "enterprise"] = "web"


class LoginResponse(BaseModel):
    token: str
    user: AuthUser


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequestResponse(BaseModel):
    challengeId: str
    expiresInMinutes: int


class ForgotPasswordVerifyRequest(BaseModel):
    challengeId: str = Field(min_length=1)
    code: str = Field(min_length=6, max_length=6)


class ForgotPasswordVerifyResponse(BaseModel):
    resetToken: str


class ForgotPasswordResetRequest(BaseModel):
    challengeId: str = Field(min_length=1)
    resetToken: str = Field(min_length=1)
    newPassword: str = Field(min_length=PASSWORD_MIN_LENGTH)

    @field_validator("newPassword")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return validate_password_policy(value)


class SupportInfoResponse(BaseModel):
    supportEmail: str | None
    supportPhone: str | None
    message: str


class SupportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=10, max_length=1000)


class StatusResponse(BaseModel):
    status: str


class AccountPreferences(BaseModel):
    theme: Literal["light", "dark", "system"] = "system"


class SystemSettingsPayload(BaseModel):
    values: dict[str, str | bool]
