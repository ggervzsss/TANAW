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
    "/accounts/enterprises/{account_id}/closures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Enterprise Closures */
        get: operations["list_enterprise_closures_accounts_enterprises__account_id__closures_get"];
        put?: never;
        /** Add Enterprise Closure */
        post: operations["add_enterprise_closure_accounts_enterprises__account_id__closures_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/accounts/enterprises/{account_id}/closures/{closure_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Enterprise Closure */
        delete: operations["remove_enterprise_closure_accounts_enterprises__account_id__closures__closure_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
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
    "/auth/profile/closures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Own Closures */
        get: operations["list_own_closures_auth_profile_closures_get"];
        put?: never;
        /** Add Own Closure */
        post: operations["add_own_closure_auth_profile_closures_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/profile/closures/{closure_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Own Closure */
        delete: operations["remove_own_closure_auth_profile_closures__closure_id__delete"];
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
    "/auth/profile/enterprise-name-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request Enterprise Name Change */
        post: operations["request_enterprise_name_change_auth_profile_enterprise_name_change_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/auth/profile/opening-hours": {
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
        /** Update Own Opening Hours */
        patch: operations["update_own_opening_hours_auth_profile_opening_hours_patch"];
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
        /**
         * Create Support Request
         * @description The sign-in page's Contact support form: a Sign-in help request for IT.
         */
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
        /**
         * List Alerts
         * @description Every alert happening now: busier than usual, and cameras not counting.
         */
        get: operations["list_alerts_operational_alerts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/desktop/backup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Enterprise Desktop Backup */
        get: operations["get_enterprise_desktop_backup_operational_desktop_backup_get"];
        /** Save Enterprise Desktop Backup */
        put: operations["save_enterprise_desktop_backup_operational_desktop_backup_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/desktop/connection-gap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Report Connection Gap
         * @description The desktop app reports, once it reconnects, how long it could not reach TANAW.
         */
        post: operations["report_connection_gap_operational_desktop_connection_gap_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/desktop/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Report Desktop Event */
        post: operations["report_desktop_event_operational_desktop_events_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
    "/operational/requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Request Summaries */
        get: operations["list_request_summaries_operational_requests_get"];
        put?: never;
        /** Send Request */
        post: operations["send_request_operational_requests_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Read Requests */
        post: operations["read_requests_operational_requests_read_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Request */
        get: operations["get_request_operational_requests__request_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}/attachments/{attachment_index}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Request Attachment */
        get: operations["get_request_attachment_operational_requests__request_id__attachments__attachment_index__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}/group": {
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
        /** Move Request */
        patch: operations["move_request_operational_requests__request_id__group_patch"];
        trace?: never;
    };
    "/operational/requests/{request_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reply To Request */
        post: operations["reply_to_request_operational_requests__request_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Note For It */
        post: operations["add_note_for_it_operational_requests__request_id__notes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reopen */
        post: operations["reopen_operational_requests__request_id__reopen_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/operational/requests/{request_id}/status": {
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
        /** Change Request Status */
        patch: operations["change_request_status_operational_requests__request_id__status_patch"];
        trace?: never;
    };
    "/operational/requests/{request_id}/urgent": {
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
        /** Flag Request */
        patch: operations["flag_request_operational_requests__request_id__urgent_patch"];
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
    "/operational/visitor-insights/ranking": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Admin Visitor Ranking
         * @description Visitors per enterprise for a date range, from monthly reports and camera counts.
         */
        get: operations["get_admin_visitor_ranking_operational_visitor_insights_ranking_get"];
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
        /** AccountChangeSummary */
        AccountChangeSummary: {
            /** Canapprove */
            canApprove: boolean;
            /** Currentvalue */
            currentValue?: string | null;
            /**
             * Field
             * @enum {string}
             */
            field: "businessEmail" | "contactNumber" | "enterpriseName";
            /** Label */
            label: string;
            /** Requestedvalue */
            requestedValue: string;
            /** Verification */
            verification?: ("pending_verification" | "verified" | "expired") | null;
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
             * Interfacescale
             * @default default
             * @enum {string}
             */
            interfaceScale: "compact" | "default" | "comfortable";
            /**
             * Textsize
             * @default default
             * @enum {string}
             */
            textSize: "small" | "default" | "large" | "extra-large";
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
            type: "businessEmail" | "contactNumber" | "enterpriseName";
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
            attraction?: components["schemas"]["AttractionClassification"] | null;
            /** Attractiondescription */
            attractionDescription?: string | null;
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
            openingHours?: components["schemas"]["OpeningHours"] | null;
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
             * Group
             * @enum {string}
             */
            group: "Login & Security" | "Accounts" | "Reports" | "Requests" | "Monitoring" | "Settings & Maintenance";
            /** Id */
            id: string;
            /** Itdetail */
            itDetail?: string | null;
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
        /** AttractionClassification */
        AttractionClassification: {
            /** Category */
            category: string;
            /** Code */
            code: string;
            /** Ntdpcode */
            ntdpCode: string;
            /** Portfoliocategory */
            portfolioCategory: string;
            /** Type */
            type: string;
            /** Typecode */
            typeCode: string;
        };
        /** AuthUser */
        AuthUser: {
            /** Address */
            address?: string | null;
            attraction?: components["schemas"]["AttractionClassification"] | null;
            /** Attractiondescription */
            attractionDescription?: string | null;
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
            openingHours?: components["schemas"]["OpeningHours"] | null;
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
        /** ClosureCreate */
        ClosureCreate: {
            /**
             * Enddate
             * Format: date
             */
            endDate: string;
            /** Reason */
            reason?: string | null;
            /**
             * Startdate
             * Format: date
             */
            startDate: string;
        };
        /** ClosureSummary */
        ClosureSummary: {
            /** Createdby */
            createdBy: string;
            /**
             * Enddate
             * Format: date
             */
            endDate: string;
            /** Id */
            id: string;
            /** Reason */
            reason?: string | null;
            /**
             * Startdate
             * Format: date
             */
            startDate: string;
        };
        /** ContactNumberChangeRequest */
        ContactNumberChangeRequest: {
            /** Phone */
            phone: string;
        };
        /** DayHours */
        DayHours: {
            /**
             * Day
             * @enum {string}
             */
            day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
            /**
             * Mode
             * @enum {string}
             */
            mode: "closed" | "open24h" | "hours";
            /** Periods */
            periods?: components["schemas"]["OpeningPeriod"][];
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
        /** DesktopBackup */
        DesktopBackup: {
            /** Baserevision */
            baseRevision?: number | null;
            /** Cameras */
            cameras?: components["schemas"]["DesktopBackupCamera"][];
            /**
             * Capturedat
             * Format: date-time
             */
            capturedAt: string;
            /** Days */
            days?: components["schemas"]["DesktopBackupDay"][];
            /** Deviceid */
            deviceId?: string | null;
            /** Drafts */
            drafts?: components["schemas"]["DesktopBackupDraft"][];
            /** Enterpriseid */
            enterpriseId: string;
            /**
             * Receivedat
             * Format: date-time
             */
            receivedAt: string;
            /** Revision */
            revision: number;
            /**
             * Schemaversion
             * @constant
             */
            schemaVersion: 1;
            /** Submissions */
            submissions?: components["schemas"]["DesktopBackupSubmission"][];
        };
        /**
         * DesktopBackupCamera
         * @description The camera settings allowed to leave the desktop.
         *
         *     Usernames, passwords, and stream-address parts that could hold a secret are
         *     not fields here, so a backup carrying them is refused rather than stored.
         */
        DesktopBackupCamera: {
            /** Analysismode */
            analysisMode?: ("entrance_exit" | "open_space") | null;
            /**
             * Camerabrand
             * @default tapo
             * @enum {string}
             */
            cameraBrand: "tapo" | "tenda" | "dahua" | "custom";
            /**
             * Camerahost
             * Format: ipv4
             */
            cameraHost: string;
            /** Confidence */
            confidence: number;
            config: components["schemas"]["DesktopBackupCameraConfig"];
            /** Connectionprofile */
            connectionProfile?: ("channel" | "channel_ampersand" | "profile" | "h264" | "manual") | null;
            /** Id */
            id: number;
            /** Name */
            name: string;
            openSpace?: components["schemas"]["DesktopBackupOpenSpace"] | null;
            /**
             * Processingprofile
             * @enum {string}
             */
            processingProfile: "auto" | "compatibility" | "balanced" | "high_accuracy" | "emergency";
            /** Reidmode */
            reidMode?: ("auto" | "off" | "fast" | "quality") | null;
            /** Rtsp */
            rtsp: string;
            /** Rtspstream */
            rtspStream?: ("stream1" | "stream2") | null;
            /** Trackingconfidence */
            trackingConfidence?: number | null;
            /** Uniquecountingmode */
            uniqueCountingMode?: ("entry_only" | "estimated_reid") | null;
            /**
             * Zone
             * @default
             */
            zone: string;
        };
        /** DesktopBackupCameraConfig */
        DesktopBackupCameraConfig: {
            /** Reverse */
            reverse?: boolean | null;
            roi?: components["schemas"]["DesktopBackupRegion"] | null;
            /** Tripwire */
            tripwire?: number | null;
            tripwires?: components["schemas"]["DesktopBackupTripwires"] | null;
        };
        /** DesktopBackupCameraTotal */
        DesktopBackupCameraTotal: {
            /** Cameraid */
            cameraId?: number | null;
            /** Cameraname */
            cameraName?: string | null;
            /** Entries */
            entries: number;
            /** Exits */
            exits: number;
            /** Peakoccupancy */
            peakOccupancy: number;
            /** Uniquecount */
            uniqueCount: number;
        };
        /**
         * DesktopBackupDay
         * @description One day's totals from the desktop's daily summary, as the desktop computed them.
         */
        DesktopBackupDay: {
            /**
             * Businessdate
             * Format: date
             */
            businessDate: string;
            /** Finalized */
            finalized: boolean;
            /** Metrics */
            metrics: {
                [key: string]: unknown;
            };
        };
        /** DesktopBackupDraft */
        DesktopBackupDraft: {
            /** Draftkey */
            draftKey: string;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Period */
            period: string;
            /** Reportid */
            reportId?: string | null;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
        };
        /** DesktopBackupOpenSpace */
        DesktopBackupOpenSpace: {
            /** Boundary Tolerance */
            boundary_tolerance?: number | null;
            /** Entry Confirmation Seconds */
            entry_confirmation_seconds?: number | null;
            /** Exit Confirmation Seconds */
            exit_confirmation_seconds?: number | null;
            /** Gap Grace Seconds */
            gap_grace_seconds?: number | null;
            /** Minimum Visit Seconds */
            minimum_visit_seconds?: number | null;
            /** Polygon */
            polygon: components["schemas"]["DesktopBackupPoint"][];
            /** Zone Id */
            zone_id: string;
            /** Zone Name */
            zone_name: string;
        };
        /** DesktopBackupPoint */
        DesktopBackupPoint: {
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** DesktopBackupRegion */
        DesktopBackupRegion: {
            /** Height */
            height: number;
            /** Left */
            left: number;
            /** Top */
            top: number;
            /** Width */
            width: number;
        };
        /**
         * DesktopBackupSubmission
         * @description A submitted report still waiting to reach the server, kept with its original IDs.
         *
         *     Restoring it with the same ``submissionId`` keeps the eventual upload idempotent.
         */
        DesktopBackupSubmission: {
            /** Camerabreakdown */
            cameraBreakdown?: components["schemas"]["DesktopBackupCameraTotal"][];
            /** Entries */
            entries?: number | null;
            /** Exits */
            exits?: number | null;
            /** Notes */
            notes?: string | null;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
            /** Peakoccupancy */
            peakOccupancy?: number | null;
            /** Period */
            period: string;
            /** Reportid */
            reportId: string;
            /** Submissionid */
            submissionId: string;
            /**
             * Submittedat
             * Format: date-time
             */
            submittedAt: string;
            /**
             * Uniquecount
             * @default 0
             */
            uniqueCount: number;
        };
        /** DesktopBackupSummary */
        DesktopBackupSummary: {
            /** Cameras */
            cameras: number;
            /**
             * Capturedat
             * Format: date-time
             */
            capturedAt: string;
            /** Days */
            days: number;
            /** Deviceid */
            deviceId?: string | null;
            /** Drafts */
            drafts: number;
            /**
             * Receivedat
             * Format: date-time
             */
            receivedAt: string;
            /** Revision */
            revision: number;
            /** Submissions */
            submissions: number;
        };
        /** DesktopBackupTripwire */
        DesktopBackupTripwire: {
            /** Curve */
            curve?: ("linear" | "smooth") | null;
            end: components["schemas"]["DesktopBackupPoint"];
            /** Points */
            points?: components["schemas"]["DesktopBackupPoint"][] | null;
            /** Sampledpoints */
            sampledPoints?: components["schemas"]["DesktopBackupPoint"][] | null;
            start: components["schemas"]["DesktopBackupPoint"];
        };
        /** DesktopBackupTripwires */
        DesktopBackupTripwires: {
            entry: components["schemas"]["DesktopBackupTripwire"];
            exit: components["schemas"]["DesktopBackupTripwire"];
        };
        /**
         * DesktopBackupUpload
         * @description Unsubmitted report data and camera settings, without passwords or raw tracking data.
         */
        DesktopBackupUpload: {
            /** Baserevision */
            baseRevision: number | null;
            /** Cameras */
            cameras?: components["schemas"]["DesktopBackupCamera"][];
            /**
             * Capturedat
             * Format: date-time
             */
            capturedAt: string;
            /** Days */
            days?: components["schemas"]["DesktopBackupDay"][];
            /** Deviceid */
            deviceId?: string | null;
            /** Drafts */
            drafts?: components["schemas"]["DesktopBackupDraft"][];
            /**
             * Schemaversion
             * @constant
             */
            schemaVersion: 1;
            /** Submissions */
            submissions?: components["schemas"]["DesktopBackupSubmission"][];
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
        /**
         * DesktopConnectionGap
         * @description A period the desktop app could not reach TANAW, reported once it reconnects.
         */
        DesktopConnectionGap: {
            /** Apprunning */
            appRunning: boolean;
            /**
             * Endedat
             * Format: date-time
             */
            endedAt: string;
            /**
             * Startedat
             * Format: date-time
             */
            startedAt: string;
        };
        /**
         * DesktopEvent
         * @description Something the enterprise changed in the desktop app, recorded in Activity.
         */
        DesktopEvent: {
            /** Cameraname */
            cameraName?: string | null;
            /** Detail */
            detail?: string | null;
            /**
             * Type
             * @enum {string}
             */
            type: "camera_added" | "camera_removed" | "camera_changed" | "counting_area_changed" | "local_data_reset";
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
            /** Currentoccupancy */
            currentOccupancy?: number | null;
            /**
             * Degradeduniquecount
             * @default 0
             */
            degradedUniqueCount: number;
            /** Entries */
            entries?: number | null;
            /** Exits */
            exits?: number | null;
            /** Firsteventat */
            firstEventAt?: string | null;
            /** Lasteventat */
            lastEventAt?: string | null;
            /** Peakoccupancy */
            peakOccupancy?: number | null;
            /**
             * Totalevents
             * @default 0
             */
            totalEvents: number;
            /** Uniquecount */
            uniqueCount?: number | null;
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
            /** Entries */
            entries: number | null;
            /** Exits */
            exits: number | null;
            /** Notes */
            notes?: string | null;
            /**
             * Payload
             * @description Frozen establishment counting snapshot, matching metrics, and demographic allocation.
             */
            payload: {
                [key: string]: unknown;
            };
            /** Peakoccupancy */
            peakOccupancy: number | null;
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
            /** Uniquecount */
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
            /**
             * Attractioncode
             * @description Three-digit DOT attraction code from the April 2021 Annex B catalog.
             */
            attractionCode: string;
            /** Attractiondescription */
            attractionDescription?: string | null;
            /** Barangay */
            barangay: string;
            /**
             * Buildingcapacity
             * @default 100
             */
            buildingCapacity: number;
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
            openingHours?: components["schemas"]["OpeningHours"];
        };
        /** EnterpriseAccountUpdate */
        EnterpriseAccountUpdate: {
            /** Address */
            address: string;
            /**
             * Attractioncode
             * @description Three-digit DOT attraction code from the April 2021 Annex B catalog.
             */
            attractionCode: string;
            /** Attractiondescription */
            attractionDescription?: string | null;
            /** Barangay */
            barangay: string;
            /**
             * Buildingcapacity
             * @default 100
             */
            buildingCapacity: number;
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
            openingHours?: components["schemas"]["OpeningHours"] | null;
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
        /** EnterpriseNameChangeRequest */
        EnterpriseNameChangeRequest: {
            /** Enterprisename */
            enterpriseName: string;
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
            /** Attractioncode */
            attractionCode: string;
            /** Code */
            code: string;
            /** Counting */
            counting?: {
                [key: string]: unknown;
            } | null;
            demographics?: components["schemas"]["ReportDemographicsSummary"] | null;
            /** Enterprise */
            enterprise: string;
            /** Enterpriseprofileid */
            enterpriseProfileId: string;
            /** Entry */
            entry: number | null;
            /** Exit */
            exit: number | null;
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
            totalEntry: number | null;
            /** Totalexit */
            totalExit: number | null;
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
            attraction: components["schemas"]["AttractionClassification"];
            /** Attractiondescription */
            attractionDescription?: string | null;
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
                [key: string]: number | string | null;
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
        /** MapEnterpriseAlert */
        MapEnterpriseAlert: {
            /** Camera */
            camera?: string | null;
            /**
             * Startedat
             * Format: date-time
             */
            startedAt: string;
            /** Summary */
            summary: string;
            /**
             * Type
             * @enum {string}
             */
            type: "Busier Than Usual" | "Camera Not Counting";
        };
        /** MapEnterpriseSummary */
        MapEnterpriseSummary: {
            /** Alerts */
            alerts?: components["schemas"]["MapEnterpriseAlert"][];
            /** Barangay */
            barangay: string;
            /** Cameramonitoring */
            cameraMonitoring?: {
                [key: string]: unknown;
            } | null;
            /** Category */
            category: string;
            /** Closedreason */
            closedReason?: string | null;
            /** Contact */
            contact: string;
            /** Estimateduniquecount */
            estimatedUniqueCount?: number | null;
            /** Fulladdress */
            fullAddress: string;
            /** Gatewaystatus */
            gatewayStatus: string;
            /** Id */
            id: string;
            /** Lastsync */
            lastSync?: string | null;
            /** Lat */
            lat?: number | null;
            /** Lng */
            lng?: number | null;
            /** Monitoringstatus */
            monitoringStatus: string;
            /** Name */
            name: string;
            /** Occupancystatus */
            occupancyStatus: string;
            /** Offlinesince */
            offlineSince?: string | null;
            /** Opennow */
            openNow: boolean;
            /**
             * Pinstate
             * @enum {string}
             */
            pinState: "normal" | "busy" | "camera" | "offline" | "closed";
            /** Totalliveoccupancy */
            totalLiveOccupancy?: number | null;
        };
        /** NotificationReadUpdate */
        NotificationReadUpdate: {
            /**
             * Read
             * @default true
             */
            read: boolean;
        };
        /** OpeningHours */
        OpeningHours: {
            /** Days */
            days: components["schemas"]["DayHours"][];
        };
        /** OpeningPeriod */
        OpeningPeriod: {
            /** Close */
            close: string;
            /** Open */
            open: string;
        };
        /**
         * OperationalAlertSummary
         * @description A live alert, as the topbar alert icon, the map and the Alerts section show it.
         */
        OperationalAlertSummary: {
            /** Camera */
            camera?: string | null;
            /** Detail */
            detail?: string | null;
            /** Endedat */
            endedAt?: string | null;
            /** Enterpriseid */
            enterpriseId?: string | null;
            /** Enterprisename */
            enterpriseName?: string | null;
            /** Id */
            id: string;
            /**
             * Severity
             * @enum {string}
             */
            severity: "Warning" | "Critical";
            /**
             * Startedat
             * Format: date-time
             */
            startedAt: string;
            /**
             * Status
             * @enum {string}
             */
            status: "Pending" | "Active" | "Ended";
            /** Summary */
            summary: string;
            /**
             * Type
             * @enum {string}
             */
            type: "Busier Than Usual" | "Camera Not Counting";
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
            totalEntries: number | null;
            /** Totalexits */
            totalExits: number | null;
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
            /**
             * Thiscityfemale
             * @description This City/Municipality share of thisProvFemale; null when not recorded.
             */
            thisCityFemale?: number | null;
            /**
             * Thiscitymale
             * @description This City/Municipality share of thisProvMale; null when not recorded.
             */
            thisCityMale?: number | null;
            /**
             * Thiscityunspecified
             * @description This City/Municipality share of thisProvUnspecified; null when not recorded.
             */
            thisCityUnspecified?: number | null;
            /** Thisprovfemale */
            thisProvFemale: number;
            /** Thisprovmale */
            thisProvMale: number;
            /**
             * Thisprovunspecified
             * @description This Province visitors whose sex was not recorded.
             * @default 0
             */
            thisProvUnspecified: number;
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
        /** RequestAttachmentCreate */
        RequestAttachmentCreate: {
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
        /** RequestAttachmentMetadata */
        RequestAttachmentMetadata: {
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
        /** RequestCreate */
        RequestCreate: {
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["RequestAttachmentCreate"][];
            /** Camera */
            camera?: string | null;
            /** Description */
            description: string;
            /**
             * Group
             * @enum {string}
             */
            group: "Desktop app or camera problem" | "Report problem" | "Other";
            /** Title */
            title: string;
        };
        /** RequestDetail */
        RequestDetail: {
            accountChange?: components["schemas"]["AccountChangeSummary"] | null;
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["RequestAttachmentMetadata"][];
            /** Camera */
            camera?: string | null;
            /** Closedat */
            closedAt?: string | null;
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
            enterpriseId?: string | null;
            /** Enterprisename */
            enterpriseName?: string | null;
            /**
             * Group
             * @enum {string}
             */
            group: "Sign-in help" | "Desktop app or camera problem" | "Report problem" | "Account change" | "Other";
            /** Id */
            id: string;
            /** Messages */
            messages?: components["schemas"]["RequestMessageSummary"][];
            /** Requesteremail */
            requesterEmail?: string | null;
            /** Requestername */
            requesterName: string;
            /**
             * Status
             * @enum {string}
             */
            status: "Sent" | "In Progress" | "Resolved" | "Approved" | "Declined";
            /** Title */
            title: string;
            /**
             * Unread
             * @default false
             */
            unread: boolean;
            /**
             * Updated
             * @default false
             */
            updated: boolean;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
            /** Urgent */
            urgent: boolean;
        };
        /** RequestGroupUpdate */
        RequestGroupUpdate: {
            /**
             * Group
             * @enum {string}
             */
            group: "Sign-in help" | "Desktop app or camera problem" | "Report problem" | "Account change" | "Other";
        };
        /** RequestMessageCreate */
        RequestMessageCreate: {
            /** Message */
            message: string;
        };
        /** RequestMessageSummary */
        RequestMessageSummary: {
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
            /**
             * Kind
             * @enum {string}
             */
            kind: "message" | "note" | "status";
            /** Message */
            message: string;
            /** Requestid */
            requestId: string;
        };
        /** RequestReadResponse */
        RequestReadResponse: {
            /** Readcount */
            readCount: number;
        };
        /** RequestReadUpdate */
        RequestReadUpdate: {
            /**
             * All
             * @default false
             */
            all: boolean;
            /** Requestids */
            requestIds?: string[];
        };
        /** RequestStatusUpdate */
        RequestStatusUpdate: {
            /**
             * Status
             * @enum {string}
             */
            status: "Sent" | "In Progress" | "Resolved" | "Approved" | "Declined";
        };
        /** RequestSummary */
        RequestSummary: {
            accountChange?: components["schemas"]["AccountChangeSummary"] | null;
            /** Affectedarea */
            affectedArea?: string | null;
            /** Attachments */
            attachments?: components["schemas"]["RequestAttachmentMetadata"][];
            /** Camera */
            camera?: string | null;
            /** Closedat */
            closedAt?: string | null;
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
            enterpriseId?: string | null;
            /** Enterprisename */
            enterpriseName?: string | null;
            /**
             * Group
             * @enum {string}
             */
            group: "Sign-in help" | "Desktop app or camera problem" | "Report problem" | "Account change" | "Other";
            /** Id */
            id: string;
            /** Requesteremail */
            requesterEmail?: string | null;
            /** Requestername */
            requesterName: string;
            /**
             * Status
             * @enum {string}
             */
            status: "Sent" | "In Progress" | "Resolved" | "Approved" | "Declined";
            /** Title */
            title: string;
            /**
             * Unread
             * @default false
             */
            unread: boolean;
            /**
             * Updated
             * @default false
             */
            updated: boolean;
            /**
             * Updatedat
             * Format: date-time
             */
            updatedAt: string;
            /** Urgent */
            urgent: boolean;
        };
        /** RequestUrgentUpdate */
        RequestUrgentUpdate: {
            /** Urgent */
            urgent: boolean;
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
            currentOccupancy: number | null;
            /** Degradeduniquecount */
            degradedUniqueCount: number;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Entries */
            entries: number | null;
            /** Error */
            error?: string | null;
            /** Exits */
            exits: number | null;
            /** Gatewaystatus */
            gatewayStatus: string;
            /** Id */
            id: string;
            monitoring?: components["schemas"]["DesktopCameraMonitoringSummary"];
            /** Peakoccupancy */
            peakOccupancy: number | null;
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
            uniqueCount: number | null;
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
            averageVisitors: number | null;
            /** Estimateduniquecount */
            estimatedUniqueCount?: number | null;
            /** Label */
            label: string;
            /** Peakvisitors */
            peakVisitors: number | null;
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
            currentVisitors: number | null;
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
        /** VisitorRankingEnterprise */
        VisitorRankingEnterprise: {
            /** Barangay */
            barangay: string;
            /** Category */
            category: string;
            /** Enterpriseid */
            enterpriseId: string;
            /** Enterprisename */
            enterpriseName: string;
            /** Visitors */
            visitors: number;
        };
        /**
         * VisitorRankingSummary
         * @description Visitors per enterprise for a date range, for ranking enterprises, barangays or categories.
         */
        VisitorRankingSummary: {
            /**
             * Cameradays
             * @description Days counted from camera counts, today included.
             */
            cameraDays: number;
            /**
             * End
             * Format: date
             */
            end: string;
            /** Enterprises */
            enterprises: components["schemas"]["VisitorRankingEnterprise"][];
            /** Includestoday */
            includesToday: boolean;
            /**
             * Reportmonths
             * @description Whole past months, as YYYY-MM, counted from monthly reports.
             */
            reportMonths: string[];
            /**
             * Start
             * Format: date
             */
            start: string;
            /**
             * Uncovereddays
             * @description Days older than the camera history without a monthly report.
             */
            uncoveredDays: number;
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
    list_enterprise_closures_accounts_enterprises__account_id__closures_get: {
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
                    "application/json": components["schemas"]["ClosureSummary"][];
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
    add_enterprise_closure_accounts_enterprises__account_id__closures_post: {
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
                "application/json": components["schemas"]["ClosureCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClosureSummary"];
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
    remove_enterprise_closure_accounts_enterprises__account_id__closures__closure_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                account_id: string;
                closure_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    list_own_closures_auth_profile_closures_get: {
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
                    "application/json": components["schemas"]["ClosureSummary"][];
                };
            };
        };
    };
    add_own_closure_auth_profile_closures_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClosureCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClosureSummary"];
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
    remove_own_closure_auth_profile_closures__closure_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                closure_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    request_enterprise_name_change_auth_profile_enterprise_name_change_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnterpriseNameChangeRequest"];
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
    update_own_opening_hours_auth_profile_opening_hours_patch: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpeningHours"];
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
    get_enterprise_desktop_backup_operational_desktop_backup_get: {
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
                    "application/json": components["schemas"]["DesktopBackup"] | null;
                };
            };
        };
    };
    save_enterprise_desktop_backup_operational_desktop_backup_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DesktopBackupUpload"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DesktopBackupSummary"];
                };
            };
            /** @description The upload was not based on the saved copy. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    report_connection_gap_operational_desktop_connection_gap_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DesktopConnectionGap"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
    report_desktop_event_operational_desktop_events_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DesktopEvent"];
            };
        };
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
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
                    "application/json": components["schemas"]["MapEnterpriseSummary"][];
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
    list_request_summaries_operational_requests_get: {
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
                    "application/json": components["schemas"]["RequestSummary"][];
                };
            };
        };
    };
    send_request_operational_requests_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    read_requests_operational_requests_read_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestReadUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestReadResponse"];
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
    get_request_operational_requests__request_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
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
                    "application/json": components["schemas"]["RequestDetail"];
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
    get_request_attachment_operational_requests__request_id__attachments__attachment_index__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
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
    move_request_operational_requests__request_id__group_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestGroupUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    reply_to_request_operational_requests__request_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestMessageCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    add_note_for_it_operational_requests__request_id__notes_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestMessageCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    reopen_operational_requests__request_id__reopen_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
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
                    "application/json": components["schemas"]["RequestDetail"];
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
    change_request_status_operational_requests__request_id__status_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestStatusUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    flag_request_operational_requests__request_id__urgent_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                request_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestUrgentUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RequestDetail"];
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
    get_admin_visitor_ranking_operational_visitor_insights_ranking_get: {
        parameters: {
            query: {
                /** @description First day of the range, in Philippine time. */
                start: string;
                /** @description Last day of the range, in Philippine time. */
                end: string;
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
                    "application/json": components["schemas"]["VisitorRankingSummary"];
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
