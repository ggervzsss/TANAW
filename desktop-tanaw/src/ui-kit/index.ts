/*
 * This app's shared UI components, helpers and page patterns. The look they follow is described in
 * DESIGN.md at the repository root; the other TANAW app keeps its own copy and may differ.
 */

// Primitives
export { Alert, type AlertProps, type AlertTone } from "./components/Alert";
export { Badge, type BadgeProps, type BadgeTone } from "./components/Badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, CardFooter, CardHeader, type CardHeaderProps, type CardPadding, type CardProps } from "./components/Card";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
export { Dialog, type DialogProps, type DialogSize } from "./components/Dialog";
export { ExpandableText, type ExpandableTextProps } from "./components/ExpandableText";
export { ModalPortal, type ModalPortalProps } from "./components/ModalPortal";
export { Select, type SelectOption, type SelectProps } from "./components/Select";
export { Skeleton, SkeletonText, Spinner, type SkeletonProps, type SkeletonTextProps, type SpinnerProps } from "./components/Spinner";
export { Switch, type SwitchProps } from "./components/Switch";
export { Tooltip, type TooltipProps } from "./components/Tooltip";

// Patterns
export { MetricStrip, type Metric, type MetricStripControl, type MetricStripProps, type MetricTone } from "./patterns/MetricStrip";
export { PasswordMatchIndicator, PasswordRequirements, type PasswordMatchIndicatorProps, type PasswordRequirementStatus, type PasswordRequirementsProps } from "./patterns/PasswordRequirements";
export { TopbarNavigation } from "./patterns/TopbarNavigation";
export { ViewSkeleton, type ViewSkeletonProps, type ViewSkeletonVariant } from "./patterns/ViewSkeleton";

// Helpers
export { cn } from "./lib/cn";
export { DROPDOWN_SEARCH_MIN_OPTIONS, getNextDropdownIndex, shouldShowDropdownSearch, type DropdownKey } from "./lib/dropdown";
export { useDialogFocus } from "./lib/focus-trap";
export { initialsOf } from "./lib/initials";
export { dialogIn, easeOut, fadeInDown, popIn } from "./lib/motion";
export { usePageEnter } from "./lib/page-enter";
export { hasVisualOverflow } from "./lib/overflow";
export { useExclusivePopupDismissal } from "./lib/popup-dismissal";
export { toSentenceCase } from "./lib/sentence-case";
