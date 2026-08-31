class DuplicateReportPeriodError(Exception):
    pass


class InvalidReportWorkflowError(Exception):
    pass


class ReportAlreadyConsolidatedError(InvalidReportWorkflowError):
    pass
