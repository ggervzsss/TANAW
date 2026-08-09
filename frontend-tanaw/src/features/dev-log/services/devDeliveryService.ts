import { queryKeys } from "@/shared/constants/queryKeys";
import { apiClient } from "@/shared/lib/apiClient";

export type DevDelivery = {
  id: string;
  accountId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  createdAt: string;
};

export const devDeliveriesQueryKey = queryKeys.devDeliveries;

export async function listDevDeliveries() {
  const response = await apiClient.get<DevDelivery[]>("/dev/deliveries");
  return response.data;
}
