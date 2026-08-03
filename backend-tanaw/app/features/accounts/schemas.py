import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.core.password_policy import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    validate_password_policy,
)
from app.features.accounts.options import (
    ENTERPRISE_CATEGORIES,
    SAN_PEDRO_ADDRESS_SUFFIX,
    SAN_PEDRO_BARANGAYS,
)

PHILIPPINE_MOBILE_ERROR = "Enter a valid Philippine mobile number starting with +63."
NAME_ERROR = "Use letters, spaces, hyphen, or apostrophe only."

ProfileChangeRequestType = Literal["businessEmail", "contactNumber"]


class AccountProfileChangeRequest(BaseModel):
    type: ProfileChangeRequestType
    label: str
    requestedValue: str
    requestedAt: str | None = None
    requestId: str | None = None
    status: Literal["pending_verification", "verified", "pending_review", "expired"]
    isVerified: bool
    canApprove: bool
    expiresAt: datetime | None = None


def normalize_email_value(value: str) -> str:
    return value.strip().lower()


def normalize_person_name(value: str) -> str:
    normalized = " ".join(value.strip().split())
    if len(normalized) < 2:
        raise ValueError("Name must be at least 2 characters.")
    if not all(character.isalpha() or character in {" ", "-", "'"} for character in normalized):
        raise ValueError(NAME_ERROR)
    if not any(character.isalpha() for character in normalized):
        raise ValueError(NAME_ERROR)
    return normalized


def normalize_optional_contact_number(value: object) -> str | None:
    if value is None:
        return None

    raw = str(value).strip()
    if not raw:
        return None

    compact = raw.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if "+" in compact and not compact.startswith("+"):
        raise ValueError(PHILIPPINE_MOBILE_ERROR)
    if compact.count("+") > 1:
        raise ValueError(PHILIPPINE_MOBILE_ERROR)

    if compact.startswith("+63"):
        local_digits = compact[3:]
    elif compact.startswith("63"):
        local_digits = compact[2:]
    elif compact.startswith("0"):
        local_digits = compact[1:]
    else:
        local_digits = compact

    if not local_digits.isdigit() or len(local_digits) != 10 or not local_digits.startswith("9"):
        raise ValueError(PHILIPPINE_MOBILE_ERROR)

    return f"+63{local_digits}"


class AuthUser(BaseModel):
    id: str
    email: str
    displayName: str
    role: str
    title: str
    phone: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    enterpriseId: str | None = None
    enterpriseName: str | None = None
    category: str | None = None
    managerName: str | None = None
    barangay: str | None = None
    address: str | None = None
    displayImageDataUrl: str | None = None
    buildingCapacity: int = 100


class LguAccountCreate(BaseModel):
    firstName: str = Field(min_length=2, max_length=60)
    lastName: str = Field(min_length=2, max_length=60)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    role: Literal["admin", "it", "staff"]

    @field_validator("firstName", "lastName")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_person_name(value)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_email_value(value)
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> str | None:
        return normalize_optional_contact_number(value)


class EnterpriseAccountCreate(BaseModel):
    enterpriseName: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=120)
    managerName: str = Field(min_length=1, max_length=120)
    email: EmailStr
    contactNumber: str | None = Field(default=None, max_length=40)
    barangay: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=255)
    enterpriseId: str | None = Field(default=None, max_length=120)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    buildingCapacity: int = Field(default=100, ge=1, le=100_000)

    @field_validator("enterpriseName")
    @classmethod
    def normalize_enterprise_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if len(normalized) < 2:
            raise ValueError("Enterprise name must be at least 2 characters.")
        return normalized

    @field_validator("managerName")
    @classmethod
    def validate_manager_name(cls, value: str) -> str:
        return normalize_person_name(value)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_email_value(value)
        return value

    @field_validator("contactNumber", mode="before")
    @classmethod
    def normalize_contact_number(cls, value: object) -> str | None:
        return normalize_optional_contact_number(value)

    @field_validator("enterpriseId", mode="before")
    @classmethod
    def normalize_enterprise_id(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip() or None
        return value

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in ENTERPRISE_CATEGORIES:
            raise ValueError("Enterprise category is not supported.")
        return normalized

    @field_validator("barangay")
    @classmethod
    def validate_barangay(cls, value: str) -> str:
        normalized = value.strip().lower()
        for barangay in SAN_PEDRO_BARANGAYS:
            if barangay.lower() == normalized:
                return barangay
        raise ValueError("Barangay is not supported.")

    @field_validator("address")
    @classmethod
    def normalize_address(cls, value: str) -> str:
        address = value.strip().rstrip(",")
        if not address:
            raise ValueError("Address is required.")
        if address.lower().endswith(SAN_PEDRO_ADDRESS_SUFFIX.lower()):
            return address
        return f"{address}, {SAN_PEDRO_ADDRESS_SUFFIX}"


class EnterpriseLocationSuggestion(BaseModel):
    placeId: str
    name: str
    formattedAddress: str
    addressLine: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    barangay: str | None = None


class AccountSummary(BaseModel):
    id: str
    email: str
    phone: str | None
    firstName: str | None
    lastName: str | None
    enterpriseName: str | None
    category: str | None
    managerName: str | None
    barangay: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    locationUpdatedAt: datetime | None
    enterpriseId: str | None
    gatewayStatus: str | None
    buildingCapacity: int
    displayName: str
    role: str
    title: str
    status: str
    isActivated: bool
    isProtectedDefault: bool = False
    profileChangeRequests: list[AccountProfileChangeRequest] = Field(default_factory=list)
    createdAt: datetime
    lastLoginAt: datetime | None


class EnterpriseProfileChangeRequestResolution(BaseModel):
    action: Literal["approve", "decline"]


class AccountEmailChangeRequestResolution(BaseModel):
    action: Literal["approve", "decline"]


class AccountStatusUpdate(BaseModel):
    status: Literal["active", "inactive"]


class LguAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    firstName: str = Field(min_length=2, max_length=60)
    lastName: str = Field(min_length=2, max_length=60)
    email: EmailStr
    phone: str | None = Field(default=None, max_length=40)
    role: Literal["admin", "it", "staff"]

    @field_validator("firstName", "lastName")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return normalize_person_name(value)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_email_value(value)
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> str | None:
        return normalize_optional_contact_number(value)


class EnterpriseAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enterpriseName: str = Field(min_length=2, max_length=120)
    category: str = Field(min_length=1, max_length=120)
    managerName: str = Field(min_length=2, max_length=120)
    email: EmailStr
    contactNumber: str | None = Field(default=None, max_length=40)
    barangay: str = Field(min_length=1, max_length=120)
    address: str = Field(min_length=1, max_length=255)
    buildingCapacity: int = Field(default=100, ge=1, le=100_000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def require_coordinate_pair(self) -> EnterpriseAccountUpdate:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self

    @field_validator("enterpriseName")
    @classmethod
    def normalize_enterprise_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if len(normalized) < 2:
            raise ValueError("Enterprise name must be at least 2 characters.")
        return normalized

    @field_validator("managerName")
    @classmethod
    def validate_manager_name(cls, value: str) -> str:
        return normalize_person_name(value)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_email_value(value)
        return value

    @field_validator("contactNumber", mode="before")
    @classmethod
    def normalize_contact_number(cls, value: object) -> str | None:
        return normalize_optional_contact_number(value)

    @field_validator("category")
    @classmethod
    def validate_category(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in ENTERPRISE_CATEGORIES:
            raise ValueError("Enterprise category is not supported.")
        return normalized

    @field_validator("barangay")
    @classmethod
    def validate_barangay(cls, value: str) -> str:
        normalized = value.strip().lower()
        for barangay in SAN_PEDRO_BARANGAYS:
            if barangay.lower() == normalized:
                return barangay
        raise ValueError("Barangay is not supported.")

    @field_validator("address")
    @classmethod
    def normalize_address(cls, value: str) -> str:
        address = value.strip().rstrip(",")
        if not address:
            raise ValueError("Address is required.")
        if address.lower().endswith(SAN_PEDRO_ADDRESS_SUFFIX.lower()):
            return address
        return f"{address}, {SAN_PEDRO_ADDRESS_SUFFIX}"


class DeliverySummary(BaseModel):
    id: str
    accountId: str
    recipient: str
    subject: str
    body: str
    status: str
    createdAt: datetime


class PasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    newPassword: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)

    @field_validator("newPassword", mode="before")
    @classmethod
    def validate_new_password(cls, value: object) -> object:
        return validate_password_policy(value) if isinstance(value, str) else value


class ProfileUpdate(BaseModel):
    firstName: str | None = Field(default=None, min_length=2, max_length=60)
    lastName: str | None = Field(default=None, min_length=2, max_length=60)
    managerName: str | None = Field(default=None, min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    enterpriseName: str | None = Field(default=None, min_length=2, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    displayImageDataUrl: str | None = Field(default=None, max_length=2_800_000)

    @field_validator("firstName", "lastName")
    @classmethod
    def validate_optional_name(cls, value: str | None) -> str | None:
        return normalize_person_name(value) if value is not None else None

    @field_validator("managerName")
    @classmethod
    def validate_optional_manager(cls, value: str | None) -> str | None:
        return normalize_person_name(value) if value is not None else None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_profile_email(cls, value: object) -> str:
        normalized = normalize_email_value(str(value))
        if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized) is None:
            raise ValueError("Enter a valid email address.")
        return normalized

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_profile_phone(cls, value: object) -> str | None:
        return normalize_optional_contact_number(value)

    @field_validator("displayImageDataUrl")
    @classmethod
    def validate_display_image_data_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+", value) is None:
            raise ValueError("Upload a PNG, JPG, or WebP image.")
        return value


class ProfileDisplayImageUpdate(BaseModel):
    displayImageDataUrl: str | None = Field(default=None, max_length=2_800_000)

    @field_validator("displayImageDataUrl")
    @classmethod
    def validate_display_image_data_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if re.fullmatch(r"data:image/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+", value) is None:
            raise ValueError("Upload a PNG, JPG, or WebP image.")
        return value


class LeadAdminNameUpdate(BaseModel):
    managerName: str = Field(min_length=2, max_length=120)

    @field_validator("managerName")
    @classmethod
    def validate_manager_name(cls, value: str) -> str:
        return normalize_person_name(value)


class BuildingCapacityUpdate(BaseModel):
    buildingCapacity: int = Field(ge=1, le=100_000)


class BusinessEmailChangeRequest(BaseModel):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if isinstance(value, str):
            return normalize_email_value(value)
        return value


class ContactNumberChangeRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=40)

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value: object) -> str:
        normalized = normalize_optional_contact_number(value)
        if normalized is None:
            raise ValueError(PHILIPPINE_MOBILE_ERROR)
        return normalized


class AccountChangeRequestResponse(BaseModel):
    status: str
    message: str
