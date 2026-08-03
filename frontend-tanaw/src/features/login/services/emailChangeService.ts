import { apiClient } from "@/shared/lib/apiClient";

export type EmailChangeVerificationResult = {
  displayName: string;
  requestedEmail: string;
  status: "verified";
};

const verificationRequests = new Map<string, Promise<EmailChangeVerificationResult>>();
const completedVerifications = new Map<string, EmailChangeVerificationResult>();

export async function verifyAccountEmailChange(token: string): Promise<EmailChangeVerificationResult> {
  const normalizedToken = token.trim();
  const completedVerification = completedVerifications.get(normalizedToken);
  if (completedVerification) {
    return completedVerification;
  }

  const activeRequest = verificationRequests.get(normalizedToken);
  if (activeRequest) {
    return activeRequest;
  }

  const request = apiClient
    .post<EmailChangeVerificationResult>("/auth/email-change/verify", { token: normalizedToken })
    .then((response) => {
      completedVerifications.set(normalizedToken, response.data);
      return response.data;
    })
    .finally(() => {
      verificationRequests.delete(normalizedToken);
    });

  verificationRequests.set(normalizedToken, request);
  return request;
}
