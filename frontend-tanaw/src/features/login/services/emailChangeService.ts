import { apiClient } from "@/shared/lib/apiClient";

export type EmailChangeVerificationResult = {
  displayName: string;
  requestedEmail: string;
  status: "verified";
};

export async function verifyAccountEmailChange(token: string): Promise<EmailChangeVerificationResult> {
  const response = await apiClient.post<EmailChangeVerificationResult>("/auth/email-change/verify", { token });
  return response.data;
}
