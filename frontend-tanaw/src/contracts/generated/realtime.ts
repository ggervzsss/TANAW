// Generated from FastAPI/Pydantic contracts. Do not edit manually.
export const realtimeEventTypes = [
  "support_ticket.created",
  "support_ticket.updated",
  "support_ticket.message.created",
  "support_ticket.status.changed",
  "notification.created",
  "notification.updated",
  "alert.created",
  "alert.updated",
  "alert.status.changed",
  "alert.resolved",
  "alert.reopened",
  "account_request.created",
  "account_request.updated",
  "account_request.approved",
  "account_request.declined",
  "enterprise.created",
  "enterprise.updated",
  "user.created",
  "user.updated",
  "user.status.changed",
  "activity.created",
  "report.created",
  "report.updated",
  "report.processing",
  "report.finalized",
  "report.archived",
  "report.failed",
  "email_delivery.updated",
  "dev_log.created",
  "telemetry.updated",
  "system_setting.updated"
] as const;

export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** RealtimeActor */
        RealtimeActor: {
            /**
             * Role
             * @default null
             */
            role: string | null;
            /**
             * User Id
             * @default null
             */
            user_id: string | null;
        };
        /** RealtimeEnvelope */
        RealtimeEnvelope: {
            /** @default null */
            actor: components["schemas"]["RealtimeActor"] | null;
            /** Event Id */
            event_id: string;
            event_type: components["schemas"]["RealtimeEventType"];
            /**
             * Occurred At
             * Format: date-time
             */
            occurred_at: string;
            payload?: {
                [key: string]: unknown;
            };
            /**
             * Schema Version
             * @default 1
             */
            schema_version: number;
            scope?: components["schemas"]["RealtimeScope"];
            /** Sequence */
            sequence: number;
        };
        /**
         * RealtimeEventType
         * @enum {string}
         */
        RealtimeEventType: "support_ticket.created" | "support_ticket.updated" | "support_ticket.message.created" | "support_ticket.status.changed" | "notification.created" | "notification.updated" | "alert.created" | "alert.updated" | "alert.status.changed" | "alert.resolved" | "alert.reopened" | "account_request.created" | "account_request.updated" | "account_request.approved" | "account_request.declined" | "enterprise.created" | "enterprise.updated" | "user.created" | "user.updated" | "user.status.changed" | "activity.created" | "report.created" | "report.updated" | "report.processing" | "report.finalized" | "report.archived" | "report.failed" | "email_delivery.updated" | "dev_log.created" | "telemetry.updated" | "system_setting.updated";
        /** RealtimeHeartbeat */
        RealtimeHeartbeat: {
            /**
             * Occurred At
             * Format: date-time
             */
            occurred_at: string;
            /**
             * Type
             * @default realtime.heartbeat
             */
            type: string;
        };
        /** RealtimeReady */
        RealtimeReady: {
            /** Heartbeat Seconds */
            heartbeat_seconds: number;
            /** Latest Sequence */
            latest_sequence: number;
            /**
             * Schema Version
             * @default 1
             */
            schema_version: number;
            /**
             * Type
             * @default realtime.ready
             */
            type: string;
        };
        /** RealtimeScope */
        RealtimeScope: {
            /**
             * Enterprise Account Id
             * @default null
             */
            enterprise_account_id: string | null;
            /**
             * Enterprise Id
             * @default null
             */
            enterprise_id: string | null;
            /**
             * Recipient Account Id
             * @default null
             */
            recipient_account_id: string | null;
            /**
             * Report Id
             * @default null
             */
            report_id: string | null;
            /**
             * Ticket Id
             * @default null
             */
            ticket_id: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
