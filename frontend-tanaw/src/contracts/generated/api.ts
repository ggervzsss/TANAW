// Generated from FastAPI/Pydantic contracts. Do not edit manually.
export interface paths {
    "/accounts/enterprises": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Enterprise Accounts */
        get: operations["list_enterprise_accounts_accounts_enterprises_get"];
        put?: never;
        /** Create Enterprise Account */
        post: operations["create_enterprise_account_accounts_enterprises_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/accounts/enterprises/location-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search Enterprise Locations */
        get: operations["search_enterprise_locations_accounts_enterprises_location_suggestions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/accounts/enterprises/{account_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Enterprise Account */
        patch: operations["update_enterprise_account_accounts_enterprises__account_id__patch"];
        trace?: never;
    };
    "/accounts/enterprises/{account_id}/profile-change-requests/{request_type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Resolve Enterprise Profile Change Request */
        patch: operations["resolve_enterprise_profile_change_request_accounts_enterprises__account_id__profile_change_requests__request_type__patch"];
        trace?: never;
    };
    "/accounts/lgu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Lgu Accounts */
        get: operations["list_lgu_accounts_accounts_lgu_get"];
        put?: never;
        /** Create Lgu Account */
        post: operations["create_lgu_account_accounts_lgu_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/accounts/lgu/{account_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Lgu Account */
        patch: operations["update_lgu_account_accounts_lgu__account_id__patch"];
        trace?: never;
    };
    "/accounts/{account_id}/activation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resend Activation */
        post: operations["resend_activation_accounts__account_id__activation_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/accounts/{account_id}/email-change-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Resolve Verified Account Email Change Request */
        patch: operations["resolve_verified_account_email_change_request_accounts__account_id__email_change_request_patch"];
        trace?: never;
    };
    "/accounts/{account_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Account Status */
        patch: operations["update_account_status_accounts__account_id__status_patch"];
        trace?: never;
    };
    "/activity-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Activity Logs */
        get: operations["list_activity_logs_activity_logs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/activity-logs/purge-expired": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Purge Expired Logs */
        post: operations["purge_expired_logs_activity_logs_purge_expired_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/account-activation/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Complete Activation */
        post: operations["complete_activation_auth_account_activation_complete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/account-activation/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Validate Activation Link */
        post: operations["validate_activation_link_auth_account_activation_validate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change Password */
        post: operations["change_password_auth_change_password_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/email-change/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify Email Change Link */
        post: operations["verify_email_change_link_auth_email_change_verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/forgot-password/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Forgot Password Request */
        post: operations["forgot_password_request_auth_forgot_password_request_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/forgot-password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Forgot Password Reset */
        post: operations["forgot_password_reset_auth_forgot_password_reset_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/forgot-password/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Forgot Password Verify */
        post: operations["forgot_password_verify_auth_forgot_password_verify_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: operations["logout_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Me */
        get: operations["me_auth_me_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Preferences */
        get: operations["get_preferences_auth_preferences_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Preferences */
        patch: operations["update_preferences_auth_preferences_patch"];
        trace?: never;
    };
    "/auth/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Profile */
        patch: operations["update_profile_auth_profile_patch"];
        trace?: never;
    };
    "/auth/profile/building-capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Building Capacity */
        patch: operations["update_building_capacity_auth_profile_building_capacity_patch"];
        trace?: never;
    };
    "/auth/profile/business-email-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Business Email Change Status */
        get: operations["get_business_email_change_status_auth_profile_business_email_change_get"];
        put?: never;
        /** Request Business Email Change */
        post: operations["request_business_email_change_auth_profile_business_email_change_post"];
        /** Cancel Business Email Change */
        delete: operations["cancel_business_email_change_auth_profile_business_email_change_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/profile/contact-number-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request Contact Number Change */
        post: operations["request_contact_number_change_auth_profile_contact_number_change_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/profile/display-image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Profile Display Image */
        patch: operations["update_profile_display_image_auth_profile_display_image_patch"];
        trace?: never;
    };
    "/auth/profile/lead-admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Lead Admin Name */
        patch: operations["update_lead_admin_name_auth_profile_lead_admin_patch"];
        trace?: never;
    };
    "/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore Session */
        post: operations["restore_session_auth_session_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/support-request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Support Request */
        post: operations["create_support_request_auth_support_request_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/system-settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get System Settings */
        get: operations["get_system_settings_auth_system_settings_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update System Settings */
        patch: operations["update_system_settings_auth_system_settings_patch"];
        trace?: never;
    };
    "/dev/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Dev Deliveries */
        get: operations["get_dev_deliveries_dev_deliveries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dev/deliveries/{delivery_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Dev Delivery */
        get: operations["get_dev_delivery_dev_deliveries__delivery_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        /** Health */
        head: operations["health_health_head"];
        patch?: never;
        trace?: never;
    };
    "/mail/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Email Deliveries */
        get: operations["list_email_deliveries_mail_deliveries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mail/deliveries/{delivery_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Email Delivery */
        get: operations["get_email_delivery_mail_deliveries__delivery_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/mail/deliveries/{delivery_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retry Email Delivery */
        post: operations["retry_email_delivery_mail_deliveries__delivery_id__retry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/maintenance/retention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Retention Status */
        get: operations["get_retention_status_maintenance_retention_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/maintenance/retention/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Run Retention Now */
        post: operations["run_retention_now_maintenance_retention_run_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Alerts */
        get: operations["list_alerts_operational_alerts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/alerts/{alert_code}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Alert Status */
        patch: operations["update_alert_status_operational_alerts__alert_code__status_patch"];
        trace?: never;
    };
    "/operational/desktop/report-submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ingest Desktop Report Submission */
        post: operations["ingest_desktop_report_submission_operational_desktop_report_submissions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/desktop/sample-preparation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Desktop Sample Preparation */
        get: operations["get_desktop_sample_preparation_operational_desktop_sample_preparation_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/desktop/telemetry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ingest Desktop Telemetry */
        post: operations["ingest_desktop_telemetry_operational_desktop_telemetry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/map-enterprises": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Map Enterprises */
        get: operations["list_map_enterprises_operational_map_enterprises_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Notifications */
        get: operations["list_notifications_operational_notifications_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/notifications/enterprise": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Enterprise Notification */
        post: operations["create_enterprise_notification_operational_notifications_enterprise_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/notifications/{notification_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Notification Read Status */
        patch: operations["update_notification_read_status_operational_notifications__notification_id__patch"];
        trace?: never;
    };
    "/operational/reports/enterprises": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Report Enterprises */
        get: operations["list_report_enterprises_operational_reports_enterprises_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/reports/final": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Final Report Submissions */
        get: operations["list_final_report_submissions_operational_reports_final_get"];
        put?: never;
        /** Generate Final Report */
        post: operations["generate_final_report_operational_reports_final_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/reports/final/{report_id}/return-revision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Return Final Report Revision */
        post: operations["return_final_report_revision_operational_reports_final__report_id__return_revision_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/reports/final/{report_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Final Report Workflow Status */
        patch: operations["update_final_report_workflow_status_operational_reports_final__report_id__status_patch"];
        trace?: never;
    };
    "/operational/reports/intake": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Intake Report Submissions */
        get: operations["list_intake_report_submissions_operational_reports_intake_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/reports/intake/{report_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Intake Report Status */
        patch: operations["update_intake_report_status_operational_reports_intake__report_id__status_patch"];
        trace?: never;
    };
    "/operational/telemetry/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Summary */
        get: operations["get_summary_operational_telemetry_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/tickets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Tickets */
        get: operations["list_tickets_operational_tickets_get"];
        put?: never;
        /** Create Enterprise Support Ticket */
        post: operations["create_enterprise_support_ticket_operational_tickets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/tickets/{ticket_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Ticket Detail */
        get: operations["get_ticket_detail_operational_tickets__ticket_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/tickets/{ticket_id}/attachments/{attachment_index}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Ticket Attachment */
        get: operations["get_ticket_attachment_operational_tickets__ticket_id__attachments__attachment_index__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/tickets/{ticket_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Ticket Message */
        post: operations["create_ticket_message_operational_tickets__ticket_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/tickets/{ticket_id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Ticket Status */
        patch: operations["update_ticket_status_operational_tickets__ticket_id__status_patch"];
        trace?: never;
    };
    "/operational/visitor-insights": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Admin Visitor Insights */
        get: operations["get_admin_visitor_insights_operational_visitor_insights_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/ready/email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Email Readiness */
        get: operations["email_readiness_ready_email_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        /** Email Readiness */
        head: operations["email_readiness_ready_email_head"];
        patch?: never;
        trace?: never;
    };
    "/ready/maintenance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Maintenance Readiness */
        get: operations["maintenance_readiness_ready_maintenance_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        /** Maintenance Readiness */
        head: operations["maintenance_readiness_ready_maintenance_head"];
        patch?: never;
        trace?: never;
    };
    "/ready/realtime": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Realtime Readiness */
        get: operations["realtime_readiness_ready_realtime_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        /** Realtime Readiness */
        head: operations["realtime_readiness_ready_realtime_head"];
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** AccountActivationCompleteRequest */
        AccountActivationCompleteRequest: {
            /** Newpassword */
            newPassword: string;
            /** Token */
            token: string;
        };
        /** AccountActivationCompleteResponse */
        AccountActivationCompleteResponse: {
            /** Role */
            role: string;
            /**
             * Status
             * @constant
             */
            status: "ok";
        };
        /** AccountActivationValidateRequest */
        AccountActivationValidateRequest: {
            /** Token */
            token: string;
        };
        /** AccountActivationValidateResponse */
        AccountActivationValidateResponse: {
            /** Displayname */
            displayName: string;
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            /** Role */
            role: string;
        };
        /** AccountChangeRequestResponse */
        AccountChangeRequestResponse: {
            /** Message */
            message: string;
            /** Status */
            status: string;
        };
        /** AccountEmailChangeRequestResolution */
        AccountEmailChangeRequestResolution: {
            /**
             * Action
             * @enum {string}
             */
            action: "approve" | "decline";
        };
        /** AccountEmailChangeStatusResponse */
        AccountEmailChangeStatusResponse: {
            /**
             * Expiresat
             * Format: date-time
             */
            expiresAt: string;
            /** Isverified */
            isVerified: boolean;
            /** Requestid */
            requestId: string;
            /**
             * Requestedemail
             * Format: email
             */
            requestedEmail: string;
            /**
             * Status
             * @enum {string}
             */
            status: "pending_verification" | "verified" | "expired";
        };
        /** AccountEmailChangeVerifyRequest */
        AccountEmailChangeVerifyRequest: {
            /** Token */
            token: string;
        };
        /** AccountEmailChangeVerifyResponse */
        AccountEmailChangeVerifyResponse: {
            /** Displayname */
            displayName: string;
            /**
             * Requestedemail
             * Format: email
             */
            requestedEmail: string;
            /**
             * Status
             * @constant
             */
            status: "verified";
        };
        /** AccountPreferences */
        AccountPreferences: {
            /**
             * Theme
             * @default system
             * @enum {string}
             */
            theme: "light" | "dark" | "system";
        };
        /** AccountProfileChangeRequest */
        AccountProfileChangeRequest: {
            /** Canapprove */
            canApprove: boolean;
            /** Expiresat */
            expiresAt?: string | null;
            /** Isverified */
            isVerified: boolean;
            /** Label */
            label: string;
            /** Requestid */
            requestId?: string | null;
            /** Requestedat */
            requestedAt?: string | null;
            /** Requestedvalue */
            requestedValue: string;
            /**
             * Status
             * @enum {string}
             */
            status: "pending_verification" | "verified" | "pending_review" | "expired";
            /**
             * Type
             * @enum {string}
             */
            type: "businessEmail" | "contactNumber";
        };
        /** AccountStatusUpdate */
        AccountStatusUpdate: {
            /**
             * Status
             * @enum {string}
             */
            status: "active" | "inactive";
        };
        /** AccountSummary */
        AccountSummary: {
            /** Address */
            address: string | null;
            /** Barangay */
            barangay: string | null;
            /** Buildingcapacity */
            buildingCapacity: number;
            /** Category */
            category: string | null;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Displayname */
            displayName: string;
            /** Email */
            email: string;
            /** Enterpriseid */
            enterpriseId: string | null;
            /** Enterprisename */
            enterpriseName: string | null;
            /** Firstname */
            firstName: string | null;
            /** Gatewaystatus */
            gatewayStatus: string | null;
            /** Id */
            id: string;
            /** Isactivated */
            isActivated: boolean;
            /**
             * Isprotecteddefault
             * @default false
             */
            isProtectedDefault: boolean;
            /** Lastloginat */
            lastLoginAt: string | null;
            /** Lastname */
            lastName: string | null;
            /** Latitude */
            latitude: number | null;
            /** Locationupdatedat */
            locationUpdatedAt: string | null;
            /** Longitude */
            longitude: number | null;
            /** Managername */
            managerName: string | null;
            /** Phone */
            phone: string | null;
            /** Profilechangerequests */
            profileChangeRequests?: components["schemas"]["AccountProfileChangeRequest"][];
            /** Role */
            role: string;
            /** Status */
            status: string;
            /** Title */
            title: string;
        };
        /** ActivityLogPurgeResponse */
        ActivityLogPurgeResponse: {
            /** Deletedcount */
            deletedCount: number;
            /** Retentiondays */
            retentionDays: number;
        };
        /** ActivityLogSummary */
        ActivityLogSummary: {
            /** Action */
            action: string;
            /** Actor */
            actor: string;
            /**
             * Actorrole
             * @enum {string}
             */
            actorRole: "Admin" | "IT Personnel" | "LGU Staff" | "Enterprise Account" | "System";
            /**
             * Category
             * @enum {string}
             */
            category: "IT Activity" | "Staff Submission" | "Staff Operation" | "Admin Operation" | "Enterprise Activity" | "System";
            /** Id */
            id: string;
            /** Metadata */
            metadata?: {
                [key: string]: string | number | boolean | null;
            } | null;
            /**
             * Severity
             * @enum {string}
             */
            severity: "Info" | "Warning" | "Critical" | "Success";
            /** Sourceid */
            sourceId?: string | null;
            /** Summary */
            summary: string;
            /** Target */
            target: string;
            /**
             * Timestamp
             * Format: date-time
             */
            timestamp: string;
        };
        /** AuthUser */
        AuthUser: {
            /** Address */
            address?: string | null;
            /** Barangay */
            barangay?: string | null;
            /**
             * Buildingcapacity
             * @default 100
             */
            buildingCapacity: number;
            /** Category */
            category?: string | null;
            /** Displayimagedataurl */
            displayImageDataUrl?: string | null;
            /** Displayname */
            displayName: string;
            /** Email */
            email: string;
            /** Enterpriseid */
            enterpriseId?: string | null;
            /** Enterprisename */
            enterpriseName?: string | null;
            /** Firstname */
            firstName?: string | null;
            /** Id */
            id: string;
            /** Lastname */
            lastName?: string | null;
            /** Managername */
            managerName?: string | null;
            /** Phone */
            phone?: string | null;
            /** Role */
            role: string;
            /** Title */
            title: string;
        };
        /** BuildingCapacityUpdate */
        BuildingCapacityUpdate: {
            /** Buildingcapacity */
            buildingCapacity: number;
        };
        /** BusinessEmailChangeRequest */
        BusinessEmailChangeRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
        };
        /** ContactNumberChangeRequest */
        ContactNumberChangeRequest: {
            /** Phone */
            phone: string;
        };
        /** DeliverySummary */
        DeliverySummary: {
            /** Accountid */
            accountId: string;
            /** Body */
            body: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Id */
            id: string;
            /** Recipient */
            recipient: string;
            /** Status */
            status: string;
            /** Subject */
            subject: string;
        };
        /** DesktopCameraMonitoringItem */
        DesktopCameraMonitoringItem: {
            /** Cameraid */
            cameraId: number;
            /** Cameraname */
            cameraName: string;
            /** Error */
            error?: string | null;
            /**
             * Running
             * @default false
             */
            running: boolean;
            /**
             * Status
             * @enum {string}
             */
            status: "stopped" | "starting" | "running" | "error";
        };
        /** DesktopCameraMonitoringSummary */
        DesktopCameraMonitoringSummary: {
            /**
             * Activecameracount
             * @default 0
             */
            activeCameraCount: number;
            /** Cameras */
            cameras?: components["schemas"]["DesktopCameraMonitoringItem"][];
            /**
             * Configuredcameracount
             * @default 0
             */
            configuredCameraCount: number;
            /**
             * Errorcameracount
             * @default 0
             */
            errorCameraCount: number;
            /**
             * Healthycameracount
             * @default 0
             */
            healthyCameraCount: number;
            /**
             * Startingcameracount
             * @default 0
             */
            startingCameraCount: number;
            /**
             * Status
             * @default not_configured
             * @enum {string}
             */
            status: "not_configured" | "stopped" | "partial" | "running" | "error";
            /**
             * Stoppedcameracount
             * @default 0
             */
            stoppedCameraCount: number;
        };
        /** DesktopHealthSummary */
        DesktopHealthSummary: {
            /** Analyticsfps */
            analyticsFps?: number | null;
            /** Detectorp50Ms */
            detectorP50Ms?: number | null;
            /** Detectorp95Ms */
            detectorP95Ms?: number | null;
            /**
             * Modelready
             * @default false
             */
            modelReady: boolean;
            /** Processingframeagems */
            processingFrameAgeMs?: number | null;
            /**
             * Processingframesskipped
             * @default 0
             */
            processingFramesSkipped: number;
            /** Processingprofile */
            processingProfile?: string | null;
            /**
             * Qualityreidqueuedepth
             * @default 0
             */
            qualityReidQueueDepth: number;
            /**
             * Qualityreidready
             * @default false
             */
            qualityReidReady: boolean;
            /**
             * Reidqueuedepth
             * @default 0
             */
            reidQueueDepth: number;
            /**
             * Reidready
             * @default false
             */
            reidReady: boolean;
        };
        /** DesktopMetricsSummary */
        DesktopMetricsSummary: {
            /**
             * Confirmeduniquecount
             * @default 0
             */
            confirmedUniqueCount: number;
            /**
             * Currentoccupancy
             * @default 0
             */
            currentOccupancy: number;
            /**
             * Degradeduniquecount
             * @default 0
             */
            degradedUniqueCount: number;
            /**
             * Entries
             * @default 0
             */
            entries: number;
            /**
             * Exits
             * @default 0
             */
            exits: number;
            /** Firsteventat */
            firstEventAt?: string | null;
            /** Lasteventat */
            lastEventAt?: string | null;
            /**
             * Peakoccupancy
             * @default 0
             */
            peakOccupancy: number;
            /**
             * Totalevents
             * @default 0
             */
            totalEvents: number;
            /**
             * Uniquecount
             * @default 0
             */
            uniqueCount: number;
            /**
             * Unsubmittedevents
             * @default 0
             */
            unsubmittedEvents: number;
            /**
             * Unsyncedevents
             * @default 0
             */
            unsyncedEvents: number;
        };
        /** DesktopReportSubmissionIngest */
        DesktopReportSubmissionIngest: {
            /**
             * Entries
             * @default 0
             */
            entries: number;
            /**
             * Exits
             * @default 0
             */
            exits: number;
            /** Notes */
            notes?: string | null;
            /** Payload */
            payload?: {
                [key: string]: unknown;
            } | null;
            /**
             * Peakoccupancy
             * @default 0
             */
            peakOccupancy: number;
            /** Period */
            period: string;
            /** Reportid */
            reportId: string;
            /**
             * Submissionid
             * Format: uuid
             */
            submissionId: string;
            /**
             * Submittedat
             * Format: date-time
             */
            submittedAt: string;
            /** Syncstatus */
            syncStatus?: string | null;
            /**
             * Uniquecount
             * @default 0
             */
            uniqueCount: number;
        };
        /** DesktopSessionSummary */
        DesktopSessionSummary: {
            /** Cameraid */
            cameraId?: number | string | null;
            /** Cameraname */
            cameraName?: string | null;
            /** Error */
            error?: string | null;
            /**
             * Running
             * @default false
             */
            running: boolean;
            /**
             * Status
             * @default unknown
             */
            status: string;
            /** Updatedat */
            updatedAt?: string | null;
        };
        /** DesktopTelemetryIngest */
        DesktopTelemetryIngest: {
            /** Capturedat */
            capturedAt?: string | null;
            /** Deviceid */
            deviceId?: string | null;
            health?: components["schemas"]["DesktopHealthSummary"];
            metrics: components["schemas"]["DesktopMetricsSummary"];
            monitoring?: components["schemas"]["DesktopCameraMonitoringSummary"];
            /** Payload */
            payload?: {
                [key: string]: unknown;
            } | null;
            session?: components["schemas"]["DesktopSessionSummary"];
        };
        /** EmailDeliverySummary */
        EmailDeliverySummary: {
            /** Acceptedat */
            acceptedAt: string | null;
            /** Attemptcount */
            attemptCount: number;
            /** Canretry */
            canRetry: boolean;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Errorcode */
            errorCode: string | null;
            /** Failurereason */
            failureReason: string | null;
            /** Id */
            id: string;
            /** Manualretrycount */
            manualRetryCount: number;
            /** Maxattempts */
            maxAttempts: number;
            /** Nextattemptat */
            nextAttemptAt: string | null;
            /** Outcomeuncertain */
            outcomeUncertain: boolean;
            /** Provider */
            provider: string;
            /** Providermessageid */
            providerMessageId: string | null;
            /** Purpose */
            purpose: string;
            /** Recipient */
            recipient: string;
            /** Status */
            status: string;
        };
        /** EnterpriseAccountCreate */
        EnterpriseAccountCreate: {
            /** Address */
            address: string;
            /** Barangay */
            barangay: string;
            /**
             * Buildingcapacity
             * @default 100
             */
            buildingCapacity: number;
            /** Category */
            category: string;
            /** Contactnumber */
            contactNumber?: string | null;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Enterpriseid */
            enterpriseId?: string | null;
            /** Enterprisename */
            enterpriseName: string;
            /** Latitude */
            latitude: number;
            /** Longitude */
            longitude: number;
            /** Managername */
            managerName: string;
        };
        /** EnterpriseAccountUpdate */
        EnterpriseAccountUpdate: {
            /** Address */
            address: string;
            /** Barangay */
            barangay: string;
            /**
             * Buildingcapacity
             * @default 100
             */
            buildingCapacity: number;
            /** Category */
            category: string;
            /** Contactnumber */
            contactNumber?: string | null;
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Latitude */
            latitude?: number | null;
            /** Longitude */
            longitude?: number | null;
            /** Managername */
            managerName: string;
        };
        /** EnterpriseLocationSuggestion */
        EnterpriseLocationSuggestion: {
            /** Addressline */
            addressLine: string;
            /** Barangay */
            barangay?: string | null;
            /** Formattedaddress */
            formattedAddress: string;
            /** Latitude */
            latitude: number;
            /** Longitude */
            longitude: number;
            /** Name */
            name: string;
            /** Placeid */
            placeId: string;
        };
        /** EnterpriseNotificationCreate */
        EnterpriseNotificationCreate: {
            /** Enterpriseid */
            enterpriseId: string;
            /** Message */
            message: string;
            /**
             * Severity
             * @default Warning
             * @enum {string}
             */
            severity: "Info" | "Warning" | "Critical" | "Success";
            /** Sourceid */
            sourceId?: string | null;
            /** Sourcetype */
            sourceType?: string | null;
            /** Title */
            title: string;
            /**
             * Type
             * @default Staff Follow-up
             */
            type: string;
        };
        /** EnterpriseProfileChangeRequestResolution */
        EnterpriseProfileChangeRequestResolution: {
            /**
             * Action
             * @enum {string}
             */
            action: "approve" | "decline";
        };
        /** FinalReportCreate */
        FinalReportCreate: {
            /** Preparedby */
            preparedBy: string;
            /** Reportids */
            reportIds: string[];
        };
        /** FinalReportRevisionReturn */
        FinalReportRevisionReturn: {
            /** Remarks */
            remarks: string;
            /** Sourcereportids */
            sourceReportIds: string[];
        };
        /** FinalReportSourceSummary */
        FinalReportSourceSummary: {
            /** Code */
            code: string;
            demographics?: components["schemas"]["ReportDemographicsSummary"] | null;
            /** Enterprise */
            enterprise: string;
            /** Entry */
            entry: number;
            /** Exit */
            exit: number;
            /** Id */
            id: string;
            /** Unique */
            unique: number;
        };
        /** FinalReportStatusUpdate */
        FinalReportStatusUpdate: {
            /**
             * Status
             * @enum {string}
             */
            status: "Draft" | "Finalized" | "Archived" | "Returned for Revision";
        };
        /** FinalReportSummary */
        FinalReportSummary: {
            /** Archivedfromstatus */
            archivedFromStatus?: ("Draft" | "Finalized" | "Returned for Revision") | null;
            /** Enterprisecount */
            enterpriseCount: number;
            /** Generatedon */
            generatedOn: string;
            /** Id */
            id: string;
            /** Period */
            period: string;
            /** Preparedby */
            preparedBy: string;
            /** Preparedrole */
            preparedRole: string;
            /** Sources */
            sources: components["schemas"]["FinalReportSourceSummary"][];
            /**
             * Status
             * @enum {string}
             */
            status: "Draft" | "Finalized" | "Archived" | "Returned for Revision";
            /** Title */
            title: string;
            /** Totalentry */
            totalEntry: number;
            /** Totalexit */
            totalExit: number;
            /** Totalunique */
            totalUnique: number;
        };
        /** ForgotPasswordRequest */
        ForgotPasswordRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
        };
        /** ForgotPasswordRequestResponse */
        ForgotPasswordRequestResponse: {
            /** Challengeid */
            challengeId: string;
            /** Expiresinminutes */
            expiresInMinutes: number;
            /** Message */
            message: string;
            /** Resendavailableinseconds */
            resendAvailableInSeconds: number;
        };
        /** ForgotPasswordResetRequest */
        ForgotPasswordResetRequest: {
            /** Challengeid */
            challengeId: string;
            /** Newpassword */
            newPassword: string;
            /** Resettoken */
            resetToken: string;
        };
        /** ForgotPasswordVerifyRequest */
        ForgotPasswordVerifyRequest: {
            /** Challengeid */
            challengeId: string;
            /** Code */
            code: string;
        };
        /** ForgotPasswordVerifyResponse */
        ForgotPasswordVerifyResponse: {
            /** Resettoken */
            resetToken: string;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** IntakeReportSummary */
        IntakeReportSummary: {
            /** Barangay */
            barangay: string;
            /** Category */
            category: string;
            /** Code */
            code: string;
            demographics?: components["schemas"]["ReportDemographicsSummary"] | null;
            /** Enterprise */
            enterprise: string;
            /** Enterpriseid */
            enterpriseId: string;
            /** Id */
            id: string;
            /** Metrics */
            metrics: {
                [key: string]: number | string;
            };
            /** Month */
            month: string;
            /** Notes */
            notes?: string | null;
            /** Payload */
            payload?: {
                [key: string]: unknown;
            } | null;
            /** Period */
            period: string;
            /** Remarks */
            remarks?: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "Pending Review" | "Ready to Consolidate" | "Returned" | "Consolidated";
            /** Submitted */
            submitted: string;
            /**
             * Submittedat
             * Format: date-time
             */
            submittedAt: string;
        };
        /** LeadAdminNameUpdate */
        LeadAdminNameUpdate: {
            /** Managername */
            managerName: string;
        };
        /** LguAccountCreate */
        LguAccountCreate: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Firstname */
            firstName: string;
            /** Lastname */
            lastName: string;
            /** Phone */
            phone?: string | null;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "it" | "staff";
        };
        /** LguAccountUpdate */
        LguAccountUpdate: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Firstname */
            firstName: string;
            /** Lastname */
            lastName: string;
            /** Phone */
            phone?: string | null;
            /**
             * Role
             * @enum {string}
             */
            role: "admin" | "it" | "staff";
        };
        /** LoginRequest */
        LoginRequest: {
            /**
             * Loginscope
             * @default web
             * @enum {string}
             */
            loginScope: "web" | "enterprise";
            /** Password */
            password: string;
            /**
             * Rememberme
             * @default false
             */
            rememberMe: boolean;
            /** Username */
            username: string;
        };
        /** LoginResponse */
        LoginResponse: {
            /** Token */
            token: string;
            user: components["schemas"]["AuthUser"];
        };
        /** NotificationReadUpdate */
        NotificationReadUpdate: {
            /**
             * Read
             * @default true
             */
            read: boolean;
        };
        /** OperationalAlertStatusUpdate */
        OperationalAlertStatusUpdate: {
            /**
             * Status
             * @enum {string}
             */
            status: "New" | "In Review" | "Resolved";
        };
        /** OperationalAlertSummary */
        OperationalAlertSummary: {
            /** Enterprise */
            enterprise?: string | null;
            /** Id */
            id: string;
            /**
             * Owner
             * @enum {string}
             */
            owner: "IT" | "Admin" | "System";
            /** Requester */
            requester: string;
            /** Requiredaction */
            requiredAction: string;
            /**
             * Resolutionmode
             * @enum {string}
             */
            resolutionMode: "On-site Visit Required" | "In-system Action" | "Staff Follow-up" | "Remote Review" | "Admin Monitoring";
            /**
             * Severity
             * @enum {string}
             */
            severity: "Info" | "Warning" | "Critical";
            /**
             * Status
             * @enum {string}
             */
            status: "New" | "In Review" | "Resolved";
            /** Summary */
            summary: string;
            /** Time */
            time: string;
            /**
             * Type
             * @enum {string}
             */
            type: "Maintenance Request" | "Password Reset Request" | "Submission Delay" | "Foot Traffic Alert" | "Occupancy Spike" | "Failed Login Threshold";
            /**
             * Urgency
             * @enum {string}
             */
            urgency: "Normal" | "Important" | "Urgent";
        };
        /** OperationalSummary */
        OperationalSummary: {
            /** Activereports */
            activeReports: number;
            /** Delayedgateways */
            delayedGateways: number;
            /** Enterprisecount */
            enterpriseCount: number;
            /** Lastsyncat */
            lastSyncAt?: string | null;
            /** Offlinegateways */
            offlineGateways: number;
            /** Onlinegateways */
            onlineGateways: number;
            /** Pendingreports */
            pendingReports: number;
            /** Totalcurrentoccupancy */
            totalCurrentOccupancy: number;
            /** Totalentries */
            totalEntries: number;
            /** Totalexits */
            totalExits: number;
            /** Totaluniquecount */
            totalUniqueCount: number;
        };
        /** PasswordChangeRequest */
        PasswordChangeRequest: {
            /** Currentpassword */
            currentPassword: string;
            /** Newpassword */
            newPassword: string;
        };
        /** ProfileDisplayImageUpdate */
        ProfileDisplayImageUpdate: {
            /** Displayimagedataurl */
            displayImageDataUrl?: string | null;
        };
        /** ProfileUpdate */
        ProfileUpdate: {
            /** Address */
            address?: string | null;
            /** Displayimagedataurl */
            displayImageDataUrl?: string | null;
            /** Email */
            email: string;
            /** Enterprisename */
            enterpriseName?: string | null;
            /** Firstname */
            firstName?: string | null;
            /** Lastname */
            lastName?: string | null;
            /** Managername */
            managerName?: string | null;
            /** Phone */
            phone?: string | null;
        };
        /** ReportDemographicsSummary */
        ReportDemographicsSummary: {
            /** Foreignfemale */
            foreignFemale: number;
            /** Foreignmale */
            foreignMale: number;
            /** Otherprovfemale */
            otherProvFemale: number;
            /** Otherprovmale */
            otherProvMale: number;
            /** Thisprovfemale */
            thisProvFemale: number;
            /** Thisprovmale */
            thisProvMale: number;
        };
        /** ReportStatusUpdate */
        ReportStatusUpdate: {
            /** Remarks */
            remarks?: string | null;
            /**
             * Status
             * @enum {string}
             */
            status: "Pending Review" | "Ready to Consolidate" | "Returned" | "Consolidated";
        };
        /** RetentionCleanupCountsResponse */
        RetentionCleanupCountsResponse: {
            /** Activationtokens */
            activationTokens: number;
            /** Deletedrecords */
            deletedRecords: number;
            /** Emailchangerequests */
            emailChangeRequests: number;
            /** Emailoutboxrecords */
            emailOutboxRecords: number;
            /** Expiredemailchangerequests */
            expiredEmailChangeRequests: number;
            /** Passwordresetchallenges */
            passwordResetChallenges: number;
            /** Passwordresetratebuckets */
            passwordResetRateBuckets: number;
            /** Telemetrysnapshots */
            telemetrySnapshots: number;
        };
        /** RetentionStatusResponse */
        RetentionStatusResponse: {
            /** Batchsize */
            batchSize: number;
            /** Completedruns */
            completedRuns: number;
            /** Failedruns */
            failedRuns: number;
            /** Intervalseconds */
            intervalSeconds: number;
            /** Lastcompletedat */
            lastCompletedAt: string | null;
            lastCounts: components["schemas"]["RetentionCleanupCountsResponse"];
            /** Lastdurationseconds */
            lastDurationSeconds: number | null;
            /** Lasterror */
            lastError: string | null;
            /** Laststartedat */
            lastStartedAt: string | null;
            /** Running */
            running: boolean;
            /** Telemetrybatchsize */
            telemetryBatchSize: number;
            /** Telemetryretentiondays */
            telemetryRetentionDays: number;
            totalCounts: components["schemas"]["RetentionCleanupCountsResponse"];
            /** Workerready */
            workerReady: boolean;
        };
        /** SamplePreparationCounts */
        SamplePreparationCounts: {
            /** Entries */
            entries: number;
            /** Exits */
            exits: number;
            /** Peakoccupancy */
            peakOccupancy: number;
            /** Period */
            period: string;
            /** Reportid */
            reportId: string;
            /** Uniquecount */
            uniqueCount: number;
        };
        /** SamplePreparationSummary */
        SamplePreparationSummary: {
            counts?: components["schemas"]["SamplePreparationCounts"] | null;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Pendingcounts */
            pendingCounts?: components["schemas"]["SamplePreparationCounts"][];
        };
        /** StatusResponse */
        StatusResponse: {
            /** Status */
            status: string;
        };
        /** SupportRequest */
        SupportRequest: {
            /**
             * Email
             * Format: email
             */
            email: string;
            /** Message */
            message: string;
            /** Name */
            name: string;
        };
        /** SupportTicketAttachmentCreate */
        SupportTicketAttachmentCreate: {
            /** Dataurl */
            dataUrl: string;
            /** Filename */
            fileName: string;
            /**
             * Mediatype
             * @enum {string}
             */
            mediaType: "image/png" | "image/jpeg" | "image/webp";
            /** Sizebytes */
            sizeBytes: number;
        };
        /** SupportTicketAttachmentMetadata */
        SupportTicketAttachmentMetadata: {
            /** Filename */
            fileName: string;
            /** Id */
            id: string;
            /**
             * Mediatype
             * @enum {string}
             */
            mediaType: "image/png" | "image/jpeg" | "image/webp";
            /** Sizebytes */
            sizeBytes: number;
            /** Url */
            url: string;
        };
        /** SupportTicketCreate */
        SupportTicketCreate: {
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["SupportTicketAttachmentCreate"][];
            /** Cameranode */
            cameraNode?: string | null;
            /**
             * Category
             * @enum {string}
             */
            category: "Camera Issue" | "Report Concern" | "Maintenance" | "Account & Security" | "Other";
            /** Description */
            description: string;
            /**
             * Priority
             * @default Normal
             * @enum {string}
             */
            priority: "Low" | "Normal" | "High" | "Urgent";
            /** Subject */
            subject: string;
        };
        /** SupportTicketDetail */
        SupportTicketDetail: {
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["SupportTicketAttachmentMetadata"][];
            /** Cameranode */
            cameraNode?: string | null;
            /** Category */
            category: string;
            /** Code */
            code: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Description */
            description: string;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Id */
            id: string;
            /** Messages */
            messages?: components["schemas"]["SupportTicketMessageSummary"][];
            /** Priority */
            priority: string;
            /**
             * Status
             * @enum {string}
             */
            status: "Open" | "In Review" | "Resolved";
            /** Subject */
            subject: string;
            /** Submittedby */
            submittedBy: string;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
        /** SupportTicketMessageCreate */
        SupportTicketMessageCreate: {
            /** Message */
            message: string;
        };
        /** SupportTicketMessageSummary */
        SupportTicketMessageSummary: {
            /** Authorid */
            authorId: string;
            /** Authorname */
            authorName: string;
            /** Authorrole */
            authorRole: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Id */
            id: string;
            /** Message */
            message: string;
            /** Ticketid */
            ticketId: string;
        };
        /** SupportTicketStatusUpdate */
        SupportTicketStatusUpdate: {
            /**
             * Status
             * @enum {string}
             */
            status: "Open" | "In Review" | "Resolved";
        };
        /** SupportTicketSummary */
        SupportTicketSummary: {
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["SupportTicketAttachmentMetadata"][];
            /** Cameranode */
            cameraNode?: string | null;
            /** Category */
            category: string;
            /** Code */
            code: string;
            /**
             * Createdat
             * Format: date-time
             */
            createdAt: string;
            /** Description */
            description: string;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Id */
            id: string;
            /** Priority */
            priority: string;
            /**
             * Status
             * @enum {string}
             */
            status: "Open" | "In Review" | "Resolved";
            /** Subject */
            subject: string;
            /** Submittedby */
            submittedBy: string;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
        /** SystemSettingsPayload */
        SystemSettingsPayload: {
            /** Updatedat */
            updatedAt?: string | null;
            /** Updatedby */
            updatedBy?: string | null;
            /** Values */
            values: {
                [key: string]: string | boolean | number;
            };
        };
        /** TelemetrySnapshotSummary */
        TelemetrySnapshotSummary: {
            /** Analyticsfps */
            analyticsFps?: number | null;
            /** Barangay */
            barangay?: string | null;
            /** Cameraid */
            cameraId?: string | null;
            /** Cameraname */
            cameraName?: string | null;
            /**
             * Capturedat
             * Format: date-time
             */
            capturedAt: string;
            /** Category */
            category?: string | null;
            /** Confirmeduniquecount */
            confirmedUniqueCount: number;
            /** Currentoccupancy */
            currentOccupancy: number;
            /** Degradeduniquecount */
            degradedUniqueCount: number;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Entries */
            entries: number;
            /** Error */
            error?: string | null;
            /** Exits */
            exits: number;
            /** Gatewaystatus */
            gatewayStatus: string;
            /** Id */
            id: string;
            monitoring?: components["schemas"]["DesktopCameraMonitoringSummary"];
            /** Peakoccupancy */
            peakOccupancy: number;
            /**
             * Receivedat
             * Format: date-time
             */
            receivedAt: string;
            /** Running */
            running: boolean;
            /** Status */
            status: string;
            /** Totalevents */
            totalEvents: number;
            /** Uniquecount */
            uniqueCount: number;
            /** Unsubmittedevents */
            unsubmittedEvents: number;
            /** Unsyncedevents */
            unsyncedEvents: number;
        };
        /** UserNotificationSummary */
        UserNotificationSummary: {
            /** Createdat */
            createdAt: string;
            /** Createdby */
            createdBy?: string | null;
            /** Id */
            id: string;
            /** Message */
            message: string;
            /** Readat */
            readAt?: string | null;
            /** Recipientaccountid */
            recipientAccountId: string;
            /** Recipiententerpriseid */
            recipientEnterpriseId?: string | null;
            /** Recipientrole */
            recipientRole: string;
            /**
             * Severity
             * @enum {string}
             */
            severity: "Info" | "Warning" | "Critical" | "Success";
            /** Sourceid */
            sourceId?: string | null;
            /** Sourcetype */
            sourceType?: string | null;
            /** Title */
            title: string;
            /** Type */
            type: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** VisitorInsightEnterprise */
        VisitorInsightEnterprise: {
            /**
             * Activitylevel
             * @enum {string}
             */
            activityLevel: "Usual" | "Busier Than Usual" | "No Recent Baseline";
            /** Barangay */
            barangay: string;
            /** Currentvisitors */
            currentVisitors: number;
            /** Differencepercent */
            differencePercent?: number | null;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Typicalvisitors */
            typicalVisitors?: number | null;
        };
        /** VisitorInsightPoint */
        VisitorInsightPoint: {
            /** Averagevisitors */
            averageVisitors: number;
            /** Label */
            label: string;
            /** Peakvisitors */
            peakVisitors: number;
            /**
             * Startat
             * Format: date-time
             */
            startAt: string;
        };
        /** VisitorInsightsSummary */
        VisitorInsightsSummary: {
            busiestEnterprise?: components["schemas"]["VisitorInsightEnterprise"] | null;
            /** Busiestperiodlabel */
            busiestPeriodLabel?: string | null;
            /** Comparisonmessage */
            comparisonMessage: string;
            /** Currentvisitors */
            currentVisitors: number;
            /** Differencepercent */
            differencePercent?: number | null;
            /** Lastupdatedat */
            lastUpdatedAt?: string | null;
            /**
             * Range
             * @enum {string}
             */
            range: "today" | "7d" | "30d";
            /** Scopeid */
            scopeId?: string | null;
            /** Scopename */
            scopeName: string;
            /**
             * Scopetype
             * @enum {string}
             */
            scopeType: "city" | "barangay" | "enterprise";
            /** Series */
            series?: components["schemas"]["VisitorInsightPoint"][];
            /** Typicalvisitors */
            typicalVisitors?: number | null;
            /** Unusuallybusy */
            unusuallyBusy?: components["schemas"]["VisitorInsightEnterprise"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_enterprise_accounts_accounts_enterprises_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"][];
                };
            };
        };
    };
    create_enterprise_account_accounts_enterprises_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnterpriseAccountCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    search_enterprise_locations_accounts_enterprises_location_suggestions_get: {
        parameters: {
            query: {
                query: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EnterpriseLocationSuggestion"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_enterprise_account_accounts_enterprises__account_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnterpriseAccountUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_enterprise_profile_change_request_accounts_enterprises__account_id__profile_change_requests__request_type__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
                request_type: "businessEmail" | "contactNumber";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnterpriseProfileChangeRequestResolution"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_lgu_accounts_accounts_lgu_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"][];
                };
            };
        };
    };
    create_lgu_account_accounts_lgu_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LguAccountCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_lgu_account_accounts_lgu__account_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LguAccountUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resend_activation_accounts__account_id__activation_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resolve_verified_account_email_change_request_accounts__account_id__email_change_request_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountEmailChangeRequestResolution"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_account_status_accounts__account_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_activity_logs_activity_logs_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityLogSummary"][];
                };
            };
        };
    };
    purge_expired_logs_activity_logs_purge_expired_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityLogPurgeResponse"];
                };
            };
        };
    };
    complete_activation_auth_account_activation_complete_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountActivationCompleteRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountActivationCompleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    validate_activation_link_auth_account_activation_validate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountActivationValidateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountActivationValidateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    change_password_auth_change_password_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PasswordChangeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    verify_email_change_link_auth_email_change_verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountEmailChangeVerifyRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountEmailChangeVerifyResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    forgot_password_request_auth_forgot_password_request_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForgotPasswordRequestResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    forgot_password_reset_auth_forgot_password_reset_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordResetRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    forgot_password_verify_auth_forgot_password_verify_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForgotPasswordVerifyRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForgotPasswordVerifyResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    login_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    me_auth_me_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthUser"];
                };
            };
        };
    };
    get_preferences_auth_preferences_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountPreferences"];
                };
            };
        };
    };
    update_preferences_auth_preferences_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccountPreferences"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountPreferences"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_profile_auth_profile_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthUser"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_building_capacity_auth_profile_building_capacity_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BuildingCapacityUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthUser"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_business_email_change_status_auth_profile_business_email_change_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountEmailChangeStatusResponse"] | null;
                };
            };
        };
    };
    request_business_email_change_auth_profile_business_email_change_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BusinessEmailChangeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountChangeRequestResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_business_email_change_auth_profile_business_email_change_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountChangeRequestResponse"];
                };
            };
        };
    };
    request_contact_number_change_auth_profile_contact_number_change_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ContactNumberChangeRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccountChangeRequestResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_profile_display_image_auth_profile_display_image_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileDisplayImageUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthUser"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_lead_admin_name_auth_profile_lead_admin_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeadAdminNameUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthUser"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    restore_session_auth_session_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
        };
    };
    create_support_request_auth_support_request_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatusResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_system_settings_auth_system_settings_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsPayload"];
                };
            };
        };
    };
    update_system_settings_auth_system_settings_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SystemSettingsPayload"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SystemSettingsPayload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_dev_deliveries_dev_deliveries_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliverySummary"][];
                };
            };
        };
    };
    get_dev_delivery_dev_deliveries__delivery_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                delivery_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliverySummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    health_health_head: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    list_email_deliveries_mail_deliveries_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailDeliverySummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_email_delivery_mail_deliveries__delivery_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                delivery_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailDeliverySummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    retry_email_delivery_mail_deliveries__delivery_id__retry_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                delivery_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EmailDeliverySummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_retention_status_maintenance_retention_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetentionStatusResponse"];
                };
            };
        };
    };
    run_retention_now_maintenance_retention_run_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RetentionStatusResponse"];
                };
            };
        };
    };
    list_alerts_operational_alerts_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationalAlertSummary"][];
                };
            };
        };
    };
    update_alert_status_operational_alerts__alert_code__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                alert_code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OperationalAlertStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationalAlertSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    ingest_desktop_report_submission_operational_desktop_report_submissions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DesktopReportSubmissionIngest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntakeReportSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_desktop_sample_preparation_operational_desktop_sample_preparation_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SamplePreparationSummary"] | null;
                };
            };
        };
    };
    ingest_desktop_telemetry_operational_desktop_telemetry_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DesktopTelemetryIngest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TelemetrySnapshotSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_map_enterprises_operational_map_enterprises_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    list_notifications_operational_notifications_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserNotificationSummary"][];
                };
            };
        };
    };
    create_enterprise_notification_operational_notifications_enterprise_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnterpriseNotificationCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserNotificationSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_notification_read_status_operational_notifications__notification_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                notification_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationReadUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserNotificationSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_report_enterprises_operational_reports_enterprises_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    }[];
                };
            };
        };
    };
    list_final_report_submissions_operational_reports_final_get: {
        parameters: {
            query?: {
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FinalReportSummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_final_report_operational_reports_final_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinalReportCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FinalReportSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    return_final_report_revision_operational_reports_final__report_id__return_revision_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                report_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinalReportRevisionReturn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FinalReportSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_final_report_workflow_status_operational_reports_final__report_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                report_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FinalReportStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FinalReportSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_intake_report_submissions_operational_reports_intake_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntakeReportSummary"][];
                };
            };
        };
    };
    update_intake_report_status_operational_reports_intake__report_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                report_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntakeReportSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_summary_operational_telemetry_summary_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationalSummary"];
                };
            };
        };
    };
    list_tickets_operational_tickets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportTicketSummary"][];
                };
            };
        };
    };
    create_enterprise_support_ticket_operational_tickets_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportTicketCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportTicketSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_ticket_detail_operational_tickets__ticket_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ticket_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportTicketDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_ticket_attachment_operational_tickets__ticket_id__attachments__attachment_index__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ticket_id: string;
                attachment_index: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_ticket_message_operational_tickets__ticket_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ticket_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportTicketMessageCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportTicketDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_ticket_status_operational_tickets__ticket_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                ticket_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportTicketStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SupportTicketDetail"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_admin_visitor_insights_operational_visitor_insights_get: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d";
                enterpriseId?: string | null;
                barangay?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["VisitorInsightsSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    email_readiness_ready_email_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    email_readiness_ready_email_head: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    maintenance_readiness_ready_maintenance_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    maintenance_readiness_ready_maintenance_head: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    realtime_readiness_ready_realtime_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    realtime_readiness_ready_realtime_head: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
}
