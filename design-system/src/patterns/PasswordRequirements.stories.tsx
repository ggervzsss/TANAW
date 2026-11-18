import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { PasswordMatchIndicator, PasswordRequirements, type PasswordRequirementStatus } from "./PasswordRequirements";

// A stand-in for the apps' password policy (they pass their real policy's verdict).
const MIN = 12;
const MAX = 128;
const COMMON = new Set(["password1234", "qwertyuiop12"]);
function statusOf(value: string): PasswordRequirementStatus {
  const characterCount = Array.from(value.normalize("NFC")).length;
  return { characterCount, hasValue: characterCount > 0, isLengthValid: characterCount >= MIN && characterCount <= MAX, isNotCommon: characterCount > 0 && !COMMON.has(value.toLowerCase()) };
}

const meta = {
  title: "Patterns/Password requirements",
  component: PasswordRequirements,
  args: { status: statusOf(""), minLength: MIN, maxLength: MAX },
} satisfies Meta<typeof PasswordRequirements>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const TooShort: Story = { args: { status: statusOf("short") } };
export const Met: Story = { args: { status: statusOf("a long passphrase for TANAW") } };

export const NewPasswordForm: Story = {
  render: () => {
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    return (
      <div className="max-w-md space-y-4">
        <div>
          <Field label="New password">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </Field>
          <PasswordRequirements status={statusOf(password)} minLength={MIN} maxLength={MAX} />
        </div>
        <div>
          <Field label="Confirm new password">
            <Input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" />
          </Field>
          <PasswordMatchIndicator password={password} confirmation={confirmation} />
        </div>
      </div>
    );
  },
};
